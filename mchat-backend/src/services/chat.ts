import { Prisma, type MemberRole, type MessageKind } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../utils/errors';
import { randomToken } from '../utils/crypto';
import { normalizeUsername } from '../utils/validate';
import { gcMedia, mediaUrl } from './media';
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
} as const;

export const messageInclude = {
  sender: { select: { id: true, name: true, username: true } },
  replyTo: { select: { id: true, text: true, kind: true, deletedAt: true, sender: { select: { id: true, name: true } } } },
  reactions: { select: { emoji: true, userId: true } },
  media: { select: { title: true, size: true } },
} satisfies Prisma.MessageInclude;
export type FullMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export interface ReactionDTO { emoji: string; userIds: string[] }
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
}

export const previewOf = (kind: MessageKind, text: string) =>
  kind === 'TEXT' ? text : kind === 'VOICE' ? '🎤 Голосовое сообщение' : kind === 'VIDEO_NOTE' ? '🎥 Видеосообщение'
    : kind === 'VIDEO' ? '🎬 Видео' : kind === 'FILE' ? '📎 Файл' : '📷 Фото';

export const groupReactions = (list: { emoji: string; userId: string }[]): ReactionDTO[] => {
  const map = new Map<string, string[]>();
  for (const r of list) map.set(r.emoji, [...(map.get(r.emoji) ?? []), r.userId]);
  return [...map].map(([emoji, userIds]) => ({ emoji, userIds }));
};

export const toMessageDTO = (m: FullMessage): MessageDTO => ({
  id: m.id,
  chatId: m.chatId,
  senderId: m.senderId,
  senderName: m.sender?.name ?? null,
  senderUsername: m.sender?.username ?? null,
  kind: m.kind,
  text: m.text,
  mediaUrl: m.mediaId ? mediaUrl(m.mediaId) : null,
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
});

// ───────────────────────── права ─────────────────────────

/**
 * ГЛАВНАЯ проверка прав. Каждый REST-запрос и каждое socket-событие, которое
 * касается чата, проходит через неё. Не участник получает 404 — существование чата не раскрываем.
 */
export async function assertMember(chatId: string, userId: string) {
  const m = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    include: { chat: { select: { type: true, pinnedMessageId: true, title: true } } },
  });
  if (!m) throw new HttpError(404, 'chat_not_found');
  return m;
}
/** В канале писать могут только владелец и админы. */
export const canPost = (type: string, role: MemberRole) => type !== 'CHANNEL' || role !== 'MEMBER';
/** В группах/каналах модерировать (удалять чужое, закреплять) могут владелец и админы. */
export const canModerate = (type: string, role: MemberRole) => type !== 'DIRECT' && role !== 'MEMBER';

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

export async function createGroupOrChannel(
  userId: string,
  type: 'GROUP' | 'CHANNEL',
  title: string,
  description: string | undefined,
  usernames: string[],
) {
  const names = [...new Set(usernames.map(normalizeUsername))].slice(0, MAX_GROUP_INITIAL_MEMBERS);
  const users = names.length ? await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true } }) : [];
  const memberIds = users.map((u) => u.id).filter((id) => id !== userId);
  const chat = await prisma.chat.create({
    data: {
      type,
      title,
      description: description || null,
      inviteCode: randomToken(12),
      members: { create: [{ userId, role: 'OWNER' }, ...memberIds.map((id) => ({ userId: id }))] },
    },
  });
  return { chatId: chat.id, memberIds: [userId, ...memberIds] };
}

export async function joinByInvite(userId: string, code: string) {
  const chat = await prisma.chat.findUnique({ where: { inviteCode: code }, select: { id: true, type: true } });
  if (!chat || chat.type === 'DIRECT') throw new HttpError(404, 'invite_not_found');
  await prisma.chatMember.createMany({ data: [{ chatId: chat.id, userId }], skipDuplicates: true });
  return chat.id;
}

export async function getChatDTO(userId: string, chatId: string) {
  const m = await assertMember(chatId, userId);
  const chat = await prisma.chat.findUniqueOrThrow({
    where: { id: chatId },
    include: { _count: { select: { members: true } } },
  });

  const [last, unread, pinned, peerMember] = await Promise.all([
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
  ]);

  const peer = peerMember?.user ?? null;
  const isDirect = chat.type === 'DIRECT';
  const lastText = last ? previewOf(last.kind, last.text) : '';
  return {
    id: chatId,
    type: chat.type,
    name: isDirect ? peer?.name ?? 'Чат' : chat.title ?? 'Чат',
    description: chat.description,
    avatar: isDirect ? peer?.avatarUrl ?? null : chat.avatarMediaId ? mediaUrl(chat.avatarMediaId) : null,
    /** до какого момента собеседник прочитал чат (null — скрыл статус или это не личный чат) */
    peerReadAt: isDirect && peerMember && !peerMember.user.hideRead ? peerMember.lastReadAt.toISOString() : null,
    role: m.role,
    canPost: canPost(chat.type, m.role),
    canModerate: canModerate(chat.type, m.role),
    memberCount: chat._count.members,
    inviteCode: !isDirect && m.role !== 'MEMBER' ? chat.inviteCode : null,
    peer: peer && {
      id: peer.id,
      username: peer.username,
      name: peer.name,
      avatar: peer.avatarUrl,
      verified: peer.verified,
      ...visiblePresence(peer),
    },
    lastMessage: last && { text: lastText, createdAt: last.createdAt.toISOString(), senderId: last.senderId },
    lastMessageAt: chat.lastMessageAt.toISOString(),
    unread,
    pinned: pinned && toMessageDTO(pinned),
  };
}

