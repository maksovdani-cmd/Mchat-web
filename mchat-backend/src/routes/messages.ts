import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { getMessageDTO, MAX_TEXT, stopLiveLocation, updateLiveLocation, voteOnPoll } from '../services/chat';
import { addPollOptionAndDispatch, deleteAndDispatch, editAndDispatch, forwardAndDispatch, reactAndDispatch } from '../services/messaging';
import { emitToChat } from '../realtime/hub';
import { closeViewOnce, openViewOnce } from '../services/viewonce';
import { wrap } from '../utils/errors';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

const mid = (req: { params: Record<string, unknown> }) => String(req.params.id);

messagesRouter.get('/:id', wrap(async (req, res) => {
  res.json({ message: await getMessageDTO(authOf(req).userId, mid(req)) });
}));

/** Изменить свой текст. */
messagesRouter.patch('/:id', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().max(MAX_TEXT + 500) }).parse(req.body);
  res.json({ message: await editAndDispatch(authOf(req).userId, mid(req), text) });
}));

/** Удалить: scope=all — у всех, scope=me — только у меня. */
messagesRouter.delete('/:id', wrap(async (req, res) => {
  const { scope } = z.object({ scope: z.enum(['me', 'all']).default('all') }).parse(req.query);
  const r = await deleteAndDispatch(authOf(req).userId, mid(req), scope);
  res.json({ ok: true, scope: r.scope });
}));

/** Поставить реакцию; emoji=null или тот же эмодзи повторно — снять. */
messagesRouter.put('/:id/reaction', wrap(async (req, res) => {
  const { emoji } = z.object({ emoji: z.string().max(16).nullable() }).parse(req.body);
  res.json(await reactAndDispatch(authOf(req).userId, mid(req), emoji));
}));

messagesRouter.post('/:id/poll-vote', wrap(async (req, res) => {
  const { optionIds } = z.object({ optionIds: z.array(z.string().min(1).max(40)).min(1).max(12) }).parse(req.body);
  const message = await voteOnPoll(authOf(req).userId, mid(req), optionIds);
  const broadcast = message.poll ? { ...message, poll: { ...message.poll, voted: false, correctOptionPosition: null, options: message.poll.options.map((o) => ({ ...o, voted: false, correct: false })) } } : message;
  emitToChat(message.chatId, 'message:edited', broadcast);
  res.json({ message });
}));

messagesRouter.post('/:id/poll-options', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1).max(100) }).parse(req.body);
  const message = await addPollOptionAndDispatch(authOf(req).userId, mid(req), text);
  res.json({ message });
}));

messagesRouter.patch('/:id/location', wrap(async (req, res) => {
  const { latitude, longitude } = z.object({ latitude: z.number(), longitude: z.number() }).parse(req.body);
  const message = await updateLiveLocation(authOf(req).userId, mid(req), latitude, longitude);
  emitToChat(message.chatId, 'message:edited', message);
  res.json({ message });
}));

messagesRouter.delete('/:id/location', wrap(async (req, res) => {
  const message = await stopLiveLocation(authOf(req).userId, mid(req));
  emitToChat(message.chatId, 'message:edited', { ...message, location: message.location ? { ...message.location, active: false } : null });
  res.json({ message });
}));

/** Переслать в другой чат, где я участник. */
messagesRouter.post('/:id/forward', wrap(async (req, res) => {
  const b = z.object({ chatId: z.string().min(1).max(40), clientId: z.string().min(1).max(64).optional() }).parse(req.body);
  res.json({ message: await forwardAndDispatch(authOf(req).userId, mid(req), b.chatId, b.clientId) });
}));

/** Получатель открывает одноразовое медиа. Второй раз — 410 «уже просмотрено». Возвращает временную ссылку на файл. */
messagesRouter.post('/:id/view-once/open', wrap(async (req, res) => {
  res.json(await openViewOnce(authOf(req).userId, mid(req)));
}));

/** Просмотр закончен (закрыл окно / дослушал): файл и сообщение удаляются навсегда у обоих. */
messagesRouter.post('/:id/view-once/close', wrap(async (req, res) => {
  res.json(await closeViewOnce(authOf(req).userId, mid(req)));
}));
