import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { apiRateLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';

import healthRoutes from './routes/health';
import supportRoutes from './routes/support';

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Rate limit API endpoints
app.use('/api', apiRateLimiter);

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/support', supportRoutes);

// Serve static frontend assets for Railway production deployment
const possibleClientDistPaths = [
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
];

const clientDistPath = possibleClientDistPaths.find(p => fs.existsSync(p));

if (clientDistPath) {
  app.use(express.static(clientDistPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Global error handler
app.use(errorHandler);

export default app;
