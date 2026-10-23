import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const configuredKey = process.env.SUPPORT_API_KEY?.trim();

  // If no API key is configured, allow open access
  if (!configuredKey) {
    return next();
  }

  const rawAuth = req.headers['authorization'];
  const bearerToken = typeof rawAuth === 'string' && rawAuth.startsWith('Bearer ')
    ? rawAuth.slice(7).trim()
    : null;

  const headerKey = req.headers['x-api-key'];
  const providedKey = (typeof headerKey === 'string' ? headerKey : null) || bearerToken;

  if (!providedKey || providedKey !== configuredKey) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Access denied: Invalid or missing API key. Please pass a valid key via "x-api-key" or "Authorization: Bearer <key>" header.',
      },
    });
    return;
  }

  next();
}
