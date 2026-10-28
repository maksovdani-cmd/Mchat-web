import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import {
  addMembers, createGroupOrChannel, getChannelPreview, listShared, getChatDTO, getOrCreateDirectChat, getOrCreateSavedChat, joinPublicChannel, listChats, listContacts, mentionCandidatesForChat,
  clearChatForMe, hideChat, listDrafts, setDraft, MAX_DRAFT, leaveChat, listMembers, listMessages, removeMember, searchPublicChannels, setChatAutoDelete, setChatBackground, setChatMuted, setChatPinned, setMemberRole, updateChatInfo,
} from '../services/chat';
import { emitToChat, emitToUser, leaveUserFromChat } from '../realtime/hub';
import { joinAllToChat, pinAndDispatch, readAndBroadcast, sendAndDispatch } from '../services/messaging';
import { decideRequest, invitePreview, listAllPending, listRequests, requestJoin } from '../services/joinRequests';
import { wrap } from '../utils/errors';

export const chatsRouter = Router();
chatsRouter.use(requireAuth);

const id = z.string().min(1).max(40);

chatsRouter.get('/', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const list = await listChats(userId);
  // «Избранное» могло появиться только что — подключаем сокеты пользователя к его комнате
  const saved = list.find((c) => c.type === 'SAVED');
  if (saved) joinAllToChat([userId], saved.id);
  res.json({ chats: list });
}));

/** Мои черновики по всем чатам (личные: другим пользователям не видны). */
chatsRouter.get('/drafts', wrap(async (req, res) => {
  res.json({ drafts: await listDrafts(authOf(req).userId) });
}));

/** Контакты для выбора участников (друзья и собеседники личных чатов). */
chatsRouter.get('/contacts', wrap(async (req, res) => {
  res.json({ contacts: await listContacts(authOf(req).userId) });
}));

/** Глобальный поиск публичных каналов. */
chatsRouter.get('/search', wrap(async (req, res) => {
  const q = z.string().trim().min(1).max(60).parse(req.query.q);
  res.json({ channels: await searchPublicChannels(authOf(req).userId, q) });
}));

/** Экран публичного канала до подписки: карточка и последние посты (без членства в канале). */
chatsRouter.get('/:id/preview', wrap(async (req, res) => {
  res.json(await getChannelPreview(authOf(req).userId, String(req.params.id)));
}));

/** Кнопка «Подписаться» у публичного канала. */
chatsRouter.post('/:id/join', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const chatId = String(req.params.id);
  await joinPublicChannel(userId, chatId);
  joinAllToChat([userId], chatId);
  changed(chatId);
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

/**
 * «Уведомления» чата (только для меня): включить, либо выключить на 1 час / 2 часа / 8 часов / навсегда.
 * { muted: false } — включить; { muted: true, duration: '1h' | '2h' | '8h' | 'forever' } — выключить.
 */
chatsRouter.put('/:id/mute', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({ muted: z.boolean(), duration: z.enum(['1h', '2h', '8h', 'forever']).default('forever') }).parse(req.body);
  res.json(await setChatMuted(userId, String(req.params.id), b.muted, b.duration));
}));

/** «Очистка чата через 24 часа» (исчезающие сообщения): включить / выключить. */
chatsRouter.put('/:id/autodelete', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const chatId = String(req.params.id);
  const r = await setChatAutoDelete(userId, chatId, enabled);
  changed(chatId); // у всех участников обновится значок и настройка
  res.json({ ...r, chat: await getChatDTO(userId, chatId) });
}));

