/**
 * «Момент» — живой дневник: фото/видео + короткая заметка + трек дня.
 * Свежий (до 24 часов) момент подсвечивается в профиле, затем остаётся на стене как хроника.
 *
 * Модель данных — Prisma: Moment, MomentView (уникальный просмотр), MomentComment (см. schema.prisma).
 * Использует и REST (routes/moments.ts), и WebSocket (realtime/socket.ts) — логика одна на двоих.
 */
import { prisma } from '../db';
import { emitToRooms, emitToUser } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { gcMedia, mediaUrl } from './media';

export const MOMENT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_MOMENTS_PER_DAY = 20;
export const MAX_MOMENT_TEXT = 500;
export const MAX_MOMENT_COMMENT = 500;
const PAGE = 20;

const authorSelect = { id: true, username: true, name: true, avatarUrl: true, verified: true } as const;
const momentInclude = {
  author: { select: authorSelect },
  media: { select: { id: true, kind: true } },
  track: { select: { id: true, title: true, durationSec: true, owner: { select: { username: true } } } },
  _count: { select: { views: true, comments: true } },
} as const;

type MomentRow = Awaited<ReturnType<typeof loadOne>>;
async function loadOne(id: number) {
  return prisma.moment.findUnique({ where: { id }, include: momentInclude });
}

export const momentRoom = (id: number) => `moment:${id}`;

export interface MomentDTO {
  id: number;
  username: string;
  name: string;
  avatar: string | null;
  verified: boolean;
  text: string;
  mediaType: 'image' | 'video' | null;
  mediaUrl: string | null;
  track: { id: string; title: string; url: string; artist: string; durationSec: number | null } | null;
  commentsEnabled: boolean;
  createdAt: string;
  /** выложен за последние 24 часа — «живой» момент */
  active: boolean;
  /** уникальные просмотры (автор + гости) */
  views: number;
  viewed: boolean;
  commentsCount: number;
  mine: boolean;
}

export function toMomentDTO(m: NonNullable<MomentRow>, viewerId: string, viewed: boolean): MomentDTO {
  return {
    id: m.id,
    username: m.author.username,
    name: m.author.name,
    avatar: m.author.avatarUrl,
    verified: m.author.verified,
    text: m.text,
    mediaType: m.media ? (m.mediaType === 'video' ? 'video' : 'image') : null,
    mediaUrl: m.media ? mediaUrl(m.media.id) : null,
    track: m.track ? { id: m.track.id, title: m.trackTitle || m.track.title || 'Без названия', url: mediaUrl(m.track.id), artist: '@' + m.track.owner.username, durationSec: m.track.durationSec } : null,
    commentsEnabled: m.commentsEnabled,
    createdAt: m.createdAt.toISOString(),
    active: Date.now() - m.createdAt.getTime() < MOMENT_TTL_MS,
    views: m._count.views,
    viewed,
    commentsCount: m._count.comments,
    mine: m.authorId === viewerId,
  };
}

/** Есть ли у пользователя момент, выложенный за последние 24 часа (иконка в профиле подсвечивается). */
export async function hasActiveMoment(userId: string): Promise<boolean> {
  return (await prisma.moment.count({ where: { authorId: userId, createdAt: { gt: new Date(Date.now() - MOMENT_TTL_MS) } } })) > 0;
}

async function viewedSet(viewerId: string, ids: number[]) {
  if (!ids.length) return new Set<number>();
  const rows = await prisma.momentView.findMany({ where: { userId: viewerId, momentId: { in: ids } }, select: { momentId: true } });
  return new Set(rows.map((r) => r.momentId));
}

export interface CreateMomentInput {
  text?: string;
  mediaId?: string | null;
  trackId?: string | null;
  commentsEnabled?: boolean;
}

