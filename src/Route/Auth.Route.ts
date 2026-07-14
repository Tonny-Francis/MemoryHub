import { Router } from 'express';
import { z } from 'zod';

import { authMiddleware } from '../Middleware/Auth.Middleware.js';
import { login, logout, refresh } from '../Service/Auth.Service.js';

export function authRouter(): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    try {
      const result = await login(parsed.data.email, parsed.data.password);
      res.json(result);
    } catch {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  router.post('/refresh', async (req, res) => {
    const schema = z.object({ refreshToken: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    try {
      const result = await refresh(parsed.data.refreshToken);
      res.json(result);
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  });

  router.post('/logout', async (req, res) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) await logout(refreshToken);
    res.json({ ok: true });
  });

  router.get('/me', authMiddleware, (req, res) => {
    res.json(req.user);
  });

  return router;
}