/** «Избранное» — личный чат с самим собой (создаётся при первом обращении). */
chatsRouter.post('/saved', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const chatId = await getOrCreateSavedChat(userId);
  joinAllToChat([userId], chatId);
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

/** Закрепить чат в списке «Чаты» / открепить (только для меня). */
chatsRouter.put('/:id/pin-chat', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
  await setChatPinned(userId, String(req.params.id), pinned);
  res.json({ pinned, chat: await getChatDTO(userId, String(req.params.id)) });
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
    isPublic: z.boolean().optional(),
    /** «Приватный канал/группа»: вход только по заявке, содержимое защищено */
    isPrivate: z.boolean().optional(),
  }).parse(req.body);
  const { chatId, memberIds } = await createGroupOrChannel(userId, b.type, b.title, b.description, b.usernames, b.isPublic ?? b.type === 'CHANNEL', !!b.isPrivate);
  joinAllToChat(memberIds, chatId);
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

/** Карточка чата по ссылке-приглашению /join/<код>: что видит человек до вступления и какая кнопка ему нужна. */
chatsRouter.get('/invite/:code', wrap(async (req, res) => {
  const code = z.string().min(6).max(64).parse(req.params.code);
  res.json(await invitePreview(authOf(req).userId, code));
}));

/**
 * Вход по ссылке-приглашению. Обычная группа/канал — вступаем сразу ({status:'joined'}).
 * Приватная — создаётся заявка ({status:'pending'}), чат откроется после решения владельца/админа.
 */
chatsRouter.post('/join', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const { code } = z.object({ code: z.string().min(6).max(64) }).parse(req.body);
  const r = await requestJoin(userId, code);
  if (r.status === 'pending') return void res.json({ status: 'pending' });
  joinAllToChat([userId], r.chatId);
  if (r.status === 'joined') changed(r.chatId);
  res.json({ status: r.status, chat: await getChatDTO(userId, r.chatId) });
}));

/** Все ожидающие заявки по моим каналам и группам (для владельца/админа). */
chatsRouter.get('/requests', wrap(async (req, res) => {
  res.json({ requests: await listAllPending(authOf(req).userId) });
}));

chatsRouter.get('/:id/requests', wrap(async (req, res) => {
  res.json({ requests: await listRequests(authOf(req).userId, String(req.params.id)) });
}));

/** Принять / отклонить заявку на вступление. */
chatsRouter.post('/:id/requests/:rid/:action(approve|decline)', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const chatId = String(req.params.id);
  const approve = String(req.params.action) === 'approve';
  const r = await decideRequest(userId, chatId, String(req.params.rid), approve);
  if (approve && !r.already) {
    joinAllToChat([r.requesterId], chatId);                       // сокеты заявителя → в комнату чата
    emitToUser(r.requesterId, 'chat:join-approved', { chatId });   // заявителю — чат появится в списке
    emitToUser(r.requesterId, 'chat:changed', { chatId });
    changed(chatId);
  }
  res.json({ ok: true, approved: r.approved });
}));

/** Автодополнение @упоминаний в поле ввода сообщения. */
chatsRouter.get('/:id/mention-candidates', wrap(async (req, res) => {
  const q = z.string().max(40).default('').parse(typeof req.query.q === 'string' ? req.query.q : '');
  res.json({ users: await mentionCandidatesForChat(authOf(req).userId, String(req.params.id), q) });
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
    kind: z.enum(['TEXT', 'VOICE', 'VIDEO_NOTE', 'IMAGE', 'VIDEO', 'FILE']).optional(),
    mediaId: id.optional(),
    durationSec: z.number().min(0).max(3600).optional(),
    replyToId: id.optional(),
    viewOnce: z.boolean().optional(),
    stickerId: id.optional(),
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

/** Личный фон чата (виден только мне): пресет, фото из профиля или загруженная картинка. */
chatsRouter.put('/:id/background', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const { background } = z.object({ background: z.string().max(60).nullable() }).parse(req.body);
  const chatId = String(req.params.id);
  await setChatBackground(userId, chatId, background);
  emitToUser(userId, 'chat:changed', { chatId }); // синхронизируем свои устройства
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

/** Сохранить черновик в чате; пустой текст удаляет его. */
chatsRouter.put('/:id/draft', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().max(MAX_DRAFT) }).parse(req.body);
  res.json(await setDraft(authOf(req).userId, String(req.params.id), text));
}));

