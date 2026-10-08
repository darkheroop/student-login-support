import rateLimit from 'express-rate-limit';
import { config } from '../config';

const isTest = config.nodeEnv === 'test';

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: isTest ? 10000 : config.rateLimitMax,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});

export const loginRateLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: isTest ? 10000 : config.loginRateLimitMax,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many login attempts, please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});
