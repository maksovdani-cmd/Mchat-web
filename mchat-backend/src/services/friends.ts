import { prisma } from '../db';
import { emitToUser, isActive } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { normalizeUsername } from '../utils/validate';
import { publicUserSelect } from './chat';
import { sendPushToUser } from './push';

/**
 * «Подписаться» вместо «Добавить в друзья».
 *  none      — между нами ничего нет
 *  following — я подписан на него
 *  follower  — он подписан на меня, я на него — нет
 *  friends   — подписки взаимные (статус «Друзья» выставляется автоматически)
 */
export type FriendState = 'none' | 'following' | 'follower' | 'friends';
export interface FriendInfo { status: FriendState; id: null }

const stateOf = (iFollow: boolean, heFollows: boolean): FriendState =>
  iFollow && heFollows ? 'friends' : iFollow ? 'following' : heFollows ? 'follower' : 'none';

export async function friendInfo(me: string, other: string): Promise<FriendInfo> {
  const rows = await prisma.follow.findMany({
    where: { OR: [{ followerId: me, followingId: other }, { followerId: other, followingId: me }] },
    select: { followerId: true },
  });
  return { status: stateOf(rows.some((r) => r.followerId === me), rows.some((r) => r.followerId === other)), id: null };
}

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

const toPublic = (u: { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean }) => ({
  id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl, verified: u.verified,
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
