import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { executeUpstreamRequest } from './upstreamProxy';
import { DiagnosticsResult, DiagnosticsResponse, DiagnosticEvent } from '../types/diagnostics';
import logger from '../utils/logger';
import { redactSecrets } from '../security/redactSecrets';

export async function runLoginDiagnostics(
  mobile: string
): Promise<DiagnosticsResponse> {
  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const events: DiagnosticEvent[] = [];

  try {
    // Step 1: Initiates authorized login-support request
    const loginEvent = await executeUpstreamRequest(
      {
        method: 'POST',
        path: '/authorized/login-support',
        body: { mobile },
      },
      config.supportRetryCount,
      config.supportRetryDelayMs
    );
    events.push(loginEvent);

    // Empty response check after retries
    if (loginEvent.responseType === 'empty') {
      return {
        success: false,
        error: {
          code: 'EMPTY_UPSTREAM_RESPONSE',
          message: 'The authorized upstream service returned an empty response after the configured retry limit.',
          attempts: config.supportRetryCount + 1,
        },
      };
    }

    // Step 2: Verification state request (only if Step 1 didn't produce a fatal error)
    if (loginEvent.responseType !== 'error' && loginEvent.status < 400) {
      const verificationEvent = await executeUpstreamRequest(
        {
          method: 'POST',
          path: '/authorized/verification-state',
          body: { mobile },
        },
        config.supportRetryCount,
        config.supportRetryDelayMs
      );
      events.push(verificationEvent);

      if (verificationEvent.responseType === 'empty') {
        return {
          success: false,
          error: {
            code: 'EMPTY_UPSTREAM_RESPONSE',
            message: 'The authorized upstream service returned an empty verification state response after the configured retry limit.',
            attempts: config.supportRetryCount + 1,
          },
        };
      }

      // Step 3: Upstream student status check
      const statusEvent = await executeUpstreamRequest(
        {
          method: 'GET',
          path: `/authorized/status/${encodeURIComponent(mobile)}`,
        },
        config.supportRetryCount,
        config.supportRetryDelayMs
      );
      events.push(statusEvent);

      if (statusEvent.responseType === 'empty') {
        return {
          success: false,
          error: {
            code: 'EMPTY_UPSTREAM_RESPONSE',
            message: 'The authorized upstream service returned an empty status response after the configured retry limit.',
            attempts: config.supportRetryCount + 1,
          },
        };
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    // Redact secrets before sending to client
    const redactedEvents: DiagnosticEvent[] = events.map(evt => ({
      ...evt,
      response: redactSecrets(evt.response),
    }));

    const result: DiagnosticsResult = {
      requestId: runId,
      startedAt,
      completedAt,
      durationMs,
      requestCount: events.length,
      responseCount: events.filter(e => e.status > 0).length,
      events: redactedEvents,
    };

    return { success: true, diagnostics: result };

  } catch (err) {
    logger.error({ err, runId }, 'Diagnostics service error');
    throw err;
  }
}
