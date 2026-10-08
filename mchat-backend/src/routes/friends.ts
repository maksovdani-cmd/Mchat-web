import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { follow, listFriends, unfollow } from '../services/friends';
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
