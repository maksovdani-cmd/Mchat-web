import { Prisma, type MemberRole, type MessageKind } from '@prisma/client';
import { prisma } from '../db';
import { friendIds } from './friends';
import { isForbidden } from '../utils/moderation';
import { HttpError } from '../utils/errors';
import { randomToken } from '../utils/crypto';
import { normalizeUsername } from '../utils/validate';
import { gcMedia, mediaUrl } from './media';
import { generalOf } from './titles';
import { visiblePresence } from './presence';

export const MAX_TEXT = 4000;
export const MAX_GROUP_INITIAL_MEMBERS = 200;
export const MAX_GROUP_MEMBERS = 1000;

/** Один эмодзи (включая составные: ❤️, 👍🏽, 👨‍👩‍👧). Защита от «реакций»-простыней текста. */
export const EMOJI_RE = /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;

export const publicUserSelect = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  verified: true,
  generalTitle: true,
  generalStyle: true,
} as const;

export const messageInclude = {
  sender: { select: { id: true, name: true, username: true } },
  replyTo: { select: { id: true, text: true, kind: true, deletedAt: true, sender: { select: { id: true, name: true } } } },
  reactions: { select: { emoji: true, userId: true, user: { select: { id: true, name: true, username: true, avatarUrl: true } } } },
  media: { select: { title: true, size: true, hd: true } },
  sticker: { select: { id: true, packId: true, pack: { select: { title: true } } } },
} satisfies Prisma.MessageInclude;
export type FullMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export interface ReactionUserDTO { id: string; name: string; username: string; avatar: string | null }
export interface ReactionDTO { emoji: string; userIds: string[]; users: ReactionUserDTO[] }
export interface MessageDTO {
  id: string;
  chatId: string;
  senderId: string | null;
  senderName: string | null;
  senderUsername: string | null;
  kind: MessageKind;
  text: string;
  mediaUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationSec: number | null;
  replyTo: { id: string; senderName: string | null; text: string; kind: MessageKind; deleted: boolean } | null;
  forwardedFrom: string | null;
  clientId: string | null;
  createdAt: string;
  editedAt: string | null;
  reactions: ReactionDTO[];
  /** фото/видео отправлено в HD */
  hd: boolean;
  /** карточка завершённого звонка (kind === 'CALL') */
  call: CallCardDTO | null;
  /** одноразовое медиа: файла в DTO нет — получатель запрашивает его отдельно и только один раз */
  viewOnce: boolean;
  viewOnceOpened: boolean;
  /** стикер из коллекции: рисуется без рамки баббла; по нажатию открывается вся коллекция */
  sticker: { id: string; packId: string; packTitle: string } | null;
}

export interface CallCardDTO {
  callId: string;
  status: 'ended' | 'missed' | 'declined';
  video: boolean;
  isGroup: boolean;
  durationSec: number;
}

const parseCall = (text: string): CallCardDTO | null => {
  try {
    const j = JSON.parse(text) as Partial<CallCardDTO>;
    if (!j || typeof j !== 'object') return null;
    const status = j.status === 'ended' || j.status === 'declined' ? j.status : 'missed';
    return { callId: String(j.callId ?? ''), status, video: !!j.video, isGroup: !!j.isGroup, durationSec: Math.max(0, Math.round(Number(j.durationSec) || 0)) };
  } catch { return null; }
};

export const previewOf = (kind: MessageKind, text: string) =>
  kind === 'TEXT' ? text : kind === 'VOICE' ? '🎤 Голосовое сообщение' : kind === 'VIDEO_NOTE' ? '🎥 Видеосообщение'
    : kind === 'VIDEO' ? '🎬 Видео' : kind === 'FILE' ? '📎 Файл' : kind === 'CALL' ? '📞 Звонок' : '📷 Фото';

type ReactionRow = { emoji: string; userId: string; user?: { id: string; name: string; username: string; avatarUrl: string | null } | null };
export const groupReactions = (list: ReactionRow[]): ReactionDTO[] => {
  const map = new Map<string, ReactionDTO>();
  for (const r of list) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, userIds: [], users: [] };
    g.userIds.push(r.userId);
    if (r.user) g.users.push({ id: r.user.id, name: r.user.name, username: r.user.username, avatar: r.user.avatarUrl });
    map.set(r.emoji, g);
  }
  return [...map.values()];
};

export const toMessageDTO = (m: FullMessage): MessageDTO => ({
  id: m.id,
  chatId: m.chatId,
  senderId: m.senderId,
  senderName: m.sender?.name ?? null,
  senderUsername: m.sender?.username ?? null,
  kind: m.kind,
  text: m.kind === 'CALL' || m.viewOnce ? '' : m.text,
  mediaUrl: m.mediaId && !m.viewOnce ? mediaUrl(m.mediaId) : null,
  fileName: m.kind === 'FILE' ? m.media?.title ?? null : null,
  fileSize: m.media?.size ?? null,
  durationSec: m.durationSec,
  replyTo: m.replyTo && {
    id: m.replyTo.id,
    senderName: m.replyTo.sender?.name ?? null,
    text: m.replyTo.deletedAt ? '' : m.replyTo.text.slice(0, 120),
    kind: m.replyTo.kind,
    deleted: !!m.replyTo.deletedAt,
  },
  forwardedFrom: m.forwardedFromName,
  clientId: m.clientId,
  createdAt: m.createdAt.toISOString(),
  editedAt: m.editedAt?.toISOString() ?? null,
  reactions: groupReactions(m.reactions),
  hd: !!m.media?.hd,
  call: m.kind === 'CALL' ? parseCall(m.text) : null,
  viewOnce: m.viewOnce,
  viewOnceOpened: !!m.viewOnceOpenedAt,
  sticker: m.sticker ? { id: m.sticker.id, packId: m.sticker.packId, packTitle: m.sticker.pack.title } : null,
});

// ───────────────────────── права ─────────────────────────

/**
 * ГЛАВНАЯ проверка прав. Каждый REST-запрос и каждое socket-событие, которое
 * касается чата, проходит через неё. Не участник получает 404 — существование чата не раскрываем.
 */
