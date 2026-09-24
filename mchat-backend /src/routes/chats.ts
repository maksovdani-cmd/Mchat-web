import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import {
  createGroupOrChannel, getChatDTO, getOrCreateDirectChat, joinByInvite, listChats, listMessages,
} from '../services/chat';
import { joinAllToChat, pinAndDispatch, readAndBroadcast, sendAndDispatch } from '../services/messaging';
import { wrap } from '../utils/errors';

export const chatsRouter = Router();
chatsRouter.use(requireAuth);

const id = z.string().min(1).max(40);

chatsRouter.get('/', wrap(async (req, res) => {
  res.json({ chats: await listChats(authOf(req).userId) });
}));

/** «Написать» на профиле: найти или создать личный диалог. */
chatsRouter.post('/direct', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const { username } = z.object({ username: z.string().min(1).max(40) }).parse(req.body);
  const { chatId, otherUserId } = await getOrCreateDirectChat(userId, username);
  joinAllToChat([userId, otherUserId], chatId); // сокеты обоих участников → в комнату чата
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

/** Кнопка «+» → «Создать группу» / «Создать канал». */
chatsRouter.post('/group', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({
    type: z.enum(['GROUP', 'CHANNEL']),
    title: z.string().trim().min(1).max(60).regex(/^[^<>]+$/),
    description: z.string().trim().max(200).regex(/^[^<>]*$/).optional(),
    usernames: z.array(z.string().max(40)).max(200).default([]),
  }).parse(req.body);
  const { chatId, memberIds } = await createGroupOrChannel(userId, b.type, b.title, b.description, b.usernames);
  joinAllToChat(memberIds, chatId);
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

/** Вход по ссылке-приглашению /join/<код>. */
chatsRouter.post('/join', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const { code } = z.object({ code: z.string().min(6).max(64) }).parse(req.body);
  const chatId = await joinByInvite(userId, code);
  joinAllToChat([userId], chatId);
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

chatsRouter.get('/:id/messages', wrap(async (req, res) => {
  const q = z.object({
    before: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query);
  res.json(await listMessages(authOf(req).userId, String(req.params.id), q.before, q.limit));
}));

/** REST-запасной путь отправки (если сокет ещё не подключился). */
chatsRouter.post('/:id/messages', wrap(async (req, res) => {
  const b = z.object({
    text: z.string().max(5000).optional(),
    clientId: z.string().min(1).max(64).optional(),
    kind: z.enum(['TEXT', 'VOICE', 'VIDEO_NOTE', 'IMAGE']).optional(),
    mediaId: id.optional(),
    durationSec: z.number().min(0).max(3600).optional(),
    replyToId: id.optional(),
  }).parse(req.body);
  res.json({ message: await sendAndDispatch(authOf(req).userId, String(req.params.id), b) });
}));

chatsRouter.post('/:id/read', wrap(async (req, res) => {
  await readAndBroadcast(authOf(req).userId, String(req.params.id));
  res.json({ ok: true });
}));

/** Закрепить сообщение (messageId) или открепить (null). */
chatsRouter.put('/:id/pin', wrap(async (req, res) => {
  const { messageId } = z.object({ messageId: id.nullable() }).parse(req.body);
  res.json({ message: await pinAndDispatch(authOf(req).userId, String(req.params.id), messageId) });
}));
