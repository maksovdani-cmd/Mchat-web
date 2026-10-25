import { prisma } from '../db';
import { emitToUser } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { assertMember, isGroupType, MAX_GROUP_MEMBERS } from './chat';
import { mediaUrl } from './media';
import { sendPushToUser } from './push';

/**
 * Заявки на вступление в приватные каналы и группы.
 *
 * Поток: человек открывает /join/<код> → видит карточку чата и кнопку «Отправить заявку» →
 * создаётся ChatJoinRequest(PENDING) → владельцу и админам уходит событие `chat:join-request` (сокет) и пуш →
 * они принимают или отклоняют → заявитель получает `chat:join-approved` / `chat:join-declined`.
 */

const isStaffRole = (role: string) => role === 'OWNER' || role === 'ADMIN';
const requesterSelect = { id: true, username: true, name: true, avatarUrl: true, verified: true } as const;

type Requester = { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean };
const toDTO = (r: { id: string; chatId: string; createdAt: Date; user: Requester }, chatName: string) => ({
  id: r.id,
  chatId: r.chatId,
  chatName,
  createdAt: r.createdAt.toISOString(),
  user: { id: r.user.id, username: r.user.username, name: r.user.name, avatar: r.user.avatarUrl, verified: r.user.verified },
});

/** Карточка чата по ссылке-приглашению (до вступления): название, аватарка, число участников и что человек может сделать. */
export async function invitePreview(userId: string, code: string) {
  const chat = await prisma.chat.findUnique({
    where: { inviteCode: code },
    include: { _count: { select: { members: true } }, members: { where: { userId }, select: { role: true } } },
  });
  if (!chat || !isGroupType(chat.type)) throw new HttpError(404, 'invite_not_found');
  const member = chat.members[0] ?? null;
  const req = member ? null : await prisma.chatJoinRequest.findUnique({ where: { chatId_userId: { chatId: chat.id, userId } }, select: { status: true } });
  // state: member — уже внутри; open — можно войти сразу; request — нужна заявка; pending — заявка ждёт решения; declined — отклонена (можно подать снова)
  const state = member ? 'member' : !chat.isPrivate ? 'open' : req?.status === 'PENDING' ? 'pending' : req?.status === 'DECLINED' ? 'declined' : 'request';
  return {
    code,
    type: chat.type,
    name: chat.title ?? (chat.type === 'CHANNEL' ? 'Канал' : 'Группа'),
    description: chat.description,
    avatar: chat.avatarMediaId ? mediaUrl(chat.avatarMediaId) : null,
    memberCount: chat._count.members,
    isPrivate: chat.isPrivate,
    state,
    chatId: member ? chat.id : null, // id раскрываем только участнику
  };
}

/** Нажатие «Отправить заявку» (или «Вступить» в обычной группе). */
export async function requestJoin(userId: string, code: string) {
  const chat = await prisma.chat.findUnique({ where: { inviteCode: code }, select: { id: true, type: true, title: true, isPrivate: true } });
  if (!chat || !isGroupType(chat.type)) throw new HttpError(404, 'invite_not_found');

  const existing = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: chat.id, userId } }, select: { userId: true } });
  if (existing) return { status: 'member' as const, chatId: chat.id };

  if (!chat.isPrivate) {
    const count = await prisma.chatMember.count({ where: { chatId: chat.id } });
    if (count >= MAX_GROUP_MEMBERS) throw new HttpError(400, 'group_full');
    await prisma.chatMember.createMany({ data: [{ chatId: chat.id, userId }], skipDuplicates: true });
    return { status: 'joined' as const, chatId: chat.id };
  }

  const prev = await prisma.chatJoinRequest.findUnique({ where: { chatId_userId: { chatId: chat.id, userId } }, select: { status: true } });
  if (prev?.status === 'PENDING') return { status: 'pending' as const, chatId: chat.id };
  const row = await prisma.chatJoinRequest.upsert({
    where: { chatId_userId: { chatId: chat.id, userId } },
    create: { chatId: chat.id, userId },
    update: { status: 'PENDING', createdAt: new Date(), decidedAt: null, decidedById: null }, // отклонённый может подать заявку снова
    include: { user: { select: requesterSelect } },
  });

  // владельцу и админам — системное уведомление с кнопками «Принять / Отклонить» + пуш (если приложение закрыто)
  const staff = await prisma.chatMember.findMany({ where: { chatId: chat.id, role: { in: ['OWNER', 'ADMIN'] } }, select: { userId: true } });
  const dto = toDTO(row, chat.title ?? 'Канал');
  for (const s of staff) {
    emitToUser(s.userId, 'chat:join-request', dto);
    sendPushToUser(s.userId, {
      title: chat.title ?? 'Заявка на вступление',
      body: `${row.user.name} (@${row.user.username}) хочет вступить`,
      tag: `join:${chat.id}`,
      data: { kind: 'join-request', chatId: chat.id },
    }).catch(() => {});
  }
  return { status: 'pending' as const, chatId: chat.id };
}

