import { prisma } from '../db';
import { friendIds } from './friends';
import { emitToRooms, emitToUser, isConnected } from '../realtime/hub';

/**
 * Рассылает статус «онлайн/офлайн» всем, кто его может видеть:
 * участникам общих чатов и друзьям. online=null — пользователь скрыл статус.
 */
export async function broadcastPresence(userId: string, online: boolean | null, at = new Date()) {
  const [chats, friends] = await Promise.all([
    prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } }),
    friendIds(userId),
  ]);
  const payload = { userId, online, at: at.toISOString() };
  emitToRooms(chats.map((c) => `chat:${c.chatId}`), 'presence', payload);
  for (const id of friends) emitToUser(id, 'presence', payload);
}

/** Пользователь только что включил/выключил «скрыть статус» — сообщаем всем актуальное состояние. */
export async function announcePresence(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { hideOnline: true } });
  if (!u) return;
  await broadcastPresence(userId, u.hideOnline ? null : isConnected(userId));
}

/** Как видят статус другие: null, если скрыт. */
export const visiblePresence = (u: { id: string; hideOnline: boolean; lastSeenAt: Date }) => ({
  online: u.hideOnline ? null : isConnected(u.id),
  lastSeenAt: u.hideOnline ? null : u.lastSeenAt.toISOString(),
});
