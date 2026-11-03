import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { emitToChat, joinUserToChat } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { isMutedNow, MAX_TEXT, messageInclude, toMessageDTO } from './chat';
import { sendPushToUser } from './push';
import type { OfficialKind } from './official';

/**
 * Два официальных системных аккаунта Mchat. Оба называются «Mchat», различаются логотипом и значком:
 *   SECURITY — уведомления о входе с нового устройства (кнопки «Это я» / «Это не я»);
 *   NEWS     — официальные новости и обновления (публикует только администратор).
 *
 * Это обычные строки в таблице User с isSystem=true, но:
 *   • в них нельзя войти (googleId/почта — заглушки, сессии не создаются);
 *   • им нельзя писать и звонить (directAccess → system_readonly, проверка на сервере);
 *   • значок и признак «официальный» выставляет только этот файл — клиент их подделать не может.
 * Это НЕ админ-аккаунт владельца (@mchat): тот остаётся отдельным пользователем и работает как раньше.
 */
export const SYSTEM_ACCOUNTS: Record<OfficialKind, { username: string; googleId: string; email: string; bio: string; welcome: string }> = {
  SECURITY: {
    username: 'mchat_security',
    googleId: 'system:mchat-security',
    email: 'security@system.mchat.invalid',
    bio: 'Официальный аккаунт безопасности Mchat',
    welcome: 'Здесь Mchat сообщает о входах в ваш аккаунт с новых устройств. Если вход выполнили не вы, нажмите «Это не я» — этот вход будет отклонён на сервере. Писать в этот аккаунт нельзя.',
  },
  NEWS: {
    username: 'mchat_news',
    googleId: 'system:mchat-news',
    email: 'news@system.mchat.invalid',
    bio: 'Официальные новости и обновления Mchat',
    welcome: 'Это официальный аккаунт новостей Mchat. Здесь появляются новости и обновления приложения. Писать в этот аккаунт нельзя.',
  },
};
const KINDS = Object.keys(SYSTEM_ACCOUNTS) as OfficialKind[];

const idCache = new Map<OfficialKind, string>();

/** Создаёт/приводит в порядок оба системных аккаунта. Вызывается при старте сервера; повторный вызов безопасен. */
export async function ensureSystemAccounts() {
  for (const kind of KINDS) {
    const a = SYSTEM_ACCOUNTS[kind];
    const u = await prisma.user.upsert({
      where: { googleId: a.googleId },
      create: { googleId: a.googleId, email: a.email, username: a.username, name: 'Mchat', bio: a.bio, isSystem: true, officialKind: kind, role: 'USER' },
      // имя/признаки возвращаем в исходное состояние при каждом старте; роль ADMIN у системных аккаунтов быть не должна
      update: { name: 'Mchat', bio: a.bio, isSystem: true, officialKind: kind, role: 'USER' },
      select: { id: true },
    });
    idCache.set(kind, u.id);
  }
}

export async function systemId(kind: OfficialKind): Promise<string> {
  const c = idCache.get(kind);
  if (c) return c;
  await ensureSystemAccounts();
  const id = idCache.get(kind);
  if (!id) throw new HttpError(500, 'system_account_missing');
  return id;
}

const directKeyOf = (a: string, b: string) => [a, b].sort().join(':');

/** Чаты с системными аккаунтами, уже проверенные в этом процессе (чтобы не ходить в БД на каждый запрос). */
const ensuredChats = new Map<string, Record<OfficialKind, string>>();

/**
 * Гарантирует, что у пользователя есть личные чаты с обоими системными аккаунтами.
 * Так аккаунты появляются у ВСЕХ: и у новых пользователей, и у тех, кто был до обновления (лениво, при открытии списка чатов).
 * Ничего не трогает в обычных перепиской; создаёт только недостающее.
 */
export async function ensureSystemChats(userId: string): Promise<Record<OfficialKind, string>> {
  const cached = ensuredChats.get(userId);
  if (cached) return cached;
  const sysIds = await Promise.all(KINDS.map(systemId));
  const out = {} as Record<OfficialKind, string>;
  const keys = KINDS.map((k, i) => directKeyOf(userId, sysIds[i]));
  const found = await prisma.chat.findMany({
    where: { directKey: { in: keys } },
    select: { id: true, directKey: true, members: { where: { userId }, select: { userId: true } } },
  });
  for (let i = 0; i < KINDS.length; i++) {
    const kind = KINDS[i];
    const f = found.find((c) => c.directKey === keys[i]);
    if (f) {
      if (!f.members.length) await prisma.chatMember.create({ data: { chatId: f.id, userId } }).catch(() => {});
      out[kind] = f.id;
      continue;
    }
    const now = new Date();
    try {
      const chat = await prisma.chat.create({
        data: {
          type: 'DIRECT', directKey: keys[i], lastMessageAt: now,
          members: { create: [{ userId, lastReadAt: now }, { userId: sysIds[i], lastReadAt: now }] },
          // приветствие нужно, чтобы личный чат без сообщений не прятался из списка
          messages: { create: { senderId: sysIds[i], kind: 'TEXT', text: SYSTEM_ACCOUNTS[kind].welcome, createdAt: now } },
        },
        select: { id: true },
      });
      out[kind] = chat.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        out[kind] = (await prisma.chat.findUniqueOrThrow({ where: { directKey: keys[i] }, select: { id: true } })).id;
      } else throw e;
    }
    joinUserToChat(userId, out[kind]); // уже подключённые сокеты начнут получать сообщения нового чата
  }
  if (ensuredChats.size > 50_000) ensuredChats.clear();
  ensuredChats.set(userId, out);
  return out;
}