export async function assertMember(chatId: string, userId: string) {
  const m = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    include: { chat: { select: { type: true, pinnedMessageId: true, title: true, avatarMediaId: true, isPrivate: true } } },
  });
  if (!m) throw new HttpError(404, 'chat_not_found');
  return m;
}
/** В канале писать могут только владелец и админы. */
export const canPost = (type: string, role: MemberRole) => type !== 'CHANNEL' || role !== 'MEMBER';
/** Группа или канал (а не личный диалог и не «Избранное»). */
export const isGroupType = (type: string) => type === 'GROUP' || type === 'CHANNEL';
/** В группах/каналах модерировать (удалять чужое, закреплять) могут владелец и админы. */
export const canModerate = (type: string, role: MemberRole) => isGroupType(type) && role !== 'MEMBER';
/** Уведомления чата выключены прямо сейчас (с учётом «глушить на 1/2/8 часов»). */
export const isMutedNow = (m: { muted: boolean; mutedUntil: Date | null }) => m.muted && (!m.mutedUntil || m.mutedUntil.getTime() > Date.now());

export type DmReason = 'blocked' | 'blocked_by_me' | 'dm_follow_required';
export interface DirectAccess { ok: boolean; reason?: DmReason; otherId: string | null; blockedByMe: boolean; blockedMe: boolean }

/**
 * Можно ли писать/звонить в личном чате.
 *  • взаимная подписка («друзья»);
 *  • либо я пишу СВОЕМУ подписчику (он подписан на меня, даже если я на него — нет) — после этого он может отвечать;
 *  • либо собеседник уже писал мне в этом чате (диалог начат с его стороны);
 *  • аккаунт-администратор Mchat (техподдержка) доступен всегда.
 * Чёрный список закрывает всё в обе стороны.
 */
export async function directAccess(userId: string, chatId: string): Promise<DirectAccess> {
  const other = await prisma.chatMember.findFirst({
    where: { chatId, userId: { not: userId } },
    select: { userId: true, user: { select: { role: true } } },
  });
  if (!other) return { ok: false, reason: 'dm_follow_required', otherId: null, blockedByMe: false, blockedMe: false };
  const otherId = other.userId;
  const [blocks, follows, me, theirMsg] = await Promise.all([
    prisma.block.findMany({
      where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] },
      select: { blockerId: true },
    }),
    prisma.follow.findMany({
      where: { OR: [{ followerId: userId, followingId: otherId }, { followerId: otherId, followingId: userId }] },
      select: { followerId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.message.findFirst({ where: { chatId, senderId: otherId, kind: { not: 'CALL' } }, select: { id: true } }),
  ]);
  const blockedByMe = blocks.some((b) => b.blockerId === userId);
  const blockedMe = blocks.some((b) => b.blockerId === otherId);
  if (blockedByMe) return { ok: false, reason: 'blocked_by_me', otherId, blockedByMe, blockedMe };
  if (blockedMe) return { ok: false, reason: 'blocked', otherId, blockedByMe, blockedMe };
  const iFollow = follows.some((f) => f.followerId === userId);
  const heFollows = follows.some((f) => f.followerId === otherId);
  const staff = me?.role === 'ADMIN' || other.user.role === 'ADMIN';
  const ok = staff || (iFollow && heFollows) || heFollows || !!theirMsg;
  return { ok, reason: ok ? undefined : 'dm_follow_required', otherId, blockedByMe, blockedMe };
}

/** Сообщение, которое пользователь вправе видеть (участник чата, не удалено). */
async function loadVisibleMessage(userId: string, messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg || msg.deletedAt) throw new HttpError(404, 'message_not_found');
  const member = await assertMember(msg.chatId, userId);
  return { msg, member };
}

// ───────────────────────── чаты ─────────────────────────

export async function getOrCreateDirectChat(userId: string, username: string) {
  const other = await prisma.user.findUnique({
    where: { username: normalizeUsername(username) },
    select: { id: true },
  });
  if (!other) throw new HttpError(404, 'user_not_found');
  if (other.id === userId) throw new HttpError(400, 'cannot_chat_with_self');

  const [a, b] = [userId, other.id].sort();
  const directKey = `${a}:${b}`;
  let chat = await prisma.chat.findUnique({ where: { directKey } });
  let created = false;
  if (!chat) {
    try {
      chat = await prisma.chat.create({
        data: { type: 'DIRECT', directKey, members: { create: [{ userId: a }, { userId: b }] } },
      });
      created = true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        chat = await prisma.chat.findUniqueOrThrow({ where: { directKey } });
      } else throw e;
    }
  }
  return { chatId: chat.id, otherUserId: other.id, created };
}

/** «Избранное»: личный чат с самим собой. Создаётся при первом обращении. */
export async function getOrCreateSavedChat(userId: string): Promise<string> {
  const directKey = `saved:${userId}`;
  const found = await prisma.chat.findUnique({ where: { directKey }, select: { id: true } });
  if (found) return found.id;
  try {
    const chat = await prisma.chat.create({
      data: { type: 'SAVED', directKey, title: 'Избранное', members: { create: [{ userId, role: 'OWNER' }] } },
      select: { id: true },
    });
    return chat.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return (await prisma.chat.findUniqueOrThrow({ where: { directKey }, select: { id: true } })).id;
    }
    throw e;
  }
}

export async function createGroupOrChannel(
  userId: string,
  type: 'GROUP' | 'CHANNEL',
  title: string,
  description: string | undefined,
  usernames: string[],
  isPublic = false,
  isPrivate = false,
) {
  // нецензурные и оскорбительные названия/описания (в том числе внутри слова) не пропускаем
  if (isForbidden(title) || (description && isForbidden(description))) throw new HttpError(400, 'name_forbidden');
  // В канал людей не «добавляют»: на канал подписываются сами (поиск в «Чатах» или ссылка). Поэтому участников при создании канала нет.
  const names = type === 'CHANNEL' ? [] : [...new Set(usernames.map(normalizeUsername))].slice(0, MAX_GROUP_INITIAL_MEMBERS);
  const users = names.length ? await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true } }) : [];
  const memberIds = users.map((u) => u.id).filter((id) => id !== userId);
  const chat = await prisma.chat.create({
    data: {
      type,
      title,
      description: description || null,
      inviteCode: randomToken(12),
      // приватный канал не может быть публичным: его нет в поиске, вход — только по ссылке и заявке
      isPublic: type === 'CHANNEL' && isPublic && !isPrivate,
      isPrivate,
      members: { create: [{ userId, role: 'OWNER' }, ...memberIds.map((id) => ({ userId: id }))] },
    },
  });
  return { chatId: chat.id, memberIds: [userId, ...memberIds] };
}

