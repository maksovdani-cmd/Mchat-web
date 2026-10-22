import { prisma } from '../db';
import { HttpError } from '../utils/errors';

export const ALLOWED_DAYS = [5, 10, 15, 30] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function assertAdmin(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!u || u.role !== 'ADMIN') throw new HttpError(403, 'forbidden');
}

export async function myVerification(userId: string) {
  const [u, last] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { verified: true, verifiedAt: true, verifiedUntil: true } }),
    prisma.verifyRequest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);
  return {
    verified: u.verified,
    verifiedAt: u.verifiedAt?.toISOString() ?? null,
    verifiedUntil: u.verifiedUntil?.toISOString() ?? null,
    request: last ? { id: last.id, status: last.status, createdAt: last.createdAt.toISOString() } : null,
  };
}

export async function createRequest(userId: string, reason: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { verified: true } });
  if (u.verified) throw new HttpError(409, 'already_verified');
  const pending = await prisma.verifyRequest.findFirst({ where: { userId, status: 'PENDING' } });
  if (pending) throw new HttpError(409, 'request_pending');
  const r = await prisma.verifyRequest.create({ data: { userId, reason } });
  return { id: r.id, status: r.status };
}

const userSel = { id: true, username: true, name: true, avatarUrl: true, verified: true, verifiedAt: true, verifiedUntil: true } as const;

/** Для панели админа: все запросы + список тех, у кого галочка действует сейчас. */
export async function adminOverview() {
  const [requests, verified] = await Promise.all([
    prisma.verifyRequest.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100, include: { user: { select: userSel } } }),
    prisma.user.findMany({ where: { verified: true }, orderBy: { verifiedAt: 'desc' }, take: 200, select: userSel }),
  ]);
  const shape = (u: (typeof verified)[number]) => ({
    id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl,
    verified: u.verified, verifiedAt: u.verifiedAt?.toISOString() ?? null, verifiedUntil: u.verifiedUntil?.toISOString() ?? null,
  });
  return {
    requests: requests.map((r) => ({
      id: r.id, reason: r.reason, status: r.status, days: r.days,
      createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, user: shape(r.user),
    })),
    verified: verified.map(shape),
  };
}

/**
 * Выдать галочку напрямую (без запроса): days = 5/15/30 (или 10) либо null — «навсегда».
 * Если у человека уже есть галочка — срок заменяется новым, отсчёт идёт от сегодняшнего дня.
 */
export async function grantByUsername(rawUsername: string, days: number | null) {
  if (days !== null && !(ALLOWED_DAYS as readonly number[]).includes(days)) throw new HttpError(400, 'bad_days');
  const username = rawUsername.trim().replace(/^@/, '').toLowerCase();
  const u = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: u.id },
      data: { verified: true, verifiedAt: now, verifiedUntil: days === null ? null : new Date(now.getTime() + days * DAY_MS) },
    }),
    // открытые запросы этого человека считаем решёнными
    prisma.verifyRequest.updateMany({ where: { userId: u.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedAt: now, days } }),
  ]);
  return { ok: true };
}

/** Поиск людей для выдачи галочки в панели админа. */
export async function adminFindUsers(q: string) {
  const s = q.trim().replace(/^@/, '');
  if (!s) return [];
  const rows = await prisma.user.findMany({
    where: { OR: [{ username: { contains: s, mode: 'insensitive' } }, { name: { contains: s, mode: 'insensitive' } }] },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: userSel,
  });
  return rows.map((u) => ({
    id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl,
    verified: u.verified, verifiedAt: u.verifiedAt?.toISOString() ?? null, verifiedUntil: u.verifiedUntil?.toISOString() ?? null,
  }));
}

/** Одобрить: days = 5/10/15/30 или null («навсегда»). Дата выдачи фиксируется, срок считается от неё. */
export async function approve(requestId: number, days: number | null) {
  if (days !== null && !(ALLOWED_DAYS as readonly number[]).includes(days)) throw new HttpError(400, 'bad_days');
  const r = await prisma.verifyRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new HttpError(404, 'request_not_found');
  if (r.status !== 'PENDING') throw new HttpError(409, 'request_decided');
  const now = new Date();
  await prisma.$transaction([
    prisma.verifyRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', decidedAt: now, days } }),
    prisma.user.update({
      where: { id: r.userId },
      data: { verified: true, verifiedAt: now, verifiedUntil: days === null ? null : new Date(now.getTime() + days * DAY_MS) },
    }),
  ]);
  return { ok: true };
}

export async function reject(requestId: number) {
  const r = await prisma.verifyRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new HttpError(404, 'request_not_found');
  if (r.status !== 'PENDING') throw new HttpError(409, 'request_decided');
  await prisma.verifyRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', decidedAt: new Date() } });
  return { ok: true };
}

/** Снять галочку раньше срока. */
export async function revoke(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  await prisma.user.update({ where: { id: userId }, data: { verified: false, verifiedAt: null, verifiedUntil: null } });
  return { ok: true };
}

/** Срок вышел — галочка исчезает. Вызывается при старте и каждые 5 минут. */
export async function expireVerifications() {
  const r = await prisma.user.updateMany({
    where: { verified: true, verifiedUntil: { not: null, lt: new Date() } },
    data: { verified: false, verifiedAt: null, verifiedUntil: null },
  });
  return r.count;
}