// ───────── профиль группы/канала, участники, роли ─────────

/** Сообщаем всем участникам, что у чата изменился профиль/состав/роли — клиент перезапросит список. */
const changed = (chatId: string) => emitToChat(chatId, 'chat:changed', { chatId });

chatsRouter.patch('/:id', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({
    title: z.string().trim().min(1).max(60).regex(/^[^<>]+$/).optional(),
    description: z.string().trim().max(200).regex(/^[^<>]*$/).nullable().optional(),
    avatarMediaId: id.nullable().optional(),
  }).strict().parse(req.body);
  const chatId = String(req.params.id);
  await updateChatInfo(userId, chatId, b);
  changed(chatId);
  res.json({ chat: await getChatDTO(userId, chatId) });
}));

chatsRouter.get('/:id/shared', wrap(async (req, res) => {
  const { tab } = z.object({ tab: z.enum(['media', 'links', 'music', 'voice', 'files', 'audio']).default('media') }).parse(req.query);
  res.json({ messages: await listShared(authOf(req).userId, String(req.params.id), tab) });
}));

// Комментарии под постами каналов отключены: в канале под постом можно ставить только реакции.

chatsRouter.get('/:id/members', wrap(async (req, res) => {
  res.json({ members: await listMembers(authOf(req).userId, String(req.params.id)) });
}));

chatsRouter.post('/:id/members', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({ userIds: z.array(id).min(1).max(100) }).parse(req.body);
  const chatId = String(req.params.id);
  const added = await addMembers(userId, chatId, b.userIds);
  joinAllToChat(added, chatId);
  added.forEach((u) => emitToUser(u, 'chat:changed', { chatId })); // новичку — чат появится в списке
  changed(chatId);
  res.json({ added: added.length, members: await listMembers(userId, chatId) });
}));

/** Очистить переписку (только у меня), чат остаётся в списке. */
chatsRouter.post('/:id/clear', wrap(async (req, res) => {
  const { userId } = authOf(req);
  res.json(await clearChatForMe(userId, String(req.params.id)));
}));

/** Удалить личный чат из моего списка (у собеседника останется). */
chatsRouter.post('/:id/hide', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const chatId = String(req.params.id);
  await hideChat(userId, chatId);
  emitToUser(userId, 'chat:removed', { chatId });
  res.json({ ok: true });
}));

/**
 * Выйти из группы/канала — в том числе владельцу.
 * Владельцу: mode=transfer (+ newOwnerId, иначе выберется сам) — передать права; mode=delete — удалить для всех.
 */
chatsRouter.post('/:id/leave', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const chatId = String(req.params.id);
  const b = z.object({ mode: z.enum(['transfer', 'delete']).optional(), newOwnerId: id.optional() }).parse(req.body ?? {});
  const r = await leaveChat(userId, chatId, b);
  leaveUserFromChat(userId, chatId);
  emitToUser(userId, 'chat:removed', { chatId });
  if (r.deleted) { for (const uid of r.memberIds) { if (uid === userId) continue; leaveUserFromChat(uid, chatId); emitToUser(uid, 'chat:removed', { chatId }); } }
  else changed(chatId);
  res.json({ ok: true, deleted: r.deleted, newOwnerId: r.newOwnerId });
}));

chatsRouter.delete('/:id/members/:userId', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const chatId = String(req.params.id);
  const target = String(req.params.userId);
  await removeMember(userId, chatId, target);
  leaveUserFromChat(target, chatId);
  emitToUser(target, 'chat:removed', { chatId });
  changed(chatId);
  res.json({ ok: true });
}));

chatsRouter.put('/:id/members/:userId/role', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({ role: z.enum(['ADMIN', 'MEMBER']) }).parse(req.body);
  const chatId = String(req.params.id);
  await setMemberRole(userId, chatId, String(req.params.userId), b.role);
  changed(chatId);
  res.json({ members: await listMembers(userId, chatId) });
}));