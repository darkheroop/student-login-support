import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db';
import { requireAuth } from '../middleware/auth';
import { loginRateLimiter } from '../middleware/rateLimit';
import { config } from '../config';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/login', loginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Username and password are required' },
      });
      return;
    }

    const { username, password } = parseResult.data;

    const admin = db.prepare<{ id: number; password_hash: string; role: string }>(
      'SELECT id, password_hash, role FROM admins WHERE username = ?'
    ).get(username);

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      db.prepare(
        'INSERT INTO audit_logs (operator_id, timestamp, operation, result, ip_address) VALUES (?, ?, ?, ?, ?)'
      ).run('unknown', new Date().toISOString(), 'LOGIN', 'FAILURE', req.ip || '');

      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
      return;
    }

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + config.cookieMaxAgeMs).toISOString();

    db.prepare(`
      INSERT INTO sessions (id, admin_id, created_at, expires_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, admin.id, new Date().toISOString(), expiresAt, req.ip || '', req.headers['user-agent'] || '');

    db.prepare('UPDATE admins SET last_login = ? WHERE id = ?').run(new Date().toISOString(), admin.id);

    db.prepare(
      'INSERT INTO audit_logs (operator_id, timestamp, operation, result, ip_address) VALUES (?, ?, ?, ?, ?)'
    ).run(admin.id.toString(), new Date().toISOString(), 'LOGIN', 'SUCCESS', req.ip || '');

    res.cookie('ssid', sessionId, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      maxAge: config.cookieMaxAgeMs,
      sameSite: 'strict',
    });

    res.json({
      success: true,
      user: { id: admin.id, username, role: admin.role },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.cookies?.ssid;
    if (sessionId) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    }
    res.clearCookie('ssid');
    if (req.adminId) {
      db.prepare(
        'INSERT INTO audit_logs (operator_id, timestamp, operation, result, ip_address) VALUES (?, ?, ?, ?, ?)'
      ).run(req.adminId.toString(), new Date().toISOString(), 'LOGOUT', 'SUCCESS', req.ip || '');
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = db.prepare<{ id: number; username: string; role: string }>(
      'SELECT id, username, role FROM admins WHERE id = ?'
    ).get(req.adminId);

    if (!admin) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }
    res.json({ success: true, user: admin });
  } catch (err) {
    next(err);
  }
});

export default router;
