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

function isSensitiveKey(key: string): boolean {
  // Never redact operational diagnostics or status fields
  if (/status|message|msg|count|type|time|attempt|flag|success/i.test(key)) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
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
