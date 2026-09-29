/**
 * Общий «пульт» реального времени. Ничего не импортирует из бизнес-логики,
 * поэтому на него можно ссылаться откуда угодно без циклических зависимостей.
 */
import type { Server } from 'socket.io';

let io: Server | null = null;
export const setIO = (s: Server) => { io = s; };

/** userId -> (socketId -> видимо ли приложение на экране) */
const online = new Map<string, Map<string, { visible: boolean }>>();

/** true, если это первое соединение пользователя (стал «онлайн»). */
export function registerSocket(userId: string, socketId: string): boolean {
  let m = online.get(userId);
  const first = !m || m.size === 0;
  if (!m) { m = new Map(); online.set(userId, m); }
  m.set(socketId, { visible: true });
  return first;
}

/** true, если это было последнее соединение пользователя (стал «офлайн»). */
export function unregisterSocket(userId: string, socketId: string): boolean {
  const m = online.get(userId);
  if (!m) return false;
  m.delete(socketId);
  if (m.size === 0) { online.delete(userId); return true; }
  return false;
}

export function setVisible(userId: string, socketId: string, visible: boolean) {
  const c = online.get(userId)?.get(socketId);
  if (c) c.visible = visible;
}

export const isConnected = (userId: string) => (online.get(userId)?.size ?? 0) > 0;

/** Пользователь прямо сейчас смотрит в приложение (есть соединение с видимой вкладкой). */
export const isActive = (userId: string) => {
  const m = online.get(userId);
  if (!m) return false;
  for (const c of m.values()) if (c.visible) return true;
  return false;
};

export const emitToUser = (userId: string, event: string, payload: unknown) => {
  io?.to(`user:${userId}`).emit(event, payload);
};

export const emitToChat = (chatId: string, event: string, payload: unknown) => {
  io?.to(`chat:${chatId}`).emit(event, payload);
};

/** Подписать все живые сокеты пользователя на комнату чата (комнатами управляет ТОЛЬКО сервер). */
export const joinUserToChat = (userId: string, chatId: string) => {
  io?.in(`user:${userId}`).socketsJoin(`chat:${chatId}`);
};

export const disconnectSession = (sessionId: string) => {
  io?.in(`session:${sessionId}`).disconnectSockets(true);
};
export const disconnectDevice = (deviceId: string) => {
  io?.in(`device:${deviceId}`).disconnectSockets(true);
};
export const disconnectUser = (userId: string) => {
  io?.in(`user:${userId}`).disconnectSockets(true);
};

export const leaveUserFromChat = (userId: string, chatId: string) => {
  io?.in(`user:${userId}`).socketsLeave(`chat:${chatId}`);
};

export const emitToRooms = (rooms: string[], event: string, payload: unknown) => {
  if (rooms.length) io?.to(rooms).emit(event, payload);
};
