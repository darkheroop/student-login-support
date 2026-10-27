// Sensitive key patterns to redact (credentials / secrets only)
const SENSITIVE_KEY_PATTERNS = [
  /^password$/i,
  /.*password.*/i,
  /.*passwd.*/i,
  /^otp$/i,
  /^otp_code$/i,
  /^otp_val$/i,
  /^token$/i,
  /.*token$/i,      // matches accessToken, refreshToken, authToken, csrfToken, etc.
  /^token_.*/i,
  /^secret$/i,
  /.*secret.*/i,
  /^authorization$/i,
  /.*auth.*token.*/i,
  /^cookie$/i,
  /.*cookie.*/i,
  /^cvv$/i,
  /^ssn$/i,
  /(^|[_\W])pin($|[_\W])/i,
  /userPin/i,
  /authPin/i,
];

const NON_SENSITIVE_PATTERN = /status|message|msg|count|type|time|attempt|flag|success/i;
const SENSITIVE_FAST_CHECK = /password|passwd|otp|token|secret|authorization|cookie|cvv|ssn|pin/i;
const SENSITIVE_KEY_CACHE = new Map<string, boolean>();
const MAX_KEY_CACHE_SIZE = 500;

function isSensitiveKey(key: string): boolean {
  const cached = SENSITIVE_KEY_CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }

  // Never redact operational diagnostics or status fields
  if (NON_SENSITIVE_PATTERN.test(key)) {
    if (SENSITIVE_KEY_CACHE.size < MAX_KEY_CACHE_SIZE) {
      SENSITIVE_KEY_CACHE.set(key, false);
    }
    return false;
  }

  // Fast pre-filter: if key does not contain any sensitive root words, skip regex array
  if (!SENSITIVE_FAST_CHECK.test(key)) {
    if (SENSITIVE_KEY_CACHE.size < MAX_KEY_CACHE_SIZE) {
      SENSITIVE_KEY_CACHE.set(key, false);
    }
    return false;
  }

  const result = SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
  if (SENSITIVE_KEY_CACHE.size < MAX_KEY_CACHE_SIZE) {
    SENSITIVE_KEY_CACHE.set(key, result);
  }
  return result;
}

/**
 * Deeply traverses an object or array, returning a new copy with sensitive fields redacted.
 * Preserves all arbitrary JSON structure without mutation.
 */
export function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item));
  }

  if (typeof obj === 'object') {
    const redactedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isSensitiveKey(key) && (typeof value !== 'object' || value === null)) {
        redactedObj[key] = '[REDACTED]';
      } else {
        redactedObj[key] = redactSecrets(value);
      }
    }
    return redactedObj;
  }

  return obj;
}

/**
 * Masks a mobile number, preserving only the last 4 digits.
 * E.g., '9876543210' -> '******3210'
 */
export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length <= 4) return mobile;
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}
