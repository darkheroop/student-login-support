import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AdminAuth } from '../security/adminAuth';
import { requireAdminAuth } from '../middleware/adminAuthMiddleware';
import { adminLoginRateLimiter } from '../middleware/rateLimit';
import { apiKeyService } from '../services/apiKeyService';
import { config } from '../config';
import logger from '../utils/logger';

const router = Router();

// Login schema
const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// Update Key schema
const updateKeySchema = z.object({
  projectName: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

/**
 * POST /api/admin/login and POST /admin/login
 * Authenticates administrator and sets secure HTTP-only cookie + returns session token & CSRF token.
 */
router.post(['/login', '/api/login'], adminLoginRateLimiter, async (req: Request, res: Response) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Username and password are required.',
      },
    });
    return;
  }

  const { username, password } = parseResult.data;
  const isValid = await AdminAuth.validateCredentials(username, password);

  if (!isValid) {
    logger.warn({ username, ip: req.ip }, 'Failed administrator login attempt');
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid administrator username or password.',
      },
    });
    return;
  }

  const session = AdminAuth.createSession(username);
  AdminAuth.setSessionCookies(res, session.token, session.csrfToken);

  logger.info({ username, ip: req.ip }, 'Administrator logged in successfully');
  res.json({
    success: true,
    message: 'Authenticated successfully.',
    token: session.token,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    user: { username },
  });
});

/**
 * POST /api/admin/logout and POST /admin/logout
 * Clears administrator session cookies.
 */
router.post(['/logout', '/api/logout'], (req: Request, res: Response) => {
  AdminAuth.clearSessionCookies(res);
  res.json({
    success: true,
    message: 'Logged out successfully.',
  });
});

/**
 * GET /api/admin/logout
 * Browser navigation logout redirect
 */
router.get('/logout', (req: Request, res: Response) => {
  AdminAuth.clearSessionCookies(res);
  res.redirect('/admin');
});

/**
 * GET /api/admin/session and GET /admin/api/session
 * Verifies active session without requiring explicit login credentials.
 */
router.get(['/session', '/api/session'], (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  let token: string | null = null;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies?.admin_session) {
    token = req.cookies.admin_session;
  }

  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  const verification = AdminAuth.verifySession(token);
  if (!verification.valid || !verification.username) {
    AdminAuth.clearSessionCookies(res);
    res.json({ authenticated: false });
    return;
  }

  res.json({
    authenticated: true,
    user: { username: verification.username, role: 'main_admin' },
    csrfToken: verification.csrfToken,
  });
});

// All routes below require administrator authentication
router.use(requireAdminAuth);

/**
 * POST /api/admin/account/update and /admin/api/account/update
 * Updates administrator account credentials (username and/or password) with current password verification.
 */
