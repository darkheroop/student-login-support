import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

import { config } from './config';
import logger from './utils/logger';
import { apiRateLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { runLoginDiagnostics } from './services/diagnosticsService';
import { getApiKeyRepository, maskConnectionString } from './database/apiKeyRepository';
import adminRoutes from './routes/adminRoutes';

export const app = express();

// Trust proxy for rate limiting behind Vercel/Cloudflare/reverse proxies
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-csrf-token', 'Accept'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Mount Admin Management Routes
app.use('/api/admin', adminRoutes);
app.use('/admin/api', adminRoutes);

// Apply general rate limiter to /api
app.use('/api', apiRateLimiter);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'student-support' });
});

// Student Number input validation schema (accepts studentNumber or mobile, preserves leading zeros)
const mobileRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,16}$/;
const studentLookupSchema = z.object({
  studentNumber: z.string().trim().min(4).max(30).optional(),
  mobile: z.string().trim().min(7).max(20).regex(mobileRegex, 'Invalid mobile number format').optional(),
}).refine(data => Boolean(data.studentNumber || data.mobile), {
  message: 'Valid student number is required.',
});

// Single Public Workflow Endpoint (Protected by apiKeyAuth)
app.post('/api/support/login-diagnostics', apiKeyAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = studentLookupSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn({ stage: 'INVALID_INPUT' }, 'Login diagnostics request failed validation');
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Valid student number is required.' },
      });
      return;
    }

    const studentId = parseResult.data.studentNumber || parseResult.data.mobile!;
    const result = await runLoginDiagnostics(studentId);

    if (result.success) {
      res.json({
        success: true,
        username: result.username,
        hash: result.hash || result.password,
        diagnostics: result.diagnostics,
      });
    } else {
      res.status(result.error?.code === 'STUDENT_NOT_FOUND' ? 200 : 502).json({
        success: false,
        error: result.error || { code: 'LOOKUP_FAILED', message: 'Unable to complete student lookup.' },
        diagnostics: result.diagnostics,
      });
    }
  } catch (err) {
    next(err);
  }
});

// Serve Single-Page Frontend & Admin Dashboard
const publicPathCandidates = [
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, 'public'),
  path.resolve(process.cwd(), 'public'),
];
const publicDir = publicPathCandidates.find(p => fs.existsSync(p));

if (publicDir) {
  // Cache static assets (CSS, JS, fonts, icons) with maxAge in production
  app.use(express.static(publicDir, {
    maxAge: config.isProduction ? '1d' : 0,
    etag: true,
  }));

  // Admin Dashboard routes
  app.get(['/admin', '/admin/*'], (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// Safe error handler
app.use(errorHandler);

// Start server when run directly (not during unit tests or on Vercel serverless)
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Student Login Diagnostic service listening on port ${config.port}`);
    logger.info(`Configured upstream service: ${config.upstreamBaseUrl}`);
    if (config.databaseUrl) {
      logger.info(`Database persistence: Neon PostgreSQL CONFIGURED (${maskConnectionString(config.databaseUrl)})`);
      getApiKeyRepository()
        .init()
        .then(() => {
          logger.info('Neon PostgreSQL tables and connection verified successfully');
        })
        .catch(err => {
          logger.error({ err }, 'Failed initial database connection verification');
        });
    } else {
      logger.info('Database persistence: In-Memory (DATABASE_URL not configured)');
    }

    if (config.md5decryptApiKey) {
      logger.info(`MD5Decrypt API integration: CONFIGURED (endpoint: ${config.md5decryptApiEndpoint})`);
    } else if (config.supportRecoveryEndpoint) {
      logger.info(`Custom recovery vault integration: CONFIGURED (endpoint: ${config.supportRecoveryEndpoint})`);
    } else {
      logger.info('MD5Decrypt API integration: NOT CONFIGURED (MD5DECRYPT_API_KEY empty; one-way digests require SSPR)');
    }
  });
}

export default app;
