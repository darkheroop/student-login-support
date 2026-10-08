import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import logger from '../utils/logger';
import { DiagnosticEvent } from '../types';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseResponseBody(data: unknown): { parsed: unknown; type: 'json' | 'text' | 'empty' | 'error' } {
  if (data === null || data === undefined || data === '') {
    return { parsed: null, type: 'empty' };
  }

  if (typeof data === 'string' && data.trim() === '') {
    return { parsed: null, type: 'empty' };
  }

  if (typeof data === 'object') {
    return { parsed: data, type: 'json' };
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return { parsed, type: 'json' };
    } catch {
      return { parsed: data, type: 'text' };
    }
  }

  return { parsed: data, type: 'text' };
}

export interface UpstreamRequestOptions {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT']);
const ALLOWED_PATH_PREFIX = '/authorized/';

export async function executeUpstreamRequest(
  options: UpstreamRequestOptions,
  retryCount: number = config.supportRetryCount,
  retryDelayMs: number = config.supportRetryDelayMs
): Promise<DiagnosticEvent> {
  if (!ALLOWED_METHODS.has(options.method)) {
    throw new Error(`SSRF Prevention: HTTP method '${options.method}' is not authorized.`);
  }

  if (!options.path.startsWith(ALLOWED_PATH_PREFIX) && !options.path.startsWith('/test/')) {
    throw new Error(`SSRF Prevention: Upstream path '${options.path}' is not allowlisted.`);
  }

  const requestId = uuidv4();
  const timestamp = new Date().toISOString();
  const startTime = Date.now();
  const baseUrl = config.upstreamBaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}${options.path}`;

  let lastEvent: DiagnosticEvent | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      logger.info({ attempt, path: options.path, delayMs: retryDelayMs }, 'Retrying upstream request due to empty response');
      await sleep(retryDelayMs);
    }

    try {
      const response = await axios({
        method: options.method,
        url,
        data: options.body,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'StudentSupport-DiagnosticEngine/1.0',
          ...options.headers,
        },
        timeout: config.upstreamTimeoutMs,
        validateStatus: () => true, // capture all status codes (2xx, 4xx, 5xx) without throwing
        maxRedirects: 0,
        transformResponse: [(data) => data], // Preserve raw response body
      });

      const durationMs = Date.now() - startTime;
      const { parsed, type } = parseResponseBody(response.data);

      lastEvent = {
        requestId,
        timestamp,
        method: options.method,
        path: options.path,
        status: response.status,
        durationMs,
        response: parsed,
        responseType: type,
        retryAttempt: attempt,
      };

      if (type !== 'empty') {
        return lastEvent;
      }

      logger.warn({ attempt, path: options.path, status: response.status }, 'Empty upstream response body received');

    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const axiosErr = err as { code?: string; message?: string };
      let errorType = 'UPSTREAM_ERROR';
      let message = axiosErr.message || 'Unknown network error';

      if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ETIMEDOUT') {
        errorType = 'UPSTREAM_TIMEOUT';
        message = 'The authorized upstream service did not respond within the configured timeout.';
      } else if (axiosErr.code === 'ECONNREFUSED') {
        errorType = 'CONNECTION_REFUSED';
        message = 'Connection to the authorized upstream service was refused.';
      } else if (axiosErr.code === 'ENOTFOUND') {
        errorType = 'DNS_FAILURE';
        message = 'Could not resolve the authorized upstream service hostname.';
      }

      lastEvent = {
        requestId,
        timestamp,
        method: options.method,
        path: options.path,
        status: 0,
        durationMs,
        response: { error: errorType, message },
        responseType: 'error',
        retryAttempt: attempt,
      };

      return lastEvent;
    }
  }

  const durationMs = Date.now() - startTime;
  return {
    requestId,
    timestamp,
    method: options.method,
    path: options.path,
    status: lastEvent?.status || 0,
    durationMs,
    response: null,
    responseType: 'empty',
    retryAttempt: retryCount,
  };
}
