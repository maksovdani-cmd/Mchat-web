import { prisma } from '../db';
import { emitToUser, isActive } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { normalizeUsername } from '../utils/validate';
import { publicUserSelect } from './chat';
import { generalOf } from './titles';
import { sendPushToUser } from './push';

/**
 * «Подписаться» вместо «Добавить в друзья».
 *  none      — между нами ничего нет
 *  following — я подписан на него
 *  follower  — он подписан на меня, я на него — нет
 *  friends   — подписки взаимные (статус «Друзья» выставляется автоматически)
 */
export type FriendState = 'none' | 'following' | 'follower' | 'friends';
export interface FriendInfo { status: FriendState; id: null; blockedByMe?: boolean; blockedMe?: boolean }

const stateOf = (iFollow: boolean, heFollows: boolean): FriendState =>
  iFollow && heFollows ? 'friends' : iFollow ? 'following' : heFollows ? 'follower' : 'none';

export async function friendInfo(me: string, other: string): Promise<FriendInfo> {
  const [rows, blocks] = await Promise.all([
    prisma.follow.findMany({
      where: { OR: [{ followerId: me, followingId: other }, { followerId: other, followingId: me }] },
      select: { followerId: true },
    }),
    prisma.block.findMany({
      where: { OR: [{ blockerId: me, blockedId: other }, { blockerId: other, blockedId: me }] },
      select: { blockerId: true },
    }),
  ]);
  return {
    status: stateOf(rows.some((r) => r.followerId === me), rows.some((r) => r.followerId === other)), id: null,
    blockedByMe: blocks.some((b) => b.blockerId === me), blockedMe: blocks.some((b) => b.blockerId === other),
  };
}

/** Подписан ли `viewer` на `author` (истории и их индикатор зависят от этого). */
export const isFollowing = async (viewer: string, author: string) =>
  (await prisma.follow.count({ where: { followerId: viewer, followingId: author } })) > 0;

/** id всех, с кем у пользователя взаимная подписка («друзья»). */
export async function friendIds(userId: string): Promise<string[]> {
  const [out, inc] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
    prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true } }),
  ]);
  const back = new Set(inc.map((r) => r.followerId));
  return out.map((r) => r.followingId).filter((id) => back.has(id));
}

export const followCounts = async (userId: string) => {
  const [followers, following] = await Promise.all([
    prisma.follow.count({ where: { followingId: userId } }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);
  return { followers, following };
};

const toPublic = (u: { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean; generalTitle?: boolean | null; generalStyle?: string | null; }) => ({
  id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl, verified: u.verified, general: generalOf(u),
});

/** Сообщаем второй стороне, что состояние изменилось (с её точки зрения). */
async function notifyOther(me: string, other: string) {
  const [meUser, st] = await Promise.all([
    prisma.user.findUnique({ where: { id: me }, select: publicUserSelect }),
    friendInfo(other, me),
  ]);
  if (meUser) emitToUser(other, 'friend:update', { user: toPublic(meUser), status: st.status, id: null });
}

export async function follow(me: string, username: string): Promise<FriendInfo> {
  const other = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true } });
  if (!other) throw new HttpError(404, 'user_not_found');
  if (other.id === me) throw new HttpError(400, 'cannot_friend_self');
  const blocked = await prisma.block.count({
    where: { OR: [{ blockerId: me, blockedId: other.id }, { blockerId: other.id, blockedId: me }] },
  });
  if (blocked) throw new HttpError(403, 'blocked');
  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: me, followingId: other.id } },
    create: { followerId: me, followingId: other.id }, update: {},
  });
  const st = await friendInfo(me, other.id);
  await notifyOther(me, other.id);
  if (!isActive(other.id)) {
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { name: true, username: true } });
    await sendPushToUser(other.id, {
      title: st.status === 'friends' ? 'Теперь вы друзья' : 'Новый подписчик',
      body: `${meUser?.name ?? 'Кто-то'} ${st.status === 'friends' ? 'подписался(ась) в ответ' : 'подписался(ась) на вас'}`,
      tag: 'friend', data: { kind: 'friend', username: meUser?.username },
    });
  }
  return st;
}