export async function listChats(userId: string) {
  const memberships = await prisma.chatMember.findMany({
    where: {
      userId,
      // личные диалоги без сообщений не показываем; группы и каналы — всегда
      chat: { OR: [{ type: { not: 'DIRECT' } }, { messages: { some: { deletedAt: null } } }] },
    },
    orderBy: { chat: { lastMessageAt: 'desc' } },
    select: { chatId: true },
    take: 200,
  });
  // N+1 запросов на чат — для первой версии нормально; при росте заменить на один SQL с агрегатами
  return Promise.all(memberships.map((m) => getChatDTO(userId, m.chatId)));
}

export async function listMessages(userId: string, chatId: string, before: string | undefined, limit: number) {
  await assertMember(chatId, userId);
  const rows = await prisma.message.findMany({
    where: { chatId, deletedAt: null, hides: { none: { userId } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: messageInclude,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse(); // клиенту удобнее от старых к новым
  return { messages: page.map(toMessageDTO), hasMore };
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
}

export async function createMessage(userId: string, chatId: string, input: CreateInput) {
  const member = await assertMember(chatId, userId);
  if (!canPost(member.chat.type, member.role)) throw new HttpError(403, 'channel_read_only');

  const kind = input.kind ?? 'TEXT';
  const text = (input.text ?? '').trim();
  if (kind === 'TEXT' && !text) throw new HttpError(400, 'empty_message');
  if (text.length > MAX_TEXT) throw new HttpError(400, 'message_too_long');

  let mediaId: string | null = null;
  let durationSec: number | null = null;
  if (kind !== 'TEXT') {
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
          chatId, senderId: userId, kind, text, mediaId, durationSec,
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
  const { msg } = await loadVisibleMessage(userId, messageId); // видеть исходное сообщение обязан
  const author = msg.senderId ? await prisma.user.findUnique({ where: { id: msg.senderId }, select: { name: true } }) : null;
  return createMessage(userId, targetChatId, {
    kind: msg.kind,
    text: msg.text,
    mediaId: msg.mediaId ?? undefined,
    durationSec: msg.durationSec ?? undefined,
    forwardedFromName: msg.forwardedFromName ?? author?.name ?? 'Удалённый аккаунт',
    trustedMedia: true,
    clientId,
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
  const all = await prisma.reaction.findMany({ where: { messageId }, select: { emoji: true, userId: true } });
  return { chatId: msg.chatId, id: messageId, reactions: groupReactions(all) };
}

export async function pinMessage(userId: string, chatId: string, messageId: string | null) {
  const m = await assertMember(chatId, userId);
  if (m.chat.type !== 'DIRECT' && m.role === 'MEMBER') throw new HttpError(403, 'forbidden');
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
  if (m.chat.type === 'DIRECT') throw new HttpError(400, 'not_a_group');
  if (!isStaff(m.role)) throw new HttpError(403, 'forbidden');
  const data: Prisma.ChatUpdateInput = {};
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
  if (m.chat.type === 'DIRECT') throw new HttpError(400, 'not_a_group');
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
    id: r.user.id, username: r.user.username, name: r.user.name, avatar: r.user.avatarUrl, verified: r.user.verified, role: r.role,
  }));
}

/** Добавить людей можно только из своего списка друзей — чужих в группу не затащишь. */
export async function addMembers(userId: string, chatId: string, userIds: string[]) {
  const m = await assertMember(chatId, userId);
  if (m.chat.type === 'DIRECT') throw new HttpError(400, 'not_a_group');
  if (!isStaff(m.role)) throw new HttpError(403, 'forbidden');
  const ids = [...new Set(userIds)].filter((u) => u !== userId);
  if (!ids.length) return [];
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId, addresseeId: { in: ids } }, { addresseeId: userId, requesterId: { in: ids } }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = new Set(friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)));
  if (ids.some((u) => !friendIds.has(u))) throw new HttpError(403, 'not_a_friend');
  const before = await prisma.chatMember.count({ where: { chatId } });
  if (before + ids.length > MAX_GROUP_MEMBERS) throw new HttpError(400, 'group_full');
  await prisma.chatMember.createMany({ data: ids.map((u) => ({ chatId, userId: u })), skipDuplicates: true });
  return ids;
}

/** Удалить участника (владелец — любого, админ — только обычных) либо выйти самому. */
export async function removeMember(userId: string, chatId: string, targetId: string) {
  const m = await assertMember(chatId, userId);
  if (m.chat.type === 'DIRECT') throw new HttpError(400, 'not_a_group');
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
  if (m.chat.type === 'DIRECT') throw new HttpError(400, 'not_a_group');
  if (m.role !== 'OWNER') throw new HttpError(403, 'forbidden');
  if (targetId === userId) throw new HttpError(400, 'cannot_change_owner');
  const target = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId: targetId } } });
  if (!target) throw new HttpError(404, 'member_not_found');
  if (target.role === 'OWNER') throw new HttpError(400, 'cannot_change_owner');
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId: targetId } }, data: { role } });
}