router.post(['/account/update', '/api/account/update'], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentUsername = req.adminUser?.username || config.adminUsername;
    const currentPassword = req.body.current_password || req.body.currentPassword;
    const newUsername = req.body.new_username || req.body.newUsername;
    const newPassword = req.body.new_password || req.body.newPassword;

    if (!currentPassword) {
      res.status(400).json({
        success: false,
        error: 'Current password is required to save account changes.',
      });
      return;
    }

    const updateResult = await AdminAuth.updateCredentials(
      currentUsername,
      currentPassword,
      newUsername,
      newPassword
    );

    if (!updateResult.success) {
      res.status(400).json({
        success: false,
        error: updateResult.message,
      });
      return;
    }

    const effectiveUsername = updateResult.username || currentUsername;
    const session = AdminAuth.createSession(effectiveUsername);
    AdminAuth.setSessionCookies(res, session.token, session.csrfToken);

    res.json({
      success: true,
      message: updateResult.message,
      username: effectiveUsername,
      csrfToken: session.csrfToken,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/dashboard and /admin/api/dashboard
 * Aggregated metrics and overview statistics.
 */
router.get(['/dashboard', '/api/dashboard'], async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await apiKeyService.getDashboardMetrics();
    res.json({
      success: true,
      stats,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/keys and /admin/api/client-keys
 * Lists managed API keys formatted for both standard API and reference UI.
 */
router.get(['/keys', '/client-keys', '/api/client-keys'], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10))) : 50;
    const offset = req.query.offset ? Math.max(0, parseInt(String(req.query.offset), 10)) : 0;

    const result = await apiKeyService.listKeys({ search, status, limit, offset });

    const mappedKeys = result.keys.map(k => ({
      ...k,
      name: k.projectName,
      api_key: k.keyPrefix,
      is_active: k.status === 'active',
      requests_count: k.totalRequests,
      rate_limit_per_minute: k.rateLimitPerMinute || 60,
    }));

    res.json({
      success: true,
      keys: mappedKeys,
      total: result.total,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/keys and /admin/api/client-keys
 * Generates a new API key. Plaintext key secret is returned ONCE.
 */
router.post(['/keys', '/client-keys', '/api/client-keys'], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectName = req.body.name || req.body.projectName;
    const description = req.body.description || '';
    const rateLimit = req.body.rate_limit_per_minute !== undefined ? req.body.rate_limit_per_minute : req.body.rateLimitPerMinute;
    const expiresAt = req.body.expiresAt || null;

    if (!projectName || typeof projectName !== 'string' || projectName.trim().length < 2) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Project or application name must be at least 2 characters long.',
        },
      });
      return;
    }

    const { key, record } = await apiKeyService.createKey({
      projectName: projectName.trim(),
      description: typeof description === 'string' ? description.trim() : undefined,
      expiresAt: typeof expiresAt === 'string' ? expiresAt : undefined,
      rateLimitPerMinute: rateLimit ? Number(rateLimit) : null,
    });

    res.status(201).json({
      success: true,
      message: 'API key generated successfully. Copy the secret now; it will never be displayed again.',
      key, // Plaintext secret returned ONCE
      record: {
        ...record,
        name: record.projectName,
        api_key: record.keyPrefix,
        is_active: record.status === 'active',
        requests_count: record.totalRequests,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/keys/:id
 * Retrieves a single key metadata record.
 */
router.get('/keys/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await apiKeyService.getKeyById(req.params.id);
    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found.' },
      });
      return;
    }
    res.json({
      success: true,
      key: {
        ...record,
        name: record.projectName,
        api_key: record.keyPrefix,
        is_active: record.status === 'active',
        requests_count: record.totalRequests,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/keys/:id
 * Updates metadata or toggles status between active and disabled.
 */
router.patch('/keys/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = updateKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parseResult.error.errors[0]?.message || 'Invalid input data.',
        },
      });
      return;
    }

    const updated = await apiKeyService.updateKey(req.params.id, parseResult.data);
    if (!updated) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found.' },
      });
      return;
    }

    res.json({
      success: true,
      message: 'API key updated successfully.',
      key: updated,
    });
  } catch (err: any) {
    if (err.message && err.message.toLowerCase().includes('revoked')) {
      res.status(400).json({
        success: false,
        error: { code: 'IMMUTABLE_STATE', message: err.message },
      });
      return;
    }
    next(err);
  }
});

/**
 * POST /api/admin/keys/:id/toggle and /admin/api/client-keys/:id/toggle
 */
router.post(['/keys/:id/toggle', '/client-keys/:id/toggle', '/api/client-keys/:id/toggle'], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = await apiKeyService.getKeyById(req.params.id);
    if (!key) {
      res.status(404).json({ success: false, error: 'API key not found.' });
      return;
    }

    const newStatus = key.status === 'active' ? 'disabled' : 'active';
    const updated = await apiKeyService.updateKey(req.params.id, { status: newStatus });

    res.json({
      success: true,
      message: `API key ${newStatus === 'active' ? 'activated' : 'revoked'} successfully.`,
      key: updated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/keys/:id/revoke
 * Permanently invalidates an API key.
 */
router.post('/keys/:id/revoke', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const revoked = await apiKeyService.revokeKey(req.params.id);
    if (!revoked) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'API key not found.' },
      });
      return;
    }

    res.json({
      success: true,
      message: 'API key permanently revoked.',
      key: revoked,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/keys/:id/rotate
 * Permanently revokes the current key and generates a new replacement key.
 */
router.post('/keys/:id/rotate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await apiKeyService.rotateKey(req.params.id);
    res.json({
      success: true,
      message: 'API key rotated successfully. Copy the new secret key now; it will never be displayed again.',
      key: result.key, // New plaintext key returned ONCE
      record: result.record,
    });
  } catch (err: any) {
    if (err.message && err.message.includes('not found')) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message },
      });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /api/admin/keys/:id and DELETE /admin/api/client-keys/:id
 * Permanently deletes an API key.
 */
router.delete(['/keys/:id', '/client-keys/:id', '/api/client-keys/:id'], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = await apiKeyService.deleteKey(req.params.id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: 'API key not found.',
      });
      return;
    }

    res.json({
      success: true,
      message: 'API key deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/keys/:id/usage
 * Retrieves recent request logs for a specific key.
 */
router.get('/keys/:id/usage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10))) : 50;
    const usage = await apiKeyService.getKeyUsageHistory(req.params.id, limit);
    res.json({
      success: true,
      usage,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