export async function unfollow(me: string, username: string): Promise<FriendInfo> {
  const other = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true } });
  if (!other) throw new HttpError(404, 'user_not_found');
  await prisma.follow.deleteMany({ where: { followerId: me, followingId: other.id } });
  await notifyOther(me, other.id);
  return friendInfo(me, other.id);
}

export async function listFriends(me: string) {
  const [out, inc] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: me }, include: { following: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' }, take: 500 }),
    prisma.follow.findMany({ where: { followingId: me }, include: { follower: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' }, take: 500 }),
  ]);
  const back = new Set(inc.map((r) => r.followerId));
  const mine = new Set(out.map((r) => r.followingId));
  return {
    friends: out.filter((r) => back.has(r.followingId)).map((r) => ({ user: toPublic(r.following) })),
    following: out.map((r) => ({ user: toPublic(r.following) })),
    followers: inc.map((r) => ({ user: toPublic(r.follower), followedBack: mine.has(r.followerId) })),
  };
}

// ───────────────────────── списки подписчиков / подписок ─────────────────────────

/**
 * Список «Подписчики» или «Подписки» пользователя (открывается по нажатию на счётчик в профиле).
 * Приватность: если владелец включил «Скрыть подписки», другие не видят, на кого он подписан;
 * и его самого нет в чужих списках подписчиков — иначе подписку можно было бы вычислить с другой стороны.
 */
export async function listFollowsOf(viewerId: string, username: string, kind: 'followers' | 'following') {
  const u = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true, hideFollowing: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  const self = u.id === viewerId;
  if (kind === 'following' && u.hideFollowing && !self) return { hidden: true, users: [] as ReturnType<typeof toPublic>[] };
  const rows = kind === 'followers'
    ? await prisma.follow.findMany({
        where: { followingId: u.id, ...(self ? {} : { OR: [{ followerId: viewerId }, { follower: { hideFollowing: false } }] }) },
        include: { follower: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' }, take: 500,
      })
    : await prisma.follow.findMany({
        where: { followerId: u.id }, include: { following: { select: publicUserSelect } }, orderBy: { createdAt: 'desc' }, take: 500,
      });
  const users = rows.map((r) => toPublic('follower' in r ? r.follower : r.following));
  const mine = users.length
    ? new Set((await prisma.follow.findMany({ where: { followerId: viewerId, followingId: { in: users.map((x) => x.id) } }, select: { followingId: true } })).map((f) => f.followingId))
    : new Set<string>();
  return { hidden: false, users: users.map((x) => ({ ...x, iFollow: mine.has(x.id), isMe: x.id === viewerId })) };
}

// ───────────────────────── чёрный список ─────────────────────────

export async function blockUser(me: string, username: string): Promise<FriendInfo> {
  const other = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true, role: true } });
  if (!other) throw new HttpError(404, 'user_not_found');
  if (other.id === me) throw new HttpError(400, 'cannot_block_self');
  if (other.role === 'ADMIN') throw new HttpError(403, 'cannot_block_admin'); // техподдержку не блокируем
  await prisma.$transaction([
    prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: me, blockedId: other.id } }, create: { blockerId: me, blockedId: other.id }, update: {} }),
    // заблокированный больше не подписчик и не друг
    prisma.follow.deleteMany({ where: { OR: [{ followerId: me, followingId: other.id }, { followerId: other.id, followingId: me }] } }),
  ]);
  await notifyOther(me, other.id);
  emitToUser(other.id, 'chat:changed', {});
  return friendInfo(me, other.id);
}

export async function unblockUser(me: string, username: string): Promise<FriendInfo> {
  const other = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true } });
  if (!other) throw new HttpError(404, 'user_not_found');
  await prisma.block.deleteMany({ where: { blockerId: me, blockedId: other.id } });
  await notifyOther(me, other.id);
  emitToUser(other.id, 'chat:changed', {});
  return friendInfo(me, other.id);
}

export async function listBlocked(me: string) {
  const rows = await prisma.block.findMany({
    where: { blockerId: me }, orderBy: { createdAt: 'desc' }, take: 500, include: { blocked: { select: publicUserSelect } },
  });
  return rows.map((r) => toPublic(r.blocked));
}