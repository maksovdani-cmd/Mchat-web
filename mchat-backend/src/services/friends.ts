import { prisma } from '../db';
import { emitToUser, isActive } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { normalizeUsername } from '../utils/validate';
import { publicUserSelect } from './chat';
import { sendPushToUser } from './push';

export type FriendState = 'none' | 'outgoing' | 'incoming' | 'friends';
export interface FriendInfo { status: FriendState; id: string | null }

export async function friendInfo(me: string, other: string): Promise<FriendInfo> {
  const f = await prisma.friendship.findFirst({
    where: { OR: [{ requesterId: me, addresseeId: other }, { requesterId: other, addresseeId: me }] },
  });
  if (!f) return { status: 'none', id: null };
  if (f.status === 'ACCEPTED') return { status: 'friends', id: f.id };
  return { status: f.requesterId === me ? 'outgoing' : 'incoming', id: f.id };
}

const toPublic = (u: { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean }) => ({
  id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl, verified: u.verified,
});

/** Сообщаем второй стороне, что состояние дружбы изменилось (со её точки зрения). */
async function notifyOther(me: string, other: string, status: FriendState, id: string | null) {
  const meUser = await prisma.user.findUnique({ where: { id: me }, select: publicUserSelect });
  if (meUser) emitToUser(other, 'friend:update', { user: toPublic(meUser), status, id });
}

export async function sendRequest(me: string, username: string): Promise<FriendInfo> {
  const other = await prisma.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true } });
  if (!other) throw new HttpError(404, 'user_not_found');
  if (other.id === me) throw new HttpError(400, 'cannot_friend_self');

  const cur = await friendInfo(me, other.id);
  if (cur.status === 'friends') throw new HttpError(409, 'already_friends');
  if (cur.status === 'outgoing') throw new HttpError(409, 'already_sent');
  if (cur.status === 'incoming') return acceptRequest(me, cur.id!); // встречная заявка = сразу дружба

  const f = await prisma.friendship.create({ data: { requesterId: me, addresseeId: other.id } });
  await notifyOther(me, other.id, 'incoming', f.id);
  if (!isActive(other.id)) {
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { name: true, username: true } });
    await sendPushToUser(other.id, {
      title: 'Заявка в друзья', body: `${meUser?.name ?? 'Кто-то'} хочет добавить вас в друзья`,
      tag: 'friend', data: { kind: 'friend', username: meUser?.username },
    });
  }
  return { status: 'outgoing', id: f.id };
}

export async function acceptRequest(me: string, id: string): Promise<FriendInfo> {
  const f = await prisma.friendship.findUnique({ where: { id } });
  if (!f || f.addresseeId !== me) throw new HttpError(404, 'request_not_found');
  if (f.status === 'PENDING') await prisma.friendship.update({ where: { id }, data: { status: 'ACCEPTED' } });
  await notifyOther(me, f.requesterId, 'friends', id);
  return { status: 'friends', id };
}

/** Отклонить входящую / отменить исходящую / удалить из друзей — для любой из сторон. */
export async function removeFriendship(me: string, id: string): Promise<FriendInfo> {
  const f = await prisma.friendship.findUnique({ where: { id } });
  if (!f || (f.requesterId !== me && f.addresseeId !== me)) throw new HttpError(404, 'request_not_found');
  await prisma.friendship.delete({ where: { id } });
  await notifyOther(me, f.requesterId === me ? f.addresseeId : f.requesterId, 'none', null);
  return { status: 'none', id: null };
}

export async function listFriends(me: string) {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: me }, { addresseeId: me }] },
    include: { requester: { select: publicUserSelect }, addressee: { select: publicUserSelect } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const friends = [], incoming = [], outgoing = [];
  for (const f of rows) {
    const other = f.requesterId === me ? f.addressee : f.requester;
    if (f.status === 'ACCEPTED') friends.push({ id: f.id, user: toPublic(other) });
    else if (f.requesterId === me) outgoing.push({ id: f.id, user: toPublic(other) });
    else incoming.push({ id: f.id, user: toPublic(other) });
  }
  return { friends, incoming, outgoing };
}