/**
 * Вход по ссылке-приглашению. Обычная группа/канал — вступаем сразу.
 * Приватная — сразу не пускаем: создаётся заявка (см. services/joinRequests.ts → requestJoin), которую рассматривает владелец/админ.
 */
export async function joinByInvite(userId: string, code: string) {
  const chat = await prisma.chat.findUnique({ where: { inviteCode: code }, select: { id: true, type: true, isPrivate: true } });
  if (!chat || !isGroupType(chat.type)) throw new HttpError(404, 'invite_not_found');
  if (chat.isPrivate) {
    const already = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: chat.id, userId } }, select: { userId: true } });
    if (!already) throw new HttpError(403, 'join_request_required');
    return chat.id;
  }
  const count = await prisma.chatMember.count({ where: { chatId: chat.id } });
  if (count >= MAX_GROUP_MEMBERS) throw new HttpError(400, 'group_full');
  await prisma.chatMember.createMany({ data: [{ chatId: chat.id, userId }], skipDuplicates: true });
  return chat.id;
}

/** Личный фон чата → то, что нужно клиенту: пресет, фото из профиля или URL загруженной картинки. */
function backgroundOf(raw: string | null) {
  if (!raw) return null;
  if (raw === 'avatar') return { type: 'avatar' as const };
  if (raw.startsWith('preset:')) return { type: 'preset' as const, value: raw.slice(7) };
  if (raw.startsWith('media:')) return { type: 'image' as const, url: mediaUrl(raw.slice(6)) };
  return null;
}

export async function setChatBackground(userId: string, chatId: string, value: string | null) {
  await assertMember(chatId, userId);
  if (value !== null) {
    if (value.startsWith('media:')) {
      const media = await prisma.media.findUnique({ where: { id: value.slice(6) } });
      if (!media || media.ownerId !== userId || media.kind !== 'IMAGE') throw new HttpError(400, 'bad_background');
    } else if (!(value === 'avatar' || /^preset:\d{1,2}$/.test(value))) {
      throw new HttpError(400, 'bad_background');
    }
  }
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { background: value } });
}

export async function getChatDTO(userId: string, chatId: string) {
  const m = await assertMember(chatId, userId);
  const chat = await prisma.chat.findUniqueOrThrow({
    where: { id: chatId },
    include: { _count: { select: { members: true } } },
  });

  const [last, unread, pinned, peerMember, dm] = await Promise.all([
    prisma.message.findFirst({
      where: { chatId, deletedAt: null, hides: { none: { userId } } },
      orderBy: { createdAt: 'desc' },
      select: { text: true, kind: true, createdAt: true, senderId: true },
    }),
    prisma.message.count({
      where: { chatId, deletedAt: null, createdAt: { gt: m.lastReadAt }, senderId: { not: userId }, hides: { none: { userId } } },
    }),
    chat.pinnedMessageId
      ? prisma.message.findFirst({ where: { id: chat.pinnedMessageId, chatId, deletedAt: null }, include: messageInclude })
      : null,
    chat.type === 'DIRECT'
      ? prisma.chatMember.findFirst({
          where: { chatId, userId: { not: userId } },
          include: { user: { select: { ...publicUserSelect, hideOnline: true, hideRead: true, lastSeenAt: true } } },
        })
      : null,
    chat.type === 'DIRECT' ? directAccess(userId, chatId) : null,
  ]);

  // группа: «прочитано» = хотя бы один другой участник (без скрытого статуса прочтения) дошёл до этого сообщения
  let groupReadAt: string | null = null;
  if (chat.type === 'GROUP') {
    const others = await prisma.chatMember.findMany({ where: { chatId, userId: { not: userId }, user: { hideRead: false } }, select: { lastReadAt: true } });
    if (others.length) groupReadAt = new Date(Math.max(...others.map((o) => o.lastReadAt.getTime()))).toISOString();
  }
  const peer = peerMember?.user ?? null;
  const isDirect = chat.type === 'DIRECT';
  const isSaved = chat.type === 'SAVED';
  const lastText = last ? previewOf(last.kind, last.text) : '';
  const mutedNow = isMutedNow(m);
  return {
    id: chatId,
    type: chat.type,
    name: isSaved ? 'Избранное' : isDirect ? peer?.name ?? 'Чат' : chat.title ?? 'Чат',
    description: chat.description,
    avatar: isDirect ? peer?.avatarUrl ?? null : chat.avatarMediaId ? mediaUrl(chat.avatarMediaId) : null,
    /** до какого момента собеседник прочитал чат (null — скрыл статус или это не личный чат) */
    peerReadAt: isDirect ? (peerMember && !peerMember.user.hideRead ? peerMember.lastReadAt.toISOString() : null) : chat.type === 'GROUP' ? groupReadAt : null,
    role: m.role,
    canPost: canPost(chat.type, m.role) && (dm ? dm.ok : true),
    canModerate: canModerate(chat.type, m.role),
    /** личный чат: можно ли писать/звонить (подписки и чёрный список) */
    dm: dm ? { canSend: dm.ok, reason: dm.reason ?? null, blockedByMe: dm.blockedByMe, blockedMe: dm.blockedMe } : null,
    autoDeleteSec: chat.autoDeleteSec ?? null,
    memberCount: chat._count.members,
    isPublic: chat.isPublic,
    /** приватный: вход по заявке, содержимое защищено от пересылки, копирования, скачивания и скриншотов */
    isPrivate: chat.isPrivate,
    muted: mutedNow,
    mutedUntil: mutedNow && m.mutedUntil ? m.mutedUntil.toISOString() : null,
    pinnedChat: !!m.pinnedAt,
    pinnedChatAt: m.pinnedAt ? m.pinnedAt.toISOString() : null,
    background: backgroundOf(m.background),
    inviteCode: !isDirect && m.role !== 'MEMBER' ? chat.inviteCode : null,
    peer: peer && {
      id: peer.id,
      username: peer.username,
      name: peer.name,
      avatar: peer.avatarUrl,
      verified: peer.verified,
      general: generalOf(peer),
      ...visiblePresence(peer),
    },
    lastMessage: last && { text: lastText, createdAt: last.createdAt.toISOString(), senderId: last.senderId },
    lastMessageAt: chat.lastMessageAt.toISOString(),
    unread,
    pinned: pinned && toMessageDTO(pinned),
  };
}

