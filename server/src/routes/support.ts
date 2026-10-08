import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runLoginDiagnostics } from '../services/diagnosticsService';

const router = Router();

// Accept digits, +, -, spaces, parens, dots — 7 to 20 chars
const mobileRegex = /^[+]?[0-9\s\-().]{7,20}$/;

const diagnosticsSchema = z.object({
  mobile: z.string().min(7).max(20).regex(mobileRegex, 'Invalid mobile number format'),
});

router.post('/login-diagnostics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = diagnosticsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid mobile number format. Must be 7-20 characters.' },
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

export default router;
