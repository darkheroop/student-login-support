import crypto from 'crypto';
import { Response } from 'express';
import { config } from '../config';
import logger from '../utils/logger';

export interface SessionPayload {
  username: string;
  exp: number; // Unix timestamp in ms
  csrf: string;
}

export interface SessionVerification {
  valid: boolean;
  username?: string;
  csrfToken?: string;
  error?: string;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class AdminAuth {
  /**
   * Securely validates credentials using constant-time comparison.
   */
  public static validateCredentials(username?: string, password?: string): boolean {
    if (!username || !password) {
      return false;
    }

    const expectedUser = config.adminUsername;
    let expectedPass = config.adminPassword;

    // In non-production environments (dev/test), fallback to 'admin123' if unset
    if (!expectedPass) {
      if (config.nodeEnv === 'production') {
        logger.error('ADMIN_PASSWORD is not configured in production environment. Admin login disabled.');
        return false;
      }
      expectedPass = 'admin123';
    }

    const userMatch = username.trim() === expectedUser;
    
    // Constant-time string comparison for password
    const userPassBuf = Buffer.from(password.trim());
    const expectedPassBuf = Buffer.from(expectedPass);

    if (userPassBuf.length !== expectedPassBuf.length) {
      return false;
    }

    const passMatch = crypto.timingSafeEqual(userPassBuf, expectedPassBuf);
    return userMatch && passMatch;
  }

  /**
   * Generates a signed, tamper-proof session token with CSRF protection.
   */
  public static createSession(username: string): { token: string; csrfToken: string; expiresAt: string } {
    const exp = Date.now() + SESSION_TTL_MS;
    const csrf = crypto.randomBytes(24).toString('hex');
    const payload: SessionPayload = { username, exp, csrf };

    const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', config.adminSessionSecret || 'fallback-admin-secret-at-least-32-chars')
      .update(payloadStr)
      .digest('hex');

    const token = `${payloadStr}.${signature}`;
    return {
      token,
      csrfToken: csrf,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  /**
   * Verifies the authenticity and expiration of a session token.
   */
  public static verifySession(token: string): SessionVerification {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'MISSING_TOKEN' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'MALFORMED_TOKEN' };
    }

    const [payloadStr, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', config.adminSessionSecret || 'fallback-admin-secret-at-least-32-chars')
      .update(payloadStr)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expSigBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
      return { valid: false, error: 'INVALID_SIGNATURE' };
    }

    try {
      const decoded = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf-8')) as SessionPayload;
      if (Date.now() > decoded.exp) {
        return { valid: false, error: 'EXPIRED_SESSION' };
      }

      return {
        valid: true,
        username: decoded.username,
        csrfToken: decoded.csrf,
      };
    } catch {
      return { valid: false, error: 'CORRUPTED_PAYLOAD' };
    }
  }

  /**
   * Sets secure HTTP-only session cookies and CSRF cookies on the response.
   */
  public static setSessionCookies(res: Response, token: string, csrfToken: string): void {
    const isProd = config.nodeEnv === 'production';

    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });

    res.cookie('admin_csrf', csrfToken, {
      httpOnly: false, // Accessible by browser JavaScript to populate x-csrf-token header
      secure: isProd,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  /**
   * Clears session cookies upon logout.
   */
  public static clearSessionCookies(res: Response): void {
    const isProd = config.nodeEnv === 'production';
    res.clearCookie('admin_session', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
    });
    res.clearCookie('admin_csrf', {
      httpOnly: false,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
    });
  }
}
