import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
  nodeEnv: string;
  sessionSecret: string;
  cookieMaxAgeMs: number;
  corsOrigin: string;
  upstreamBaseUrl: string;
  upstreamTimeoutMs: number;
  supportRetryCount: number;
  supportRetryDelayMs: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  loginRateLimitMax: number;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';

const rawUpstreamUrl = process.env.UPSTREAM_BASE_URL?.trim() || (isTest ? 'http://test-upstream.local' : '');

if (!rawUpstreamUrl) {
  throw new Error('Configuration error: UPSTREAM_BASE_URL is required. The support application cannot start without an explicitly configured authorized upstream target.');
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(rawUpstreamUrl);
} catch {
  throw new Error(`Configuration error: UPSTREAM_BASE_URL '${rawUpstreamUrl}' is not a valid URL.`);
}

if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
  throw new Error(`Configuration error: UPSTREAM_BASE_URL protocol must be http: or https:, received '${parsedUrl.protocol}'.`);
}

// Normalize by removing any trailing slash
const upstreamBaseUrl = rawUpstreamUrl.replace(/\/+$/, '');

export const config: Config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv,
  sessionSecret: process.env.SESSION_SECRET || 'change-me-to-a-random-secret-at-least-32-chars',
  cookieMaxAgeMs: parseInt(process.env.COOKIE_MAX_AGE_MS || '3600000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  upstreamBaseUrl,
  upstreamTimeoutMs: parseInt(process.env.UPSTREAM_TIMEOUT_MS || '15000', 10),
  supportRetryCount: parseInt(process.env.SUPPORT_RETRY_COUNT || '3', 10),
  supportRetryDelayMs: parseInt(process.env.SUPPORT_RETRY_DELAY_MS || '1500', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '30', 10),
  loginRateLimitMax: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10),
};
