import { prisma } from '../db';
import { emitToChat, emitToUser, isActive, joinUserToChat } from '../realtime/hub';
import {
  createMessage, deleteMessage, editMessage, forwardMessage, markRead, pinMessage, previewOf, setReaction, toMessageDTO,
  type CreateInput, type MessageDTO,
} from './chat';
import { sendPushToUser } from './push';

/** Единая точка отправки: и REST, и Socket.IO идут сюда. */
export async function sendAndDispatch(userId: string, chatId: string, input: CreateInput): Promise<MessageDTO> {
  return dispatchNew(userId, chatId, await createMessage(userId, chatId, input));
}

export async function forwardAndDispatch(userId: string, messageId: string, targetChatId: string, clientId?: string) {
  return dispatchNew(userId, targetChatId, await forwardMessage(userId, messageId, targetChatId, clientId));
}

function dispatchNew(userId: string, chatId: string, r: Awaited<ReturnType<typeof createMessage>>): MessageDTO {
  const dto = toMessageDTO(r.message);
  if (!r.duplicate) {
    emitToChat(chatId, 'message:new', dto); // получают только участники: в комнате состоят лишь они
    notifyRecipients(userId, chatId, dto).catch((e) => console.error('notify error', e));
  }
  return dto;
}

const preview = (d: MessageDTO) =>
  d.kind !== 'TEXT' ? previewOf(d.kind, d.text) : d.text.length > 140 ? d.text.slice(0, 137) + '…' : d.text;

async function notifyRecipients(senderId: string, chatId: string, dto: MessageDTO) {
  const [sender, chat, others] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId }, select: { name: true } }),
    prisma.chat.findUnique({ where: { id: chatId }, select: { type: true, title: true } }),
    prisma.chatMember.findMany({
      where: { chatId, userId: { not: senderId } },
      include: { user: { select: { id: true, notifyMessages: true } } },
    }),
  ]);
  const direct = chat?.type === 'DIRECT';
  const title = direct ? sender?.name ?? 'Mchat' : chat?.title ?? 'Mchat';
  const body = direct ? preview(dto) : `${sender?.name ?? ''}: ${preview(dto)}`;
  for (const m of others) {
    if (m.muted) continue; // уведомления этого чата/канала выключены
    if (!m.user.notifyMessages) continue; // человек выключил уведомления о сообщениях
    if (isActive(m.userId)) continue; // смотрит в приложение — пуш не нужен
    await sendPushToUser(m.userId, { title, body, tag: `chat:${chatId}`, data: { kind: 'message', chatId } });
  }
}

export async function editAndDispatch(userId: string, messageId: string, text: string) {
  const { message, changed } = await editMessage(userId, messageId, text);
  const dto = toMessageDTO(message);
  if (changed) emitToChat(dto.chatId, 'message:edited', dto);
  return dto;
}

export async function deleteAndDispatch(userId: string, messageId: string, scope: 'me' | 'all') {
  const r = await deleteMessage(userId, messageId, scope);
  if (r.scope === 'all') {
    emitToChat(r.chatId, 'message:deleted', { id: r.id, chatId: r.chatId });
    if (r.unpinned) emitToChat(r.chatId, 'chat:pinned', { chatId: r.chatId, message: null });
  } else {
    emitToUser(userId, 'message:deleted', { id: r.id, chatId: r.chatId }); // только свои устройства
  }
  return r;
}

export async function reactAndDispatch(userId: string, messageId: string, emoji: string | null) {
  const r = await setReaction(userId, messageId, emoji);
  emitToChat(r.chatId, 'message:reactions', r);
  return r;
}

export async function pinAndDispatch(userId: string, chatId: string, messageId: string | null) {
  const dto = await pinMessage(userId, chatId, messageId);
  emitToChat(chatId, 'chat:pinned', { chatId, message: dto });
  return dto;
}

export async function readAndBroadcast(userId: string, chatId: string) {
  const at = await markRead(userId, chatId);
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { hideRead: true } });
  const payload = { chatId, userId, at: at.toISOString() };
  if (u?.hideRead) emitToUser(userId, 'chat:read', payload); // только свои устройства
  else emitToChat(chatId, 'chat:read', payload);
}

/** Подписывает живые сокеты всех участников на комнату нового чата. */
export const joinAllToChat = (userIds: string[], chatId: string) => userIds.forEach((u) => joinUserToChat(u, chatId));
