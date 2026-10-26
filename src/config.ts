import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  upstreamBaseUrl: string;
  upstreamTimeoutMs: number;
  supportRetryCount: number;
  supportRetryDelayMs: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  supportRecoveryEndpoint?: string;
  supportRecoveryApiKey?: string;
  supportRecoveryTimeoutMs: number;
  md5decryptApiKey?: string;
  md5decryptApiEndpoint: string;
  md5decryptTimeoutMs: number;
  adminPassword?: string;
  adminUsername: string;
  adminSessionSecret: string;
  databaseUrl?: string;
  supportApiKey?: string;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';

const rawUpstreamUrl = process.env.UPSTREAM_BASE_URL?.trim() || (isTest ? 'http://test-upstream.local' : 'https://edunova.abes.ac.in');

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

// Parse optional second-stage credential recovery service endpoint
const rawRecoveryEndpoint = process.env.SUPPORT_RECOVERY_ENDPOINT?.trim();
let supportRecoveryEndpoint: string | undefined = undefined;

if (rawRecoveryEndpoint) {
  try {
    const parsedRecovery = new URL(rawRecoveryEndpoint);
    if (parsedRecovery.protocol === 'http:' || parsedRecovery.protocol === 'https:') {
      supportRecoveryEndpoint = rawRecoveryEndpoint.replace(/\/+$/, '');
    } else {
      console.warn(`[CONFIG WARNING] SUPPORT_RECOVERY_ENDPOINT protocol must be http: or https:, received '${parsedRecovery.protocol}'. Recovery integration disabled.`);
    }
  } catch {
    console.warn(`[CONFIG WARNING] SUPPORT_RECOVERY_ENDPOINT '${rawRecoveryEndpoint}' is not a valid URL. Recovery integration disabled.`);
  }
}

// Parse MD5Decrypt API configuration (official API: https://api.md5decrypt.net/)
const md5decryptApiKey = process.env.MD5DECRYPT_API_KEY?.trim() || undefined;
const rawMd5decryptEndpoint = process.env.MD5DECRYPT_API_ENDPOINT?.trim() || 'https://api.md5decrypt.net/';
let md5decryptApiEndpoint = 'https://api.md5decrypt.net/';

if (rawMd5decryptEndpoint) {
  try {
    const parsedMd5 = new URL(rawMd5decryptEndpoint);
    if (parsedMd5.protocol === 'http:' || parsedMd5.protocol === 'https:') {
      md5decryptApiEndpoint = rawMd5decryptEndpoint;
    }
  } catch {
    // fallback to default
  }
}

const md5decryptTimeoutMs = parseInt(process.env.MD5DECRYPT_TIMEOUT_MS || '5000', 10);

// Admin Authentication & Session Config
const adminPassword = process.env.ADMIN_PASSWORD?.trim() || 'om sai 0987654321';
const adminUsername = process.env.ADMIN_USERNAME?.trim() || 'inexpert_trifler';
const defaultDevSecret = 'support-admin-dev-secret-key-at-least-32-chars-long';
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET?.trim() || (isTest ? 'test-admin-secret-at-least-32-chars-long' : (nodeEnv === 'development' ? defaultDevSecret : ''));

// Database persistence config (PostgreSQL via DATABASE_URL or POSTGRES_URL)
const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;

// Legacy API Key for backward compatibility
const supportApiKey = process.env.SUPPORT_API_KEY?.trim() || undefined;

export const config: Config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  upstreamBaseUrl,
  upstreamTimeoutMs: parseInt(process.env.UPSTREAM_TIMEOUT_MS || '15000', 10),
  supportRetryCount: parseInt(process.env.SUPPORT_RETRY_COUNT || '3', 10),
  supportRetryDelayMs: parseInt(process.env.SUPPORT_RETRY_DELAY_MS || '1500', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  supportRecoveryEndpoint,
  supportRecoveryApiKey: process.env.SUPPORT_RECOVERY_API_KEY?.trim() || undefined,
  supportRecoveryTimeoutMs: parseInt(process.env.SUPPORT_RECOVERY_TIMEOUT_MS || '5000', 10),
  md5decryptApiKey,
  md5decryptApiEndpoint,
  md5decryptTimeoutMs,
  adminPassword,
  adminUsername,
  adminSessionSecret,
  databaseUrl,
  supportApiKey,
};