/** Быстрая проверка без запросов к БД, если чаты уже проверялись. */
export async function systemChatId(userId: string, kind: OfficialKind): Promise<string> {
  return (await ensureSystemChats(userId))[kind];
}

/**
 * Сообщение от системного аккаунта одному пользователю. Единственный способ создать такое сообщение:
 * обычный createMessage системным аккаунтам писать не даёт (и им самим тоже — они не входят в систему).
 */
export async function sendSystemMessage(
  userId: string, kind: OfficialKind,
  input: { kind: 'TEXT' | 'SYSTEM_CARD'; text: string },
  opts: { push?: { title: string; body: string; tag: string } } = {},
) {
  const [sid, chatId] = await Promise.all([systemId(kind), systemChatId(userId, kind)]);
  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { chatId, senderId: sid, kind: input.kind, text: input.text, createdAt: now }, include: messageInclude }),
    prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: now } }),
  ]);
  const dto = toMessageDTO(message);
  emitToChat(chatId, 'message:new', dto);
  if (opts.push) {
    sendPushToUser(userId, { title: opts.push.title, body: opts.push.body, tag: opts.push.tag, data: { kind: 'message', chatId } })
      .catch((e) => console.warn('system push failed:', (e as Error).message));
  }
  return { message, dto, chatId };
}

// ─────────────────────────── Новости ───────────────────────────

export interface NewsInput { text: string; mediaId?: string }

/**
 * Публикация новости (вызывать только после requireAdmin). Создаёт запись NewsPost и в фоне раскладывает
 * сообщение по личным чатам всех пользователей (по одному сообщению на человека; пачками, чтобы не нагружать БД).
 */
export async function publishNews(adminId: string, input: NewsInput) {
  const text = (input.text ?? '').trim();
  if (text.length > MAX_TEXT) throw new HttpError(400, 'message_too_long');
  let kind: 'TEXT' | 'IMAGE' | 'VIDEO' = 'TEXT';
  let mediaId: string | null = null;
  if (input.mediaId) {
    const m = await prisma.media.findUnique({ where: { id: input.mediaId }, select: { id: true, kind: true, ownerId: true } });
    if (!m) throw new HttpError(404, 'media_not_found');
    if (m.ownerId !== adminId) throw new HttpError(403, 'forbidden_media');
    if (m.kind !== 'IMAGE' && m.kind !== 'VIDEO') throw new HttpError(400, 'media_kind_mismatch');
    kind = m.kind;
    mediaId = m.id;
  }
  if (!text && !mediaId) throw new HttpError(400, 'empty_message');

  const recipients = await prisma.user.count({ where: { isSystem: false } });
  const post = await prisma.newsPost.create({ data: { authorId: adminId, kind, text, mediaId, recipients } });
  void deliverNews(post.id, kind, text, mediaId).catch((e) => console.error('news delivery failed:', (e as Error).message));
  return post;
}

async function deliverNews(postId: string, kind: 'TEXT' | 'IMAGE' | 'VIDEO', text: string, mediaId: string | null) {
  const sid = await systemId('NEWS');
  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { isSystem: false }, select: { id: true, notifyMessages: true }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!users.length) break;
    cursor = users[users.length - 1].id;
    for (const u of users) {
      try {
        const chatId = await systemChatId(u.id, 'NEWS');
        const now = new Date();
        const [message] = await prisma.$transaction([
          prisma.message.create({
            data: { chatId, senderId: sid, kind, text, mediaId, clientId: `news:${postId}:${u.id}`, createdAt: now },
            include: messageInclude,
          }),
          prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: now } }),
        ]);
        emitToChat(chatId, 'message:new', toMessageDTO(message));
        const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: u.id } }, select: { muted: true, mutedUntil: true } });
        if (u.notifyMessages && !(member && isMutedNow(member))) {
          sendPushToUser(u.id, { title: 'Mchat', body: text ? (text.length > 140 ? text.slice(0, 137) + '…' : text) : '📷 Новость', tag: 'news', data: { kind: 'message', chatId } }).catch(() => {});
        }
      } catch (e) {
        console.warn(`news ${postId}: пользователь ${u.id} пропущен:`, (e as Error).message);
      }
    }
  }
}

export async function listNews(limit = 30) {
  return prisma.newsPost.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: limit });
}

/** Удалить новость у всех (мягкое удаление сообщений; сами файлы чистятся обычным сборщиком). */
export async function deleteNews(postId: string) {
  const post = await prisma.newsPost.findUnique({ where: { id: postId } });
  if (!post || post.deletedAt) throw new HttpError(404, 'not_found');
  const rows = await prisma.message.findMany({ where: { clientId: { startsWith: `news:${postId}:` }, deletedAt: null }, select: { id: true, chatId: true } });
  await prisma.message.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date() } });
  await prisma.newsPost.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  for (const r of rows) emitToChat(r.chatId, 'message:deleted', { id: r.id, chatId: r.chatId });
  return { removed: rows.length };
}