export async function listChats(userId: string) {
  await getOrCreateSavedChat(userId); // «Избранное» есть у каждого
  const memberships = await prisma.chatMember.findMany({
    where: {
      userId,
      // личные диалоги без сообщений не показываем; группы и каналы — всегда
      chat: { OR: [{ type: { not: 'DIRECT' } }, { messages: { some: { deletedAt: null } } }] },
    },
    orderBy: { chat: { lastMessageAt: 'desc' } },
    select: { chatId: true, hiddenAt: true, chat: { select: { lastMessageAt: true } } },
    take: 200,
  });
  // «Удалил чат» из списка: пока нет сообщений новее этого момента — не показываем
  const visible = memberships.filter((m) => !m.hiddenAt || m.chat.lastMessageAt > m.hiddenAt);
  // N+1 запросов на чат — для первой версии нормально; при росте заменить на один SQL с агрегатами
  return Promise.all(visible.map((m) => getChatDTO(userId, m.chatId)));
}

export async function listMessages(userId: string, chatId: string, before: string | undefined, limit: number) {
  const me = await assertMember(chatId, userId);
  await purgeChat(chatId); // исчезающие сообщения: старше срока — уже не показываем
  const rows = await prisma.message.findMany({
    where: { chatId, deletedAt: null, hides: { none: { userId } }, ...(me.hiddenAt ? { createdAt: { gt: me.hiddenAt } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: messageInclude,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse(); // клиенту удобнее от старых к новым
  // одноразовые медиа: «открыто» — это состояние именно этого зрителя (в группе у каждого получателя своё)
  const onceIds = page.filter((m) => m.viewOnce).map((m) => m.id);
  const opened = onceIds.length ? new Set((await prisma.viewOnceView.findMany({ where: { userId, messageId: { in: onceIds } }, select: { messageId: true } })).map((v) => v.messageId)) : null;
  return { messages: page.map((m) => { const d = toMessageDTO(m); if (opened && m.viewOnce && m.senderId !== userId) d.viewOnceOpened = opened.has(m.id) || m.viewOnceOpenedBy === userId; return d; }), hasMore };
}

// ───────────────────────── сообщения ─────────────────────────

export interface CreateInput {
  text?: string;
  clientId?: string;
  kind?: MessageKind;
  mediaId?: string;
  durationSec?: number;
  replyToId?: string;
  forwardedFromName?: string | null;
  /** true — медиа принадлежит не отправителю (пересылка); права уже проверены */
  trustedMedia?: boolean;
  /** одноразовое медиа (личные и групповые чаты; фото, видео, голосовое, кружок) */
  viewOnce?: boolean;
  /** стикер из коллекции: файл берётся из самого стикера (kind=IMAGE) */
  stickerId?: string;
}

export async function createMessage(userId: string, chatId: string, input: CreateInput) {
  const member = await assertMember(chatId, userId);
  if (!canPost(member.chat.type, member.role)) throw new HttpError(403, 'channel_read_only');
  if (member.chat.type === 'DIRECT') {
    const acc = await directAccess(userId, chatId);
    if (!acc.ok) throw new HttpError(403, acc.reason ?? 'dm_follow_required');
  }

  const kind = input.kind ?? 'TEXT';
  if (kind === 'CALL') throw new HttpError(400, 'bad_request'); // служебный тип, только сервер
  const text = (input.text ?? '').trim();
  if (kind === 'TEXT' && !text) throw new HttpError(400, 'empty_message');
  if (text.length > MAX_TEXT) throw new HttpError(400, 'message_too_long');

  if (input.viewOnce && (!['DIRECT', 'GROUP'].includes(member.chat.type) || !['IMAGE', 'VIDEO', 'VOICE'].includes(kind))) throw new HttpError(400, 'view_once_not_allowed');   // кружки одноразовыми не бывают
  let mediaId: string | null = null;
  let durationSec: number | null = null;
  let stickerId: string | null = null;
  if (input.stickerId) {
    if (kind !== 'IMAGE' || input.viewOnce) throw new HttpError(400, 'bad_request');
    const st = await prisma.sticker.findUnique({ where: { id: input.stickerId }, select: { id: true, mediaId: true } });
    if (!st) throw new HttpError(404, 'sticker_not_found');
    stickerId = st.id;
    mediaId = st.mediaId;
  } else if (kind !== 'TEXT') {
    if (!input.mediaId) throw new HttpError(400, 'media_required');
    const media = await prisma.media.findUnique({ where: { id: input.mediaId } });
    if (!media) throw new HttpError(404, 'media_not_found');
    if (!input.trustedMedia && media.ownerId !== userId) throw new HttpError(403, 'forbidden_media');
    if ((media.kind as string) !== kind) throw new HttpError(400, 'media_kind_mismatch');
    mediaId = media.id;
    durationSec = Math.min(Math.max(Math.round(input.durationSec ?? media.durationSec ?? 0), 0), 3600) || null;
  }

  if (input.replyToId) {
    const r = await prisma.message.findUnique({ where: { id: input.replyToId }, select: { chatId: true, deletedAt: true } });
    if (!r || r.chatId !== chatId || r.deletedAt) throw new HttpError(400, 'bad_reply');
  }

  // идемпотентность: повторная отправка с тем же clientId не создаёт дубль
  if (input.clientId) {
    const existing = await prisma.message.findUnique({
      where: { senderId_clientId: { senderId: userId, clientId: input.clientId } },
      include: messageInclude,
    });
    if (existing) return { message: existing, duplicate: true };
  }

  const now = new Date();
  try {
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          chatId, senderId: userId, kind, text: input.viewOnce || stickerId ? '' : text, mediaId, durationSec, viewOnce: !!input.viewOnce, stickerId,
          replyToId: input.replyToId ?? null,
          forwardedFromName: input.forwardedFromName ?? null,
          clientId: input.clientId ?? null,
          createdAt: now,
        },
        include: messageInclude,
      }),
      prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: now } }),
      prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { lastReadAt: now } }),
    ]);
    return { message, duplicate: false };
  } catch (e) {
    if (input.clientId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.message.findUniqueOrThrow({
        where: { senderId_clientId: { senderId: userId, clientId: input.clientId } },
        include: messageInclude,
      });
      return { message: existing, duplicate: true };
    }
    throw e;
  }
}

export async function forwardMessage(userId: string, messageId: string, targetChatId: string, clientId?: string) {
  const { msg, member } = await loadVisibleMessage(userId, messageId); // видеть исходное сообщение обязан
  if (msg.kind === 'CALL' || msg.viewOnce) throw new HttpError(400, 'not_forwardable'); // карточки звонков создаёт сервер; одноразовое пересылать нельзя
  if (member.chat.isPrivate) throw new HttpError(403, 'content_protected'); // приватный канал/группа: пересылка запрещена
  const author = msg.senderId ? await prisma.user.findUnique({ where: { id: msg.senderId }, select: { name: true } }) : null;
  return createMessage(userId, targetChatId, {
    kind: msg.kind,
    text: msg.text,
    mediaId: msg.mediaId ?? undefined,
    durationSec: msg.durationSec ?? undefined,
    forwardedFromName: msg.forwardedFromName ?? author?.name ?? 'Удалённый аккаунт',
    trustedMedia: true,
    clientId,
    stickerId: msg.stickerId ?? undefined,
  });
}

export async function editMessage(userId: string, messageId: string, rawText: string) {
  const { msg } = await loadVisibleMessage(userId, messageId);
  if (msg.senderId !== userId) throw new HttpError(403, 'not_author');
  if (msg.kind !== 'TEXT') throw new HttpError(400, 'not_editable');
  const text = rawText.trim();
  if (!text) throw new HttpError(400, 'empty_message');
  if (text.length > MAX_TEXT) throw new HttpError(400, 'message_too_long');
  if (text === msg.text) return { message: await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude }), changed: false };
  const message = await prisma.message.update({
    where: { id: messageId }, data: { text, editedAt: new Date() }, include: messageInclude,
  });
  return { message, changed: true };
}

export async function deleteMessage(userId: string, messageId: string, scope: 'me' | 'all') {
  const { msg, member } = await loadVisibleMessage(userId, messageId);
  if (scope === 'me') {
    await prisma.messageHide.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId }, update: {},
    });
    return { scope, chatId: msg.chatId, id: messageId, unpinned: false };
  }
  // «у всех»: автор, а в группах/каналах ещё владелец и админы
  if (msg.senderId !== userId && !canModerate(member.chat.type, member.role)) throw new HttpError(403, 'forbidden');
  await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), text: '', mediaId: null } });
  const unpinned = member.chat.pinnedMessageId === messageId;
  if (unpinned) await prisma.chat.update({ where: { id: msg.chatId }, data: { pinnedMessageId: null } });
  if (msg.mediaId) await gcMedia(msg.mediaId);
  return { scope, chatId: msg.chatId, id: messageId, unpinned };
}

export async function setReaction(userId: string, messageId: string, emoji: string | null) {
  const { msg } = await loadVisibleMessage(userId, messageId);
  const existing = await prisma.reaction.findUnique({ where: { messageId_userId: { messageId, userId } } });
  if (!emoji || existing?.emoji === emoji) {
    if (existing) await prisma.reaction.delete({ where: { messageId_userId: { messageId, userId } } });
  } else {
    if (emoji.length > 16 || !EMOJI_RE.test(emoji)) throw new HttpError(400, 'bad_emoji');
    const kinds = await prisma.reaction.findMany({ where: { messageId }, distinct: ['emoji'], select: { emoji: true } });
    if (kinds.length >= 12 && !kinds.some((k) => k.emoji === emoji)) throw new HttpError(400, 'too_many_reactions');
    await prisma.reaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, emoji }, update: { emoji },
    });
  }
  const all = await prisma.reaction.findMany({ where: { messageId }, orderBy: { createdAt: 'asc' }, select: { emoji: true, userId: true, user: { select: { id: true, name: true, username: true, avatarUrl: true } } } });
  return { chatId: msg.chatId, id: messageId, reactions: groupReactions(all) };
}

export async function pinMessage(userId: string, chatId: string, messageId: string | null) {
  const m = await assertMember(chatId, userId);
  if (isGroupType(m.chat.type) && m.role === 'MEMBER') throw new HttpError(403, 'forbidden');
  let dto: MessageDTO | null = null;
  if (messageId) {
    const msg = await prisma.message.findUnique({ where: { id: messageId }, include: messageInclude });
    if (!msg || msg.chatId !== chatId || msg.deletedAt) throw new HttpError(400, 'bad_message');
    dto = toMessageDTO(msg);
  }
  await prisma.chat.update({ where: { id: chatId }, data: { pinnedMessageId: messageId } });
  return dto;
}

export async function markRead(userId: string, chatId: string) {
  await assertMember(chatId, userId);
  const at = new Date();
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { lastReadAt: at } });
  return at;
}


// ───────────────────────── участники, роли, профиль группы ─────────────────────────

const isStaff = (role: MemberRole) => role !== 'MEMBER';

/** Название, описание и аватарка группы/канала: владелец и админы. */
export async function updateChatInfo(
  userId: string, chatId: string,
  patch: { title?: string; description?: string | null; avatarMediaId?: string | null },
) {
  const m = await assertMember(chatId, userId);
  if (!isGroupType(m.chat.type)) throw new HttpError(400, 'not_a_group');
  if (!isStaff(m.role)) throw new HttpError(403, 'forbidden');
  const data: Prisma.ChatUpdateInput = {};
  if ((patch.title && isForbidden(patch.title)) || (patch.description && isForbidden(patch.description))) throw new HttpError(400, 'name_forbidden');
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description || null;
  if (patch.avatarMediaId !== undefined) {
    if (patch.avatarMediaId) {
      const media = await prisma.media.findUnique({ where: { id: patch.avatarMediaId } });
      if (!media || media.ownerId !== userId || media.kind !== 'IMAGE') throw new HttpError(400, 'bad_avatar');
    }
    data.avatarMediaId = patch.avatarMediaId;
  }
  await prisma.chat.update({ where: { id: chatId }, data });
}

