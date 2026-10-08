import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

import { config } from './config';
import logger from './utils/logger';
import { apiRateLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import { runLoginDiagnostics } from './services/diagnosticsService';

export const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiter to /api
app.use('/api', apiRateLimiter);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'student-support' });
});

// Mobile validation schema
const mobileRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,16}$/;
const diagnosticsSchema = z.object({
  mobile: z.string().min(7).max(20).regex(mobileRegex, 'Invalid mobile number format'),
});

// Single Public Workflow Endpoint
app.post('/api/support/login-diagnostics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = diagnosticsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid mobile number format. Must be 7-20 digits.' },
      });
      return;
    }

    const { mobile } = parseResult.data;
    const result = await runLoginDiagnostics(mobile);

    if (result.success) {
      res.json(result);
    } else {
      res.status(502).json(result);
    }
  } catch (err) {
    next(err);
  }
});

// Serve Single-Page Frontend
const publicPathCandidates = [
  path.resolve(__dirname, '../public'),
  path.resolve(__dirname, 'public'),
  path.resolve(process.cwd(), 'public'),
];
const publicDir = publicPathCandidates.find(p => fs.existsSync(p));

if (publicDir) {
  app.use(express.static(publicDir));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// Safe error handler
app.use(errorHandler);

// Start server when run directly (not during unit tests)
if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Student Login Diagnostic service listening on port ${config.port}`);
    logger.info(`Configured upstream service: ${config.upstreamBaseUrl}`);
  });
}

export default app;
