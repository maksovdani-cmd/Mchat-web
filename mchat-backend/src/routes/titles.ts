import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { assertAdmin } from '../services/verification';
import { findForTitle, grantGeneral, listGenerals, markGeneralSeen, revokeGeneral, setGeneralStyle } from '../services/titles';
import { wrap } from '../utils/errors';

export const titlesRouter = Router();
titlesRouter.use(requireAuth);

// ───────── владелец титула ─────────
/** Настройки звезды: только яркость и анимация. Поля «цвет»/«скрыть» не принимаются вообще (strict). */
titlesRouter.put('/general/style', wrap(async (req, res) => {
  const b = z.object({ glow: z.string().max(10), anim: z.string().max(10) }).strict().parse(req.body);
  res.json(await setGeneralStyle(authOf(req).userId, b.glow, b.anim));
}));

/** Праздничный экран показан. */
titlesRouter.post('/general/seen', wrap(async (req, res) => res.json(await markGeneralSeen(authOf(req).userId))));

// ───────── только создатель/админ ─────────
titlesRouter.get('/general', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  res.json({ users: await listGenerals() });
}));

titlesRouter.get('/general/users', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  const q = z.string().trim().min(1).max(40).parse(req.query.q);
  res.json({ users: await findForTitle(q) });
}));

titlesRouter.post('/general/grant', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  const { username } = z.object({ username: z.string().trim().min(1).max(40) }).parse(req.body);
  res.json(await grantGeneral(username));
}));

titlesRouter.post('/general/revoke', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  const { userId } = z.object({ userId: z.string().min(1).max(40) }).parse(req.body);
  res.json(await revokeGeneral(userId));
}));
