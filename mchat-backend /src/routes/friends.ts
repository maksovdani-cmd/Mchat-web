import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { acceptRequest, listFriends, removeFriendship, sendRequest } from '../services/friends';
import { wrap } from '../utils/errors';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

friendsRouter.get('/', wrap(async (req, res) => res.json(await listFriends(authOf(req).userId))));

/** «Добавить в друзья». Если этот человек уже отправил заявку вам — сразу станете друзьями. */
friendsRouter.post('/request', wrap(async (req, res) => {
  const { username } = z.object({ username: z.string().min(1).max(40) }).parse(req.body);
  res.json(await sendRequest(authOf(req).userId, username));
}));

friendsRouter.post('/:id/accept', wrap(async (req, res) => res.json(await acceptRequest(authOf(req).userId, String(req.params.id)))));

/** Отклонить входящую, отменить исходящую или удалить из друзей. */
friendsRouter.delete('/:id', wrap(async (req, res) => res.json(await removeFriendship(authOf(req).userId, String(req.params.id)))));
