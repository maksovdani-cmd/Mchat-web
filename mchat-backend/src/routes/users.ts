import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authOf, requireAuth } from '../middleware/auth';
import { searchLimiter } from '../middleware/security';
import { disconnectUser } from '../realtime/hub';
import { followCounts, friendInfo, isFollowing } from '../services/friends';
import { hasActiveMoment } from '../services/moments';
import { gcMedia, mediaUrl, toMediaDTO } from '../services/media';
import { announcePresence, visiblePresence } from '../services/presence';
import { publicUserSelect } from '../services/chat';
import { COOKIE, dropCookie, revokeDevice } from '../services/session';
import { HttpError, wrap } from '../utils/errors';
import { cleanQuery, displayNameAllowed, normalizeUsername } from '../utils/validate';

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

/**
 * Трек из профиля: {id, title, url, artist} или null (если трека больше нет).
 * Это может быть и свой трек, и трек из чужого профиля, который человек сохранил себе.
 */
const trackOf = async (id: string | null) => {
  if (!id) return null;
  const m = await prisma.media.findFirst({ where: { id, kind: 'TRACK' }, include: { owner: { select: { username: true } } } });
  return m ? { id: m.id, title: m.title || 'Без названия', url: mediaUrl(m.id), artist: '@' + m.owner.username, durationSec: m.durationSec } : null;
};
/** Можно ли ставить этот трек себе в профиль: свой или сохранённый. */
const canUseTrack = async (userId: string, id: string) => {
  const m = await prisma.media.findFirst({ where: { id, kind: 'TRACK' }, select: { ownerId: true } });
  if (!m) return false;
  if (m.ownerId === userId) return true;
  return (await prisma.savedTrack.count({ where: { userId, mediaId: id } })) > 0;
};

usersRouter.get(
  '/me',
  wrap(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: authOf(req).userId } });
    res.json({
      ...toPublic(u),
      bio: u.bio,
      email: u.email,
      banner: u.bannerUrl,
      ...(await followCounts(u.id)),
      musicTrack: await trackOf(u.musicTrack),
      momentActive: await hasActiveMoment(u.id),
      role: u.role,
      settings: { notifyMessages: u.notifyMessages, hideOnline: u.hideOnline, hideRead: u.hideRead, hideFollowing: u.hideFollowing },
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
    hideFollowing: z.boolean(),
    avatarMediaId: z.string().min(1).max(40).nullable(),
    bannerMediaId: z.string().min(1).max(40).nullable(),
    musicTrack: z.string().min(1).max(40).nullable(),
  })
  .partial()
  .strict();

usersRouter.patch(
  '/me',
  wrap(async (req, res) => {
    const userId = authOf(req).userId;
    // @username — неизменяемый идентификатор: менять его через API нельзя ни при каких условиях
    if (req.body && typeof req.body === 'object' && ('username' in req.body || 'email' in req.body || 'role' in req.body || 'verified' in req.body)) {
      throw new HttpError(400, 'username_immutable');
    }
    const { avatarMediaId, bannerMediaId, musicTrack, ...rest } = patchSchema.parse(req.body);
    // Display Name можно менять и повторять, но нецензурное и оскорбительное (в том числе внутри слова) — нельзя
    if (rest.name !== undefined && !displayNameAllowed(rest.name)) throw new HttpError(400, 'name_forbidden');
    const data: Record<string, unknown> = { ...rest };
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { hideOnline: true, avatarUrl: true, bannerUrl: true } });
    // аватар/обложка: только своя картинка; null — убрать
    for (const [key, id] of [['avatarUrl', avatarMediaId], ['bannerUrl', bannerMediaId]] as const) {
      if (id === undefined) continue;
      if (id !== null) {
        const m = await prisma.media.findUnique({ where: { id } });
        if (!m || m.ownerId !== userId || m.kind !== 'IMAGE') throw new HttpError(400, 'bad_media');
      }
      data[key] = id === null ? null : mediaUrl(id);
    }
    if (musicTrack !== undefined) {
      if (musicTrack !== null && !(await canUseTrack(userId, musicTrack))) throw new HttpError(400, 'bad_media');
      data.musicTrack = musicTrack;
    }
    const u = await prisma.user.update({ where: { id: userId }, data });
    // старые файлы аватара/обложки больше не нужны
    for (const old of [data.avatarUrl !== undefined ? before?.avatarUrl : null, data.bannerUrl !== undefined ? before?.bannerUrl : null]) {
      const m = old && /^\/api\/media\/([\w-]+)$/.exec(old);
      if (m) gcMedia(m[1]).catch(() => {});
    }
    // переключили «скрыть статус» — все, кто видит нас, должны сразу получить новое состояние
    if (before && before.hideOnline !== u.hideOnline) announcePresence(u.id).catch(() => {});
    res.json({
      ...toPublic(u),
      banner: u.bannerUrl,
      musicTrack: await trackOf(u.musicTrack),
      bio: u.bio,
      settings: { notifyMessages: u.notifyMessages, hideOnline: u.hideOnline, hideRead: u.hideRead, hideFollowing: u.hideFollowing },
    });
  }),
);

