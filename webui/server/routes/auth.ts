import { Router, Request, Response } from 'express';
import { db } from '../db.js';

export const authRouter = Router();

// POST /api/auth/login or /api/login - Editor login
authRouter.post(['/login', '/auth/login'], (req: Request, res: Response) => {
  const { password } = req.body;

  const session = db.createSession('editor', password === 'admin' ? 'WuwaID Lead Editor' : 'Translator Editor');
  res.json({
    status: 'success',
    token: session.token,
    role: session.role,
    username: session.username,
  });
});

// POST /api/auth/admin/login or /api/admin/login - Admin login
authRouter.post(['/admin/login', '/auth/admin/login'], (req: Request, res: Response) => {
  const session = db.createSession('admin', 'WuwaID Lead Admin');
  res.json({
    status: 'success',
    token: session.token,
    role: 'admin',
    username: session.username,
  });
});

// POST /api/auth/logout or /api/logout - Session logout
authRouter.post(['/logout', '/auth/logout'], (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    db.sessions.delete(token);
  }
  res.json({ status: 'logged_out' });
});

// GET /api/auth/me or /api/me - Current user session state
authRouter.get(['/me', '/auth/me'], (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const session = db.sessions.get(token);

    if (session) {
      res.json({
        authenticated: true,
        role: session.role,
        username: session.username,
      });
      return;
    }
  }

  res.json({
    authenticated: false,
    role: 'reader',
    username: 'Guest Reader',
  });
});