export async function listMembers(userId: string, chatId: string) {
  const m = await assertMember(chatId, userId);
  if (!isGroupType(m.chat.type)) throw new HttpError(400, 'not_a_group');
  if (m.chat.type === 'CHANNEL' && !isStaff(m.role)) throw new HttpError(403, 'forbidden'); // подписчики друг друга не видят
  const rows = await prisma.chatMember.findMany({
    where: { chatId },
    include: { user: { select: publicUserSelect } },
    orderBy: { joinedAt: 'asc' },
    take: 1000,
  });
  const order = { OWNER: 0, ADMIN: 1, MEMBER: 2 } as const;
  rows.sort((a, b) => order[a.role] - order[b.role]);
  return rows.map((r) => ({
    id: r.user.id, username: r.user.username, name: r.user.name, avatar: r.user.avatarUrl, verified: r.user.verified, general: generalOf(r.user), role: r.role,
  }));
}

/** Добавить людей можно только из своего списка друзей — чужих в группу не затащишь. */
export async function addMembers(userId: string, chatId: string, userIds: string[]) {
  const m = await assertMember(chatId, userId);
  if (!isGroupType(m.chat.type)) throw new HttpError(400, 'not_a_group');
  if (m.chat.type === 'CHANNEL') throw new HttpError(400, 'not_supported_in_channel'); // на канал подписываются сами
  if (!isStaff(m.role)) throw new HttpError(403, 'forbidden');
  const ids = [...new Set(userIds)].filter((u) => u !== userId);
  if (!ids.length) return [];
  // добавлять можно только контакты: друзей и тех, с кем уже есть личная переписка
  const contactIds = new Set((await listContacts(userId)).map((c) => c.id));
  if (ids.some((u) => !contactIds.has(u))) throw new HttpError(403, 'not_a_contact');
  const before = await prisma.chatMember.count({ where: { chatId } });
  if (before + ids.length > MAX_GROUP_MEMBERS) throw new HttpError(400, 'group_full');
  await prisma.chatMember.createMany({ data: ids.map((u) => ({ chatId, userId: u })), skipDuplicates: true });
  return ids;
}

/** Удалить участника (владелец — любого, админ — только обычных) либо выйти самому. */
export async function removeMember(userId: string, chatId: string, targetId: string) {
  const m = await assertMember(chatId, userId);
  if (!isGroupType(m.chat.type)) throw new HttpError(400, 'not_a_group');
  const target = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: targetId } } });
  if (!target) throw new HttpError(404, 'member_not_found');
  if (targetId === userId) {
    if (m.role === 'OWNER') throw new HttpError(400, 'owner_cannot_leave');
  } else {
    const allowed = m.role === 'OWNER' || (m.role === 'ADMIN' && target.role === 'MEMBER');
    if (!allowed) throw new HttpError(403, 'forbidden');
  }
  await prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId: targetId } } });
}

/** Назначать и снимать админов может только владелец. */
export async function setMemberRole(userId: string, chatId: string, targetId: string, role: 'ADMIN' | 'MEMBER') {
  const m = await assertMember(chatId, userId);
  if (!isGroupType(m.chat.type)) throw new HttpError(400, 'not_a_group');
  if (m.chat.type === 'CHANNEL') throw new HttpError(400, 'not_supported_in_channel'); // в канале нет админов — только владелец
  if (m.role !== 'OWNER') throw new HttpError(403, 'forbidden');
  if (targetId === userId) throw new HttpError(400, 'cannot_change_owner');
  const target = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: targetId } } });
  if (!target) throw new HttpError(404, 'member_not_found');
  if (target.role === 'OWNER') throw new HttpError(400, 'cannot_change_owner');
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId: targetId } }, data: { role } });
}


/** Контакты: друзья + собеседники личных чатов. Из них выбираем участников группы/канала. */
export async function listContacts(userId: string) {
  const [friends, directs] = await Promise.all([
    friendIds(userId),
    prisma.chatMember.findMany({
      where: { userId, chat: { type: 'DIRECT' } },
      select: { hiddenAt: true, chat: { select: { lastMessageAt: true, members: { where: { userId: { not: userId } }, select: { userId: true } } } } },
    }),
  ]);
  const ids = new Set<string>();
  friends.forEach((id) => ids.add(id));
  // удалённые из списка диалоги (hiddenAt) в контакты не попадают, пока собеседник не напишет снова
  directs.filter((d) => !d.hiddenAt || d.chat.lastMessageAt > d.hiddenAt).forEach((d) => d.chat.members.forEach((m) => ids.add(m.userId)));
  ids.delete(userId);
  if (!ids.size) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: publicUserSelect, orderBy: { name: 'asc' } });
  return users.map((u) => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl, verified: u.verified, general: generalOf(u) }));
}

/** Глобальный поиск публичных каналов (по названию и описанию). */
/**
 * Глобальный поиск каналов («Чаты» → «Поиск»). Находит:
 *  • публичные каналы по названию и описанию (без учёта регистра, «@» и «#» в начале запроса игнорируются);
 *  • каналы, где я уже состою, — даже если они закрытые.
 * Слова запроса ищутся независимо друг от друга, поэтому «новости мира» найдёт «Мир: новости».
 */