/** Удаление аккаунта: личные диалоги и все данные стираются безвозвратно. */
usersRouter.delete(
  '/me',
  wrap(async (req, res) => {
    const { userId } = authOf(req);
    await prisma.chat.deleteMany({ where: { type: { in: ['DIRECT', 'SAVED'] }, members: { some: { userId } } } });
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
    const me = authOf(req).userId;
    const tracks = await prisma.media.findMany({ where: { ownerId: u.id, kind: 'TRACK' }, orderBy: { createdAt: 'desc' }, take: 50 });
    const saved = tracks.length
      ? new Set((await prisma.savedTrack.findMany({ where: { userId: me, mediaId: { in: tracks.map((t) => t.id) } }, select: { mediaId: true } })).map((x) => x.mediaId))
      : new Set<string>();
    res.json({ tracks: tracks.map((t) => ({ ...toMediaDTO(t), artist: '@' + u.username, saved: saved.has(t.id) || t.ownerId === me, mine: t.ownerId === me })) });
  }),
);

usersRouter.get(
  '/users/:username',
  wrap(async (req, res) => {
    const me = authOf(req).userId;
    const u = await prisma.user.findUnique({
      where: { username: normalizeUsername(String(req.params.username)) },
      select: { ...publicUserSelect, bio: true, bannerUrl: true, musicTrack: true, hideOnline: true, hideFollowing: true, lastSeenAt: true },
    });
    if (!u) throw new HttpError(404, 'user_not_found');
    const [friendship, tracks, counts, musicTrack, storyCount, followsAuthor, momentActive] = await Promise.all([
      u.id === me ? { status: 'self', id: null } : friendInfo(me, u.id),
      prisma.media.count({ where: { ownerId: u.id, kind: 'TRACK' } }),
      followCounts(u.id),
      trackOf(u.musicTrack),
      prisma.story.count({ where: { authorId: u.id, expiresAt: { gt: new Date() } } }),
      u.id === me ? true : isFollowing(me, u.id),
      hasActiveMoment(u.id),
    ]);
    res.json({
      ...toPublic(u), banner: u.bannerUrl, ...visiblePresence(u), friendship, tracksCount: tracks, ...counts, musicTrack,
      // активная история: кольцо видят все, а смотреть её могут только подписчики (и сам автор)
      hasStory: storyCount > 0, storiesVisible: followsAuthor,
      followingHidden: u.hideFollowing && u.id !== me,
      momentActive,
    });
  }),
);

/** Сохранённые мной треки из чужих профилей. */
usersRouter.get(
  '/me/saved-tracks',
  wrap(async (req, res) => {
    const rows = await prisma.savedTrack.findMany({
      where: { userId: authOf(req).userId }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { media: { include: { owner: { select: { username: true } } } } },
    });
    res.json({ tracks: rows.map((r) => ({ ...toMediaDTO(r.media), artist: '@' + r.media.owner.username, saved: true })) });
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