/** Создать момент. Фото/видео — только свои загруженные; трек — свой или сохранённый из чужого профиля. */
export async function createMoment(userId: string, input: CreateMomentInput): Promise<MomentDTO> {
  const text = (input.text ?? '').trim().slice(0, MAX_MOMENT_TEXT);
  if (!text && !input.mediaId) throw new HttpError(400, 'empty_moment');
  const since = new Date(Date.now() - MOMENT_TTL_MS);
  if ((await prisma.moment.count({ where: { authorId: userId, createdAt: { gt: since } } })) >= MAX_MOMENTS_PER_DAY) {
    throw new HttpError(429, 'moment_limit');
  }
  let mediaType: string | null = null;
  if (input.mediaId) {
    const m = await prisma.media.findFirst({ where: { id: input.mediaId, ownerId: userId, kind: { in: ['IMAGE', 'VIDEO'] } } });
    if (!m) throw new HttpError(400, 'bad_media');
    mediaType = m.kind === 'VIDEO' ? 'video' : 'image';
  }
  let trackTitle: string | null = null;
  if (input.trackId) {
    const t = await prisma.media.findFirst({ where: { id: input.trackId, kind: 'TRACK' } });
    if (!t) throw new HttpError(400, 'bad_media');
    if (t.ownerId !== userId && !(await prisma.savedTrack.count({ where: { userId, mediaId: t.id } }))) throw new HttpError(400, 'bad_media');
    trackTitle = t.title || 'Без названия';
  }
  const row = await prisma.moment.create({
    data: {
      authorId: userId, text, mediaId: input.mediaId ?? null, mediaType, trackId: input.trackId ?? null, trackTitle,
      commentsEnabled: input.commentsEnabled !== false,
    },
    include: momentInclude,
  });
  const dto = toMomentDTO(row, userId, false);
  // подписчики узнают о новом моменте сразу (подсветка иконки в профиле автора)
  const followers = await prisma.follow.findMany({ where: { followingId: userId }, select: { followerId: true }, take: 1000 });
  for (const f of followers) emitToUser(f.followerId, 'moment:new', { username: dto.username, id: dto.id });
  emitToUser(userId, 'moment:new', { username: dto.username, id: dto.id });
  return dto;
}