/** Заявки одного чата (только владелец/админ). */
export async function listRequests(userId: string, chatId: string) {
  const m = await assertMember(chatId, userId);
  if (!isStaffRole(m.role)) throw new HttpError(403, 'forbidden');
  const rows = await prisma.chatJoinRequest.findMany({
    where: { chatId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 200, include: { user: { select: requesterSelect } },
  });
  return rows.map((r) => toDTO(r, m.chat.title ?? 'Канал'));
}

/** Все ожидающие заявки по всем чатам, где я владелец или админ (для плашки-уведомления при входе в приложение). */
export async function listAllPending(userId: string) {
  const mine = await prisma.chatMember.findMany({ where: { userId, role: { in: ['OWNER', 'ADMIN'] } }, select: { chatId: true, chat: { select: { title: true } } } });
  if (!mine.length) return [];
  const names = new Map(mine.map((m) => [m.chatId, m.chat.title ?? 'Канал']));
  const rows = await prisma.chatJoinRequest.findMany({
    where: { chatId: { in: [...names.keys()] }, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 200, include: { user: { select: requesterSelect } },
  });
  return rows.map((r) => toDTO(r, names.get(r.chatId) ?? 'Канал'));
}

/** Принять или отклонить заявку. Возвращает id заявителя и всех, кому надо сообщить о решении. */
export async function decideRequest(userId: string, chatId: string, requestId: string, approve: boolean) {
  const m = await assertMember(chatId, userId);
  if (!isStaffRole(m.role)) throw new HttpError(403, 'forbidden');
  const req = await prisma.chatJoinRequest.findUnique({ where: { id: requestId } });
  if (!req || req.chatId !== chatId) throw new HttpError(404, 'request_not_found');
  if (req.status !== 'PENDING') return { requesterId: req.userId, approved: req.status === 'APPROVED', already: true as const };
  if (approve) {
    const count = await prisma.chatMember.count({ where: { chatId } });
    if (count >= MAX_GROUP_MEMBERS) throw new HttpError(400, 'group_full');
    await prisma.$transaction([
      prisma.chatMember.createMany({ data: [{ chatId, userId: req.userId }], skipDuplicates: true }),
      prisma.chatJoinRequest.update({ where: { id: req.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedById: userId } }),
    ]);
  } else {
    await prisma.chatJoinRequest.update({ where: { id: req.id }, data: { status: 'DECLINED', decidedAt: new Date(), decidedById: userId } });
  }
  const staff = await prisma.chatMember.findMany({ where: { chatId, role: { in: ['OWNER', 'ADMIN'] } }, select: { userId: true } });
  for (const s of staff) emitToUser(s.userId, 'chat:join-request-resolved', { id: req.id, chatId, approved: approve }); // у остальных админов плашка исчезнет
  if (!approve) emitToUser(req.userId, 'chat:join-declined', { chatId, chatName: m.chat.title ?? 'Канал' });
  else sendPushToUser(req.userId, { title: m.chat.title ?? 'Mchat', body: 'Ваша заявка принята', tag: `join:${chatId}`, data: { kind: 'message', chatId } }).catch(() => {});
  return { requesterId: req.userId, approved: approve, already: false as const };
}
