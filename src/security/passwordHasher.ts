import crypto from 'crypto';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const PREFIX = 'pbkdf2:sha512:100000:';

/**
 * Generates a secure salted PBKDF2-SHA512 password hash.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return `${PREFIX}${salt}:${hash}`;
}

/**
 * Constant-time verification of password against stored PBKDF2 hash
 * or initial bootstrap plaintext.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) {
    return false;
  }

  if (storedHash.startsWith(PREFIX)) {
    const parts = storedHash.slice(PREFIX.length).split(':');
    if (parts.length !== 2) {
      return false;
    }
    const [salt, expectedHash] = parts;
    const computedHash = crypto
      .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
      .toString('hex');

    const expectedBuf = Buffer.from(expectedHash, 'hex');
    const computedBuf = Buffer.from(computedHash, 'hex');
    if (expectedBuf.length !== computedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, computedBuf);
  }

  // Constant-time fallback for initial bootstrap comparison
  const userPassBuf = Buffer.from(password.trim());
  const expectedPassBuf = Buffer.from(storedHash.trim());
  if (userPassBuf.length !== expectedPassBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(userPassBuf, expectedPassBuf);
}