/** Стена пользователя (новые сверху), постранично: before — id последнего полученного момента. */
export async function listMoments(viewerId: string, username: string, before?: number) {
  const u = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  const rows = await prisma.moment.findMany({
    where: { authorId: u.id, ...(before ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' }, take: PAGE + 1, include: momentInclude,
  });
  const page = rows.slice(0, PAGE);
  const seen = await viewedSet(viewerId, page.map((r) => r.id));
  return {
    moments: page.map((r) => toMomentDTO(r, viewerId, seen.has(r.id))),
    hasMore: rows.length > PAGE,
    active: await hasActiveMoment(u.id),
  };
}

export async function getMoment(viewerId: string, id: number): Promise<MomentDTO> {
  const row = await loadOne(id);
  if (!row) throw new HttpError(404, 'moment_not_found');
  return toMomentDTO(row, viewerId, (await viewedSet(viewerId, [id])).has(id));
}

/**
 * Зафиксировать просмотр. Считаются уникальные люди: повторный просмотр тем же человеком счётчик не растит.
 * Автору счётчик пересчитывается в реальном времени (событие moment:views).
 */
export async function recordView(viewerId: string, id: number) {
  const m = await prisma.moment.findUnique({ where: { id }, select: { id: true, authorId: true } });
  if (!m) throw new HttpError(404, 'moment_not_found');
  const existed = await prisma.momentView.findUnique({ where: { momentId_userId: { momentId: id, userId: viewerId } }, select: { userId: true } });
  if (!existed) {
    await prisma.momentView.create({ data: { momentId: id, userId: viewerId } }).catch(() => {}); // гонка двух вкладок — не страшно
  }
  const views = await prisma.momentView.count({ where: { momentId: id } });
  if (!existed) {
    emitToUser(m.authorId, 'moment:views', { id, views });
    emitToRooms([momentRoom(id)], 'moment:views', { id, views });
  }
  return { views, counted: !existed };
}

export interface MomentCommentDTO {
  id: number;
  momentId: number;
  text: string;
  createdAt: string;
  user: { id: string; username: string; name: string; avatar: string | null; verified: boolean };
  mine: boolean;
}

const commentInclude = { user: { select: authorSelect } } as const;
const toCommentDTO = (c: { id: number; momentId: number; text: string; createdAt: Date; user: { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean } }, viewerId: string): MomentCommentDTO => ({
  id: c.id, momentId: c.momentId, text: c.text, createdAt: c.createdAt.toISOString(),
  user: { id: c.user.id, username: c.user.username, name: c.user.name, avatar: c.user.avatarUrl, verified: c.user.verified },
  mine: c.user.id === viewerId,
});

export async function listMomentComments(viewerId: string, id: number) {
  const m = await prisma.moment.findUnique({ where: { id }, select: { commentsEnabled: true } });
  if (!m) throw new HttpError(404, 'moment_not_found');
  const rows = await prisma.momentComment.findMany({ where: { momentId: id }, orderBy: { createdAt: 'asc' }, take: 200, include: commentInclude });
  return { enabled: m.commentsEnabled, comments: rows.map((c) => toCommentDTO(c, viewerId)) };
}

export async function addMomentComment(userId: string, id: number, rawText: string): Promise<MomentCommentDTO> {
  const text = rawText.trim().slice(0, MAX_MOMENT_COMMENT);
  if (!text) throw new HttpError(400, 'empty_comment');
  const m = await prisma.moment.findUnique({ where: { id }, select: { commentsEnabled: true, authorId: true } });
  if (!m) throw new HttpError(404, 'moment_not_found');
  if (!m.commentsEnabled) throw new HttpError(403, 'comments_disabled');
  const row = await prisma.momentComment.create({ data: { momentId: id, userId, text }, include: commentInclude });
  const count = await prisma.momentComment.count({ where: { momentId: id } });
  // всем, кто сейчас смотрит этот момент, и автору (даже если карточка не открыта)
  const dto = toCommentDTO(row, '');
  emitToRooms([momentRoom(id)], 'moment:comment', { comment: dto, count });
  emitToUser(m.authorId, 'moment:comment', { comment: dto, count });
  return toCommentDTO(row, userId);
}

export async function deleteMomentComment(userId: string, id: number, commentId: number) {
  const c = await prisma.momentComment.findUnique({ where: { id: commentId }, include: { moment: { select: { authorId: true } } } });
  if (!c || c.momentId !== id) throw new HttpError(404, 'comment_not_found');
  if (c.userId !== userId && c.moment.authorId !== userId) throw new HttpError(403, 'forbidden');
  await prisma.momentComment.delete({ where: { id: commentId } });
  const count = await prisma.momentComment.count({ where: { momentId: id } });
  emitToRooms([momentRoom(id)], 'moment:comment_deleted', { id, commentId, count });
  return { count };
}

/** Автор включает/выключает комментарии под моментом. */
export async function setMomentComments(userId: string, id: number, enabled: boolean) {
  const m = await prisma.moment.findUnique({ where: { id }, select: { authorId: true } });
  if (!m || m.authorId !== userId) throw new HttpError(404, 'moment_not_found');
  await prisma.moment.update({ where: { id }, data: { commentsEnabled: enabled } });
  emitToRooms([momentRoom(id)], 'moment:comments_toggle', { id, enabled });
  return { commentsEnabled: enabled };
}

export async function deleteMoment(userId: string, id: number) {
  const m = await prisma.moment.findUnique({ where: { id }, select: { authorId: true, mediaId: true } });
  if (!m || m.authorId !== userId) throw new HttpError(404, 'moment_not_found');
  await prisma.moment.delete({ where: { id } });
  if (m.mediaId) await gcMedia(m.mediaId);
  emitToRooms([momentRoom(id)], 'moment:deleted', { id });
  return { ok: true };
}