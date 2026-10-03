import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { acceptCall, callStatus, declineCall, inviteToCall, leaveCall, startCall } from '../services/calls';
import { wrap } from '../utils/errors';

export const callsRouter = Router();
callsRouter.use(requireAuth);

// Используем гибкую валидацию строки вместо строгого uuid(), чтобы принимать любые ID звонков
const callId = z.string().min(1).max(100);

/** Включены ли звонки на сервере (есть ключи LiveKit). */
callsRouter.get('/status', wrap(async (_req, res) => res.json(callStatus())));

/** Позвонить в чат: личный — собеседнику, группа — всем участникам. */
callsRouter.post('/', wrap(async (req, res) => {
  const b = z.object({ chatId: z.string().min(1).max(40), video: z.boolean().default(false) }).parse(req.body);
  res.json(await startCall(authOf(req).userId, b.chatId, b.video));
}));

callsRouter.post('/:id/accept', wrap(async (req, res) => {
  res.json(await acceptCall(authOf(req).userId, callId.parse(req.params.id)));
}));

callsRouter.post('/:id/decline', wrap(async (req, res) => {
  res.json(await declineCall(authOf(req).userId, callId.parse(req.params.id)));
}));

callsRouter.post('/:id/leave', wrap(async (req, res) => {
  res.json(await leaveCall(authOf(req).userId, callId.parse(req.params.id)));
}));

callsRouter.post('/:id/invite', wrap(async (req, res) => {
  const { userIds } = z.object({ userIds: z.array(z.string().min(1).max(40)).min(1).max(20) }).parse(req.body);
  res.json(await inviteToCall(authOf(req).userId, callId.parse(req.params.id), userIds));
}));