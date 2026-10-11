import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { sendSupportMessage } from '../services/support';
import { wrap } from '../utils/errors';

export const supportRouter = Router();
supportRouter.use(requireAuth);

const supportLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'rate_limited' },
});

/** «Техподдержка»: текст обращения уходит в чат с системным админ-аккаунтом Mchat. */
supportRouter.post('/', supportLimiter, wrap(async (req, res) => {
  const b = z.object({
    text: z.string().trim().min(3).max(3000),
    clientId: z.string().min(1).max(64).optional(),
  }).parse(req.body);
  res.json(await sendSupportMessage(authOf(req).userId, b.text, b.clientId));
}));
