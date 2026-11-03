import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { resolveLoginAlert } from '../services/security';
import { wrap } from '../utils/errors';

/**
 * Кнопки карточки «Mchat — Безопасность». Все проверки (чей это запрос, не сам ли это вход подтверждает себя,
 * не просрочено ли, не решено ли уже) выполняются в services/security.ts на сервере.
 */
export const securityRouter = Router();
securityRouter.use(requireAuth);

const alertId = z.string().min(1).max(40);

/** «Это я»: вход подтверждается, новая сессия начинает работать. */
securityRouter.post('/alerts/:id/confirm', wrap(async (req, res) => {
  const a = authOf(req);
  res.json(await resolveLoginAlert(a.userId, { sessionId: a.sessionId, deviceId: a.deviceId }, alertId.parse(req.params.id), 'CONFIRM'));
}));

/** «Это не я»: именно эта новая сессия и устройство отзываются на сервере немедленно. Остальные сессии не затрагиваются. */
securityRouter.post('/alerts/:id/deny', wrap(async (req, res) => {
  const a = authOf(req);
  res.json(await resolveLoginAlert(a.userId, { sessionId: a.sessionId, deviceId: a.deviceId }, alertId.parse(req.params.id), 'DENY'));
}));
