import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { blockUser, follow, listBlocked, listFollowsOf, listFriends, unblockUser, unfollow } from '../services/friends';
import { wrap } from '../utils/errors';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

/** Друзья (взаимные подписки), подписки и подписчики. */
friendsRouter.get('/', wrap(async (req, res) => res.json(await listFriends(authOf(req).userId))));

/** «Подписаться». Если человек уже подписан на вас — статус сразу станет «Друзья». */
friendsRouter.post('/follow', wrap(async (req, res) => {
  const { username } = z.object({ username: z.string().min(1).max(40) }).parse(req.body);
  res.json(await follow(authOf(req).userId, username));
}));

/** «Отписаться». Если вы были друзьями — он остаётся вашим подписчиком. */
friendsRouter.delete('/follow/:username', wrap(async (req, res) => res.json(await unfollow(authOf(req).userId, String(req.params.username)))));

/** Список подписчиков или подписок пользователя: GET /api/friends/of/anna/followers | following */
friendsRouter.get('/of/:username/:kind', wrap(async (req, res) => {
  const { kind } = z.object({ kind: z.enum(['followers', 'following']) }).parse(req.params);
  res.json(await listFollowsOf(authOf(req).userId, String(req.params.username), kind));
}));

/** Чёрный список: мои заблокированные, заблокировать, разблокировать. */
friendsRouter.get('/blocked', wrap(async (req, res) => res.json({ users: await listBlocked(authOf(req).userId) })));
friendsRouter.post('/block', wrap(async (req, res) => {
  const { username } = z.object({ username: z.string().min(1).max(40) }).parse(req.body);
  res.json(await blockUser(authOf(req).userId, username));
}));
friendsRouter.delete('/block/:username', wrap(async (req, res) => res.json(await unblockUser(authOf(req).userId, String(req.params.username)))));