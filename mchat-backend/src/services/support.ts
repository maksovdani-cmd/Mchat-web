import { prisma } from '../db';
import { joinAllToChat, sendAndDispatch } from './messaging';
import { emitToUser } from '../realtime/hub';
import { getOrCreateDirectChat } from './chat';
import { HttpError } from '../utils/errors';

/** Служебный админ-аккаунт Mchat: ник «mchat», а если его нет — самый старый ADMIN. */
export async function supportAdmin() {
  const byName = await prisma.user.findUnique({ where: { username: 'mchat' }, select: { id: true, username: true } });
  if (byName) return byName;
  return prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true } });
}

/**
 * Обращение в «Техподдержку» → обычное сообщение в личный чат пользователя с аккаунтом Mchat.
 * Админ видит его в своих чатах (с уведомлением), отвечает там же — ответ приходит человеку как обычное сообщение.
 */
export async function sendSupportMessage(userId: string, text: string, clientId?: string) {
  const admin = await supportAdmin();
  if (!admin) throw new HttpError(503, 'support_unavailable');
  if (admin.id === userId) throw new HttpError(400, 'cannot_chat_with_self');
  const { chatId } = await getOrCreateDirectChat(userId, admin.username);
  joinAllToChat([userId, admin.id], chatId); // сокеты обоих — в комнату чата
  const message = await sendAndDispatch(userId, chatId, { text, clientId });
  emitToUser(admin.id, 'chat:changed', { chatId }); // админ: чат появился/обновился в списке
  return { chatId, message };
}
