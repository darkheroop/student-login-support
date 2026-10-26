import crypto from 'crypto';
import { Response } from 'express';
import { config } from '../config';
import { getApiKeyRepository } from '../database/apiKeyRepository';
import { hashPassword, verifyPassword } from './passwordHasher';
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
   * Securely validates credentials using PBKDF2 hashes or bootstrap credentials.
   */
  public static async validateCredentials(username?: string, password?: string): Promise<boolean> {
    if (!username || !password) {
      return false;
    }

    try {
      const repo = getApiKeyRepository();
      const adminUser = await repo.getAdminUser(username);

      if (adminUser) {
        return verifyPassword(password, adminUser.passwordHash);
      }

      // Bootstrap fallback if user not in DB yet
      const bootstrapUser = config.adminUsername || 'inexpert_trifler';
      const bootstrapPass = config.adminPassword || 'om sai 0987654321';

      if (username.trim().toLowerCase() === bootstrapUser.toLowerCase() && password === bootstrapPass) {
        try {
          await repo.saveAdminUser(bootstrapUser, hashPassword(bootstrapPass));
        } catch (e) {
          logger.warn({ err: e }, 'Could not persist bootstrap user on initial login');
        }
        return true;
      }

      return false;
    } catch (err) {
      logger.error({ err }, 'Error validating administrator credentials');
      return false;
    }
  }

  /**
   * Updates administrator credentials (username and/or password).
   */
  public static async updateCredentials(
    currentUsername: string,
    currentPassword: string,
    newUsername?: string,
    newPassword?: string
  ): Promise<{ success: boolean; message: string; username?: string; error?: string }> {
    const isValid = await this.validateCredentials(currentUsername, currentPassword);
    if (!isValid) {
      return { success: false, message: 'Current password is incorrect.', error: 'Current password is incorrect.' };
    }

    const targetUsername = (newUsername && newUsername.trim()) ? newUsername.trim() : currentUsername;
    let targetPasswordHash: string | undefined = undefined;

    if (newPassword && newPassword.trim()) {
      if (newPassword.trim().length < 6) {
        return {
          success: false,
          message: 'New password must be at least 6 characters long.',
          error: 'New password must be at least 6 characters long.',
        };
      }
      targetPasswordHash = hashPassword(newPassword.trim());
    }

    const repo = getApiKeyRepository();
    await repo.updateAdminCredentials(currentUsername, targetUsername, targetPasswordHash);

    logger.info({ oldUser: currentUsername, newUser: targetUsername }, 'Administrator account credentials updated');

    return {
      success: true,
      message: 'Account credentials updated successfully.',
      username: targetUsername,
    };
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
