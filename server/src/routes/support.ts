import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { runLoginDiagnostics } from '../services/diagnosticsService';
import db from '../database/db';
import { maskMobile } from '../security/redactSecrets';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Accept digits, +, -, spaces, parens, dots — 7 to 20 chars
const mobileRegex = /^[+]?[0-9\s\-().]{7,20}$/;

const diagnosticsSchema = z.object({
  mobile: z.string().min(7).max(20).regex(mobileRegex, 'Invalid mobile number format'),
});

router.post('/login-diagnostics', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const reqId = uuidv4();
  let mobileMasked = '';

  try {
    const parseResult = diagnosticsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid mobile number format' } });
      return;
    }

    const { mobile } = parseResult.data;
    mobileMasked = maskMobile(mobile);
    const operatorId = req.adminId!;

    const result = await runLoginDiagnostics(mobile, operatorId);
    const diagnosticRunId = result.diagnostics?.requestId || reqId;

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (operator_id, timestamp, mobile_masked, request_id, operation, result, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      operatorId.toString(),
      new Date().toISOString(),
      mobileMasked,
      diagnosticRunId,
      'LOGIN_DIAGNOSTICS',
      result.success ? 'SUCCESS' : 'FAILURE',
      req.ip || ''
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(502).json(result);
    }
  } catch (err) {
    // Audit log error
    if (req.adminId) {
      db.prepare(`
        INSERT INTO audit_logs (operator_id, timestamp, mobile_masked, request_id, operation, result, ip_address, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.adminId.toString(),
        new Date().toISOString(),
        mobileMasked,
        reqId,
        'LOGIN_DIAGNOSTICS',
        'ERROR',
        req.ip || '',
        (err as Error).message
      );
    }
    next(err);
  }
});

export default router;
