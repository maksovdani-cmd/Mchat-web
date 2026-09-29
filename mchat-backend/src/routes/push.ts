import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { authOf, requireAuth } from '../middleware/auth';
import { removeSubscription, saveSubscription } from '../services/push';
import { wrap } from '../utils/errors';

export const pushRouter = Router();

/** Публичный VAPID-ключ нужен браузеру для подписки (это не секрет). */
pushRouter.get('/key', (_req, res) => res.json({ publicKey: config.VAPID_PUBLIC_KEY }));

const subSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});

pushRouter.post('/subscribe', requireAuth, wrap(async (req, res) => {
  const { userId, deviceId } = authOf(req);
  await saveSubscription(userId, deviceId, subSchema.parse(req.body));
  res.json({ ok: true });
}));

pushRouter.post('/unsubscribe', requireAuth, wrap(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body);
  await removeSubscription(authOf(req).userId, endpoint);
  res.json({ ok: true });
}));
