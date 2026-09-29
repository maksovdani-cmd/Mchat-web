import type http from 'node:http';
import { parseCookie } from 'cookie';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../db';
import { resolveSessionToken, type AuthContext } from '../middleware/auth';
import { Bucket } from '../middleware/security';
import { MAX_TEXT } from '../services/chat';
import { readAndBroadcast, sendAndDispatch } from '../services/messaging';
import { broadcastPresence } from '../services/presence';
import { COOKIE } from '../services/session';
import { HttpError } from '../utils/errors';
import { isConnected, registerSocket, setIO, setVisible, unregisterSocket } from './hub';

const id = z.string().min(1).max(40);
const sendSchema = z.object({
  chatId: id,
  text: z.string().max(MAX_TEXT + 500).optional(),
  clientId: z.string().min(1).max(64).optional(),
  kind: z.enum(['TEXT', 'VOICE', 'VIDEO_NOTE', 'IMAGE', 'VIDEO', 'FILE']).optional(),
  mediaId: id.optional(),
  durationSec: z.number().min(0).max(3600).optional(),
  replyToId: id.optional(),
});
const chatIdSchema = z.object({ chatId: id });
const typingSchema = z.object({ chatId: id, isTyping: z.boolean() });

const msgBucket = new Bucket(10_000, 20); // не больше 20 сообщений за 10 секунд
const typingBucket = new Bucket(10_000, 30);

/**
 * Пауза перед «офлайн»: при обновлении страницы или кратком обрыве сети сокет закрывается
 * и открывается заново за пару секунд — без паузы у собеседников статус мигал бы «офлайн → онлайн».
 */
const OFFLINE_GRACE_MS = 5_000;
const offlineTimers = new Map<string, NodeJS.Timeout>();

type Ack = (res: unknown) => void;
const errCode = (e: unknown) => {
  if (e instanceof HttpError) return e.code;
  if (e instanceof z.ZodError) return 'bad_request';
  console.error('socket error', e);
  return 'server_error';
};

async function goOnline(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { hideOnline: true } });
  await broadcastPresence(userId, u?.hideOnline ? null : true);
}

async function goOffline(userId: string) {
  const at = new Date();
  const u = await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: at }, select: { hideOnline: true } }).catch(() => null);
  await broadcastPresence(userId, u?.hideOnline ? null : false, at);
}

export function initSocket(server: http.Server) {
  const io = new Server(server, {
    cors: { origin: config.appOrigin, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    // Защита от Cross-Site WebSocket Hijacking: соединения только с нашего origin
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || origin === config.appOrigin);
    },
  });
  setIO(io);

  // Аутентификация при подключении: тот же JWT из httpOnly cookie, та же проверка отзыва
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const ctx = await resolveSessionToken(cookies[COOKIE.session]);
      if (!ctx) return next(new Error('unauthorized'));
      socket.data.auth = ctx;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, sessionId, deviceId } = socket.data.auth as AuthContext;

    // ---- обработчики регистрируем сразу, до async-подготовки ----
    socket.on('message:send', async (raw: unknown, ack?: Ack) => {
      const cb: Ack = typeof ack === 'function' ? ack : () => {};
      try {
        if (!msgBucket.take(userId)) return cb({ ok: false, error: 'rate_limited' });
        const { chatId, ...input } = sendSchema.parse(raw);
        const message = await sendAndDispatch(userId, chatId, input);
        cb({ ok: true, message });
      } catch (e) {
        cb({ ok: false, error: errCode(e) });
      }
    });

    socket.on('chat:read', async (raw: unknown, ack?: Ack) => {
      const cb: Ack = typeof ack === 'function' ? ack : () => {};
      try {
        const { chatId } = chatIdSchema.parse(raw);
        await readAndBroadcast(userId, chatId);
        cb({ ok: true });
      } catch (e) {
        cb({ ok: false, error: errCode(e) });
      }
    });

    socket.on('typing', (raw: unknown) => {
      const p = typingSchema.safeParse(raw);
      if (!p.success || !typingBucket.take(userId)) return;
      // комнатами управляет только сервер → нахождение в комнате = членство в чате
      if (!socket.rooms.has(`chat:${p.data.chatId}`)) return;
      socket.to(`chat:${p.data.chatId}`).emit('typing', { chatId: p.data.chatId, userId, isTyping: p.data.isTyping });
    });

    socket.on('app:visibility', (visible: unknown) => setVisible(userId, socket.id, visible === true));

    socket.on('disconnect', () => {
      if (!unregisterSocket(userId, socket.id)) return; // остались другие вкладки/устройства
      clearTimeout(offlineTimers.get(userId));
      offlineTimers.set(userId, setTimeout(() => {
        offlineTimers.delete(userId);
        if (!isConnected(userId)) goOffline(userId).catch(() => {});
      }, OFFLINE_GRACE_MS));
    });

    // ---- подготовка: комнаты и присутствие ----
    const memberships = await prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } });
    if (!socket.connected) return; // отключился, пока ходили в БД
    await socket.join([`user:${userId}`, `session:${sessionId}`, `device:${deviceId}`, ...memberships.map((m) => `chat:${m.chatId}`)]);
    const first = registerSocket(userId, socket.id);
    const pending = offlineTimers.get(userId);
    if (pending) { clearTimeout(pending); offlineTimers.delete(userId); } // быстро вернулся — офлайна не было
    else if (first) goOnline(userId).catch(() => {});
    socket.emit('ready', { userId });
  });

  return io;
}
