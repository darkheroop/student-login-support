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

export const adminLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 10, // 10 failed/successful attempts per IP in 15 mins
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many login attempts from this IP address. Please wait 15 minutes before trying again.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
});
