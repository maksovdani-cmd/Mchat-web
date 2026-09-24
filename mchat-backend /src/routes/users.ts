import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authOf, requireAuth } from '../middleware/auth';
import { searchLimiter } from '../middleware/security';
import { disconnectUser } from '../realtime/hub';
import { friendInfo } from '../services/friends';
import { toMediaDTO } from '../services/media';
import { announcePresence, visiblePresence } from '../services/presence';
import { publicUserSelect } from '../services/chat';
import { COOKIE, dropCookie, revokeDevice } from '../services/session';
import { HttpError, wrap } from '../utils/errors';
import { cleanQuery, normalizeUsername } from '../utils/validate';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const toPublic = (u: { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean; bio?: string }) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  avatar: u.avatarUrl,
  verified: u.verified,
  ...(u.bio !== undefined ? { bio: u.bio } : {}),
});

usersRouter.get(
  '/me',
  wrap(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: authOf(req).userId } });
    res.json({
      ...toPublic(u),
      bio: u.bio,
      email: u.email,
      role: u.role,
      settings: { notifyMessages: u.notifyMessages, hideOnline: u.hideOnline, hideRead: u.hideRead },
      deviceId: authOf(req).deviceId,
    });
  }),
);

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(40).regex(/^[^<>]+$/),
    bio: z.string().trim().max(160),
    notifyMessages: z.boolean(),
    hideOnline: z.boolean(),
    hideRead: z.boolean(),
  })
  .partial()
  .strict();

usersRouter.patch(
  '/me',
  wrap(async (req, res) => {
    const data = patchSchema.parse(req.body);
    const before = data.hideOnline !== undefined
      ? await prisma.user.findUnique({ where: { id: authOf(req).userId }, select: { hideOnline: true } }) : null;
    const u = await prisma.user.update({ where: { id: authOf(req).userId }, data });
    // переключили «скрыть статус» — все, кто видит нас, должны сразу получить новое состояние
    if (before && before.hideOnline !== u.hideOnline) announcePresence(u.id).catch(() => {});
    res.json({
      ...toPublic(u),
      bio: u.bio,
      settings: { notifyMessages: u.notifyMessages, hideOnline: u.hideOnline, hideRead: u.hideRead },
    });
  }),
);

/** Удаление аккаунта: личные диалоги и все данные стираются безвозвратно. */
usersRouter.delete(
  '/me',
  wrap(async (req, res) => {
    const { userId } = authOf(req);
    await prisma.chat.deleteMany({ where: { type: 'DIRECT', members: { some: { userId } } } });
    await prisma.user.delete({ where: { id: userId } });
    disconnectUser(userId);
    dropCookie(res, COOKIE.session);
    dropCookie(res, COOKIE.device);
    res.json({ ok: true });
  }),
);

usersRouter.get(
  '/users/search',
  searchLimiter,
  wrap(async (req, res) => {
    const q = cleanQuery(typeof req.query.q === 'string' ? req.query.q : '');
    if (q.length < 2) return void res.json({ users: [] });
    const users = await prisma.user.findMany({
      where: {
        id: { not: authOf(req).userId },
        OR: [{ username: { contains: q.toLowerCase() } }, { name: { contains: q, mode: 'insensitive' } }],
      },
      select: publicUserSelect,
      orderBy: [{ verified: 'desc' }, { username: 'asc' }],
      take: 8,
    });
    res.json({ users: users.map(toPublic) });
  }),
);

usersRouter.get(
  '/users/:username/tracks',
  wrap(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { username: normalizeUsername(String(req.params.username)) }, select: { id: true, username: true } });
    if (!u) throw new HttpError(404, 'user_not_found');
    const tracks = await prisma.media.findMany({ where: { ownerId: u.id, kind: 'TRACK' }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ tracks: tracks.map((t) => ({ ...toMediaDTO(t), artist: '@' + u.username })) });
  }),
);

usersRouter.get(
  '/users/:username',
  wrap(async (req, res) => {
    const me = authOf(req).userId;
    const u = await prisma.user.findUnique({
      where: { username: normalizeUsername(String(req.params.username)) },
      select: { ...publicUserSelect, bio: true, hideOnline: true, lastSeenAt: true },
    });
    if (!u) throw new HttpError(404, 'user_not_found');
    const [friendship, tracks] = await Promise.all([
      u.id === me ? { status: 'self', id: null } : friendInfo(me, u.id),
      prisma.media.count({ where: { ownerId: u.id, kind: 'TRACK' } }),
    ]);
    res.json({ ...toPublic(u), ...visiblePresence(u), friendship, tracksCount: tracks });
  }),
);

usersRouter.get(
  '/me/tracks',
  wrap(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: authOf(req).userId }, select: { username: true } });
    const tracks = await prisma.media.findMany({ where: { ownerId: authOf(req).userId, kind: 'TRACK' }, orderBy: { createdAt: 'desc' } });
    res.json({ tracks: tracks.map((t) => ({ ...toMediaDTO(t), artist: '@' + u.username })) });
  }),
);

// ── Устройства («Активные сеансы») ──
usersRouter.get(
  '/me/devices',
  wrap(async (req, res) => {
    const { userId, deviceId } = authOf(req);
    const devices = await prisma.device.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
    res.json({
      devices: devices.map((d) => ({
        id: d.id, label: d.label, ip: d.ip,
        createdAt: d.createdAt.toISOString(), lastUsedAt: d.lastUsedAt.toISOString(),
        current: d.id === deviceId,
      })),
    });
  }),
);

usersRouter.delete(
  '/me/devices/:id',
  wrap(async (req, res) => {
    const ok = await revokeDevice(authOf(req).userId, String(req.params.id));
    if (!ok) throw new HttpError(404, 'device_not_found');
    res.json({ ok: true });
  }),
);
