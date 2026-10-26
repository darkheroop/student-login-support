import { Request, Response, NextFunction } from 'express';
import { AdminAuth } from '../security/adminAuth';

declare global {
  namespace Express {
    interface Request {
      adminUser?: { username: string };
    }
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  // Extract token from Authorization Bearer or Cookie
  const authHeader = req.headers['authorization'];
  let bearerToken: string | null = null;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  const cookieToken = req.cookies?.admin_session as string | undefined;
  const token = bearerToken || cookieToken;

  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Administrator authentication required. Please log in.',
      },
    });
    return;
  }

  const verification = AdminAuth.verifySession(token);
  if (!verification.valid || !verification.username) {
    if (cookieToken) {
      AdminAuth.clearSessionCookies(res);
    }
    res.status(401).json({
      success: false,
      error: {
        code: 'SESSION_EXPIRED',
        message: 'Your administrator session has expired or is invalid. Please log in again.',
      },
    });
    return;
  }

  // CSRF Protection: For mutating requests authenticated via cookies (not Bearer header)
  const isMutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method.toUpperCase());
  const isCookieAuth = !bearerToken && Boolean(cookieToken);

  if (isMutating && isCookieAuth) {
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfHeader || csrfHeader !== verification.csrfToken) {
      res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_MISMATCH',
          message: 'Cross-Site Request Forgery (CSRF) validation failed. Please refresh the page and try again.',
        },
      });
      return;
    }
  }

  req.adminUser = { username: verification.username };
  next();
}
