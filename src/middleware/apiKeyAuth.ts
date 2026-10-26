import { Request, Response, NextFunction } from 'express';
import { apiKeyService } from '../services/apiKeyService';
import { ApiKeyRecord } from '../types/apiKey';
import logger from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      apiKeyRecord?: ApiKeyRecord;
    }
  }
}

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const configuredLegacyKey = process.env.SUPPORT_API_KEY?.trim();
  const requireApiKey = process.env.REQUIRE_API_KEY === 'true';

  const rawAuth = req.headers['authorization'];
  const bearerToken = typeof rawAuth === 'string' && rawAuth.startsWith('Bearer ')
    ? rawAuth.slice(7).trim()
    : null;

  const headerKey = req.headers['x-api-key'];
  const providedKey = (typeof headerKey === 'string' ? headerKey.trim() : null) || bearerToken;

  // Case 1: No key provided
  if (!providedKey) {
    if (configuredLegacyKey || requireApiKey) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access denied: Invalid or missing API key. Please pass a valid key via "x-api-key" or "Authorization: Bearer <key>" header.',
        },
      });
      return;
    }

    // Open access when neither legacy key nor mandatory key enforcement is configured
    return next();
  }

  // Case 2: Matches legacy configured environment key
  if (configuredLegacyKey && providedKey === configuredLegacyKey) {
    return next();
  }

  // Case 3: Validate against managed database keys
  const startTime = Date.now();
  try {
    const validation = await apiKeyService.validateKey(providedKey);

    if (!validation.valid || !validation.keyRecord) {
      const statusCode = validation.error === 'RATE_LIMITED'
        ? 429
        : (validation.error === 'KEY_REVOKED' || validation.error === 'KEY_DISABLED' || validation.error === 'KEY_EXPIRED')
          ? 403
          : 401;

      res.status(statusCode).json({
        success: false,
        error: {
          code: validation.error || 'UNAUTHORIZED',
          message: validation.message || 'Access denied: Invalid or inactive API key.',
        },
      });
      return;
    }

    const keyRecord = validation.keyRecord;
    req.apiKeyRecord = keyRecord;

    // Attach response finish listener to record usage statistics asynchronously
    res.on('finish', () => {
      const responseTimeMs = Date.now() - startTime;
      const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || undefined;

      apiKeyService
        .recordUsage(keyRecord.id, {
          endpoint: req.originalUrl || req.baseUrl || req.path,
          statusCode: res.statusCode,
          responseTimeMs,
          ipAddress,
        })
        .catch(err => {
          logger.error({ err, keyId: keyRecord.id }, 'Error recording API key usage in background');
        });
    });

    next();
  } catch (err) {
    logger.error({ err }, 'Unexpected error in apiKeyAuth middleware');
    next(err);
  }
}
