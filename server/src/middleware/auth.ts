import { Request, Response, NextFunction } from 'express';
import db from '../database/db';

declare global {
  namespace Express {
    interface Request {
      adminId?: number;
      adminUsername?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.cookies?.ssid;

  if (!sessionId) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const session = db.prepare<{ admin_id: number; username: string; expires_at: string }>(`
    SELECT s.admin_id, a.username, s.expires_at 
    FROM sessions s 
    JOIN admins a ON s.admin_id = a.id 
    WHERE s.id = ?
  `).get(sessionId);

  if (!session) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
    return;
  }

  req.adminId = session.admin_id;
  req.adminUsername = session.username;
  next();
}