export async function searchPublicChannels(userId: string, rawQuery: string) {
  const q = rawQuery.replace(/^[@#\s]+/, '').trim().slice(0, 60);
  if (!q) return [];
  // Поиск строго по НАЗВАНИЮ канала. Сравнение регистра делаем здесь, а не в БД: ILIKE в PostgreSQL с локалью C/POSIX
  // не понимает кириллицу («новости» не находило «Новости»). Заодно «ё» = «е».
  const norm = (t: string) => t.toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const needles = [...new Set(q.split(/\s+/).filter(Boolean))].slice(0, 5).map(norm);
  const all = await prisma.chat.findMany({
    where: { type: 'CHANNEL', OR: [{ isPublic: true }, { members: { some: { userId } } }] },
    orderBy: [{ members: { _count: 'desc' } }, { lastMessageAt: 'desc' }],
    take: 3000,
    include: { _count: { select: { members: true } }, members: { where: { userId }, select: { muted: true, mutedUntil: true } } },
  });
  const whole = norm(q);
  const rows = all
    .filter((c) => { const t = norm(c.title ?? ''); return needles.every((n) => t.includes(n)); })
    .sort((x, y) => Number(norm(y.title ?? '').startsWith(whole)) - Number(norm(x.title ?? '').startsWith(whole))) // начинающиеся с запроса — выше
    .slice(0, 30);
  return rows.map((c) => ({
    id: c.id, name: c.title ?? 'Канал', description: c.description,
    avatar: c.avatarMediaId ? mediaUrl(c.avatarMediaId) : null,
    memberCount: c._count.members,
    joined: c.members.length > 0,
    muted: c.members[0] ? isMutedNow(c.members[0]) : false,
    isPublic: c.isPublic,
  }));
}

/**
 * Просмотр публичного канала БЕЗ подписки (экран канала с кнопкой «Подписаться»): карточка канала и последние посты.
 * Закрытый канал так не открыть — только по ссылке-приглашению.
 */
export async function getChannelPreview(userId: string, chatId: string, limit = 40) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { _count: { select: { members: true } }, members: { where: { userId }, select: { role: true, muted: true, mutedUntil: true } } },
  });
  if (!chat || chat.type !== 'CHANNEL') throw new HttpError(404, 'chat_not_found');
  const mine = chat.members[0] ?? null;
  if (!chat.isPublic && !mine) throw new HttpError(404, 'chat_not_found');
  const rows = await prisma.message.findMany({
    where: { chatId, deletedAt: null, hides: { none: { userId } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: messageInclude,
  });
  return {
    channel: {
      id: chat.id, type: 'CHANNEL' as const, name: chat.title ?? 'Канал', description: chat.description,
      avatar: chat.avatarMediaId ? mediaUrl(chat.avatarMediaId) : null,
      memberCount: chat._count.members, isPublic: chat.isPublic,
      joined: !!mine, muted: mine ? isMutedNow(mine) : false,
    },
    messages: rows.reverse().map(toMessageDTO),
  };
}

/** Кнопка «Подписаться» у публичного канала. */
export async function joinPublicChannel(userId: string, chatId: string) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { type: true, isPublic: true, _count: { select: { members: true } } } });
  if (!chat || chat.type !== 'CHANNEL' || !chat.isPublic) throw new HttpError(404, 'chat_not_found');
  if (chat._count.members >= MAX_GROUP_MEMBERS) throw new HttpError(400, 'group_full');
  await prisma.chatMember.createMany({ data: [{ chatId, userId }], skipDuplicates: true });
}

export const MAX_PINNED_CHATS = 10;

/** Закрепить чат вверху списка (или открепить). Закрепление личное: у собеседников список не меняется. */
export async function setChatPinned(userId: string, chatId: string, pinned: boolean) {
  await assertMember(chatId, userId);
  if (pinned) {
    const count = await prisma.chatMember.count({ where: { userId, pinnedAt: { not: null }, chatId: { not: chatId } } });
    if (count >= MAX_PINNED_CHATS) throw new HttpError(400, 'too_many_pinned_chats');
  }
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { pinnedAt: pinned ? new Date() : null } });
}

export type MuteDuration = '1h' | '2h' | '8h' | 'forever';
const MUTE_MS: Record<Exclude<MuteDuration, 'forever'>, number> = { '1h': 3_600_000, '2h': 7_200_000, '8h': 28_800_000 };

/** Глушить уведомления чата: на 1 час, 2 часа, 8 часов или навсегда (muted=false — включить обратно). */
export async function setChatMuted(userId: string, chatId: string, muted: boolean, duration: MuteDuration = 'forever') {
  await assertMember(chatId, userId);
  const mutedUntil = muted && duration !== 'forever' ? new Date(Date.now() + MUTE_MS[duration]) : null;
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { muted, mutedUntil } });
  return { muted, mutedUntil: mutedUntil ? mutedUntil.toISOString() : null };
}

export const AUTO_DELETE_SEC = 24 * 60 * 60;

/**
 * «Очистка чата через 24 часа». В личных чатах и «Избранном» включать может любой участник,
 * в группах и каналах — владелец и админы. Действует на сообщения, отправленные после включения.
 */
export async function setChatAutoDelete(userId: string, chatId: string, enabled: boolean) {
  const m = await assertMember(chatId, userId);
  if (isGroupType(m.chat.type) && m.role === 'MEMBER') throw new HttpError(403, 'forbidden');
  await prisma.chat.update({
    where: { id: chatId },
    data: enabled ? { autoDeleteSec: AUTO_DELETE_SEC, autoDeleteFrom: new Date() } : { autoDeleteSec: null, autoDeleteFrom: null },
  });
  return { autoDeleteSec: enabled ? AUTO_DELETE_SEC : null };
}

export interface PurgeResult { chatId: string; ids: string[]; unpinned: boolean }

async function purgeWhere(chatWhere: Prisma.ChatWhereInput): Promise<PurgeResult[]> {
  const chats = await prisma.chat.findMany({
    where: { autoDeleteSec: { not: null }, autoDeleteFrom: { not: null }, ...chatWhere },
    select: { id: true, autoDeleteSec: true, autoDeleteFrom: true, pinnedMessageId: true },
  });
  const out: PurgeResult[] = [];
  for (const c of chats) {
    const border = new Date(Date.now() - (c.autoDeleteSec ?? AUTO_DELETE_SEC) * 1000);
    const rows = await prisma.message.findMany({
      where: { chatId: c.id, createdAt: { lt: border, gte: c.autoDeleteFrom! } },
      select: { id: true, mediaId: true },
      take: 500,
    });
    if (!rows.length) continue;
    const ids = rows.map((r) => r.id);
    await prisma.message.deleteMany({ where: { id: { in: ids } } });
    const unpinned = !!c.pinnedMessageId && ids.includes(c.pinnedMessageId);
    if (unpinned) await prisma.chat.update({ where: { id: c.id }, data: { pinnedMessageId: null } });
    for (const r of rows) if (r.mediaId) await gcMedia(r.mediaId);
    out.push({ chatId: c.id, ids, unpinned });
  }
  return out;
}
/** Удалить просроченные исчезающие сообщения одного чата (вызывается при открытии истории). */
export const purgeChat = (chatId: string) => purgeWhere({ id: chatId });
/** Все чаты разом — раз в минуту из server.ts. */
export const purgeAllChats = () => purgeWhere({});

/** Служебное сообщение «карточка звонка» в чат. Создаёт только сервер. */
export async function createCallMessage(chatId: string, initiatorId: string, card: CallCardDTO) {
  const now = new Date();
  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: { chatId, senderId: initiatorId, kind: 'CALL', text: JSON.stringify(card), createdAt: now },
      include: messageInclude,
    }),
    prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: now } }),
  ]);
  return message;
}


