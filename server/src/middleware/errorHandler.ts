import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export function errorHandler(
  err: { status?: number; code?: string; message?: string; expose?: boolean },
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  const status = err.status || 500;

  // Only expose the message when explicitly flagged as safe (err.expose = true)
  // or for 4xx client errors. Never expose raw messages for 5xx.
  const isClientError = status >= 400 && status < 500;
  const safeMessage = isClientError && err.expose !== false
    ? (err.message || 'Bad request')
    : 'An internal error occurred. Please contact your administrator.';

  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'ERROR');

  res.status(status).json({
    success: false,
    error: {
      code,
      message: safeMessage,
    },
  });
}