/** Вкладки «Медиа | Ссылки | Музыка | Голосовые» в профиле группы/канала. */
export type SharedTab = 'media' | 'links' | 'music' | 'voice' | 'files' | 'audio';
/** Документы хранятся с MIME application/octet-stream, поэтому «аудиофайл» узнаём по расширению в имени. */
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
const audioFile = (): Prisma.MessageWhereInput => ({
  kind: 'FILE',
  media: { is: { OR: AUDIO_EXT.map((e) => ({ title: { endsWith: e, mode: 'insensitive' as const } })) } },
});
export async function listShared(userId: string, chatId: string, tab: SharedTab, limit = 60) {
  await assertMember(chatId, userId);
  const where: Prisma.MessageWhereInput = { chatId, deletedAt: null, viewOnce: false, hides: { none: { userId } } };
  if (tab === 'media') where.kind = { in: ['IMAGE', 'VIDEO'] };
  else if (tab === 'voice') where.kind = { in: ['VOICE', 'VIDEO_NOTE'] };
  else if (tab === 'music') where.AND = [audioFile()];
  else if (tab === 'audio') where.OR = [{ kind: 'VOICE' }, audioFile()];
  else if (tab === 'files') { where.kind = 'FILE'; where.NOT = audioFile(); }
  else Object.assign(where, { kind: 'TEXT', OR: [{ text: { contains: 'http://' } }, { text: { contains: 'https://' } }] });
  const rows = await prisma.message.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, include: messageInclude });
  return rows.map(toMessageDTO);
} 

// ───────────────────────── удаление чата из списка и выход владельца ─────────────────────────

/** «Удалить чат» (личный диалог): исчезает из МОЕГО списка вместе с прошлой перепиской. Собеседник ничего не теряет. Новое сообщение вернёт диалог. */
export async function hideChat(userId: string, chatId: string) {
  const m = await assertMember(chatId, userId);
  if (m.chat.type !== 'DIRECT') throw new HttpError(400, 'bad_request');
  const now = new Date();
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { hiddenAt: now, lastReadAt: now, pinnedAt: null } });
  return { ok: true };
}

/** «Очистить чат» (любой тип): вся текущая переписка скрывается ТОЛЬКО у меня, чат остаётся в списке. */
export async function clearChatForMe(userId: string, chatId: string) {
  await assertMember(chatId, userId);
  const rows = await prisma.message.findMany({
    where: { chatId, deletedAt: null, hides: { none: { userId } } },
    select: { id: true },
  });
  for (let i = 0; i < rows.length; i += 2000) {
    await prisma.messageHide.createMany({
      data: rows.slice(i, i + 2000).map((r) => ({ messageId: r.id, userId })),
      skipDuplicates: true,
    });
  }
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId } }, data: { lastReadAt: new Date() } });
  return { ok: true, cleared: rows.length };
}

/**
 * Выйти из группы/канала. Обычный участник просто выходит. ВЛАДЕЛЕЦ тоже может выйти:
 *   mode=transfer — права владельца переходят новому владельцу (указанному, иначе — старшему админу, иначе — самому раннему участнику);
 *   mode=delete   — группа/канал удаляется полностью для всех.
 * Если кроме владельца в чате никого нет — чат удаляется.
 */
export async function leaveChat(userId: string, chatId: string, opts: { mode?: 'transfer' | 'delete'; newOwnerId?: string } = {}) {
  const m = await assertMember(chatId, userId);
  if (!isGroupType(m.chat.type)) throw new HttpError(400, 'not_a_group');
  if (m.role !== 'OWNER') {
    await prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId } } });
    return { deleted: false, newOwnerId: null as string | null, memberIds: [] as string[] };
  }
  const others = await prisma.chatMember.findMany({ where: { chatId, userId: { not: userId } }, orderBy: { joinedAt: 'asc' }, select: { userId: true, role: true } });
  if (opts.mode === 'delete' || !others.length) {
    const memberIds = [userId, ...others.map((o) => o.userId)];
    const media = await prisma.message.findMany({ where: { chatId, mediaId: { not: null } }, select: { mediaId: true } });
    const avatar = m.chat.avatarMediaId;
    await prisma.chat.delete({ where: { id: chatId } });   // сообщения и участники удаляются каскадом
    const ids = new Set<string>(media.map((x: { mediaId: string | null }) => x.mediaId as string)); if (avatar) ids.add(avatar);
    for (const id of ids) await gcMedia(id).catch(() => {}); // файлы, на которые больше никто не ссылается, стираем
    return { deleted: true, newOwnerId: null, memberIds };
  }
  const heir = opts.newOwnerId ? others.find((o) => o.userId === opts.newOwnerId) : (others.find((o) => o.role === 'ADMIN') ?? others[0]);
  if (!heir) throw new HttpError(400, 'bad_owner');
  await prisma.$transaction([
    prisma.chatMember.update({ where: { chatId_userId: { chatId, userId: heir.userId } }, data: { role: 'OWNER' } }),
    prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId } } }),
  ]);
  return { deleted: false, newOwnerId: heir.userId, memberIds: [] as string[] };
}

/**
 * Автодополнение @упоминаний в поле ввода: кого можно упомянуть в этом чате.
 * Группа — все участники; канал — только владелец и админы (подписчики друг друга не видят); личный чат — собеседник.
 */
export async function mentionCandidatesForChat(userId: string, chatId: string, rawQuery: string) {
  const m = await assertMember(chatId, userId);
  const q = rawQuery.replace(/^@/, '').trim().toLowerCase().slice(0, 30);
  if (m.chat.type === 'SAVED') return [];
  const rows = await prisma.chatMember.findMany({
    where: {
      chatId, userId: { not: userId },
      ...(m.chat.type === 'CHANNEL' ? { role: { in: ['OWNER', 'ADMIN'] as MemberRole[] } } : {}),
      ...(q ? { user: { OR: [{ username: { contains: q } }, { name: { contains: q, mode: 'insensitive' as const } }] } } : {}),
    },
    include: { user: { select: { id: true, username: true, name: true, avatarUrl: true, verified: true } } },
    orderBy: { joinedAt: 'asc' },
    take: 40,
  });
  const score = (u: { username: string; name: string }) => (!q ? 0 : u.username.startsWith(q) ? 0 : u.name.toLowerCase().startsWith(q) ? 1 : 2);
  return rows
    .map((r) => r.user)
    .sort((a, b) => score(a) - score(b))
    .slice(0, 8)
    .map((u) => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl, verified: u.verified }));
}
