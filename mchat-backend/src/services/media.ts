import type { Media, MediaKind } from '@prisma/client';
import { prisma } from '../db';
import { removeFile } from './storage';

/** Что можно загружать: разрешённые MIME-типы (→ расширение на диске) и потолок размера. */
export const MEDIA_RULES: Record<MediaKind, { mimes: Record<string, string>; maxBytes: number }> = {
  VOICE: {
    maxBytes: 8 * 1024 * 1024,
    mimes: { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/mpeg': '.mp3', 'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/x-wav': '.wav' },
  },
  TRACK: {
    maxBytes: 25 * 1024 * 1024,
    mimes: { 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/flac': '.flac' },
  },
  VIDEO_NOTE: { maxBytes: 30 * 1024 * 1024, mimes: { 'video/webm': '.webm', 'video/mp4': '.mp4' } },
  IMAGE: { maxBytes: 10 * 1024 * 1024, mimes: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' } },
  VIDEO: { maxBytes: 40 * 1024 * 1024, mimes: { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' } },
  // Документы: тип определяем по расширению из белого списка (браузеры путают MIME), на диске — .bin,
  // а отдаём ВСЕГДА как скачиваемый application/octet-stream — исполнить в браузере файл нельзя.
  FILE: { maxBytes: 25 * 1024 * 1024, mimes: { 'application/octet-stream': '.bin' } },
};

export const FILE_EXTS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'odt', 'ods', 'odp', 'md', 'json', 'epub', 'fb2',
  'zip', 'rar', '7z', 'tar', 'gz', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'avi', 'mkv', 'mov', 'heic', 'heif', 'jpg', 'jpeg', 'png', 'webp', 'gif',
]);
export const fileExt = (name: string) => (/\.([a-z0-9]{1,6})$/i.exec(name)?.[1] ?? '').toLowerCase();

/** Имя файла для показа: без путей, управляющих символов и угловых скобок. */
export const cleanFileName = (raw: string) =>
  raw.replace(/[\u0000-\u001f<>:"|?*\\/]/g, '_').trim().slice(0, 120) || 'file';

export const MAX_TRACKS_PER_USER = 20;

export const mediaUrl = (id: string) => `/api/media/${id}`;

export const toMediaDTO = (m: Media) => ({
  id: m.id,
  url: mediaUrl(m.id),
  kind: m.kind,
  mime: m.mime,
  size: m.size,
  title: m.title,
  durationSec: m.durationSec,
  createdAt: m.createdAt.toISOString(),
});

/** Чистое имя трека: без управляющих символов и угловых скобок. */
export const cleanTitle = (raw: string) =>
  raw.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

/**
 * Файл виден: владельцу; любому вошедшему пользователю, если это трек профиля;
 * участникам чата, где на него ссылается (неудалённое) сообщение.
 */
export async function canAccessMedia(userId: string, m: Pick<Media, 'id' | 'ownerId' | 'kind'>): Promise<boolean> {
  if (m.ownerId === userId || m.kind === 'TRACK') return true;
  if (m.kind === 'IMAGE') {
    const av = await prisma.chat.findFirst({
      where: { avatarMediaId: m.id, OR: [{ isPublic: true }, { members: { some: { userId } } }] }, select: { id: true },
    });
    if (av) return true; // аватарка группы/канала видна её участникам
    // аватар / обложка профиля видны всем вошедшим пользователям
    const url = mediaUrl(m.id);
    const prof = await prisma.user.findFirst({ where: { OR: [{ avatarUrl: url }, { bannerUrl: url }] }, select: { id: true } });
    if (prof) return true;
  }
  if (m.kind === 'IMAGE' || m.kind === 'VIDEO') {
    // публичный пост (фото/видео/обложка) виден всем вошедшим; приватный — только автору (он владелец файла)
    const post = await prisma.post.findFirst({
      where: { privacy: 'public', OR: [{ mediaId: m.id }, { thumbId: m.id }] }, select: { id: true },
    });
    if (post) return true;
    const story = await prisma.story.findFirst({ where: { mediaId: m.id, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (story) return true;
  }
  const ref = await prisma.message.findFirst({
    where: { mediaId: m.id, deletedAt: null, chat: { members: { some: { userId } } } },
    select: { id: true },
  });
  return !!ref;
}

/** Файл ещё нужен, если на него ссылается сообщение, пост, история или профиль. */
async function isMediaReferenced(mediaId: string): Promise<boolean> {
  const url = mediaUrl(mediaId);
  const [msgs, posts, stories, profiles, chats] = await Promise.all([
    prisma.message.count({ where: { mediaId, deletedAt: null } }),
    prisma.post.count({ where: { OR: [{ mediaId }, { thumbId: mediaId }] } }),
    prisma.story.count({ where: { mediaId } }),
    prisma.user.count({ where: { OR: [{ avatarUrl: url }, { bannerUrl: url }] } }),
    prisma.chat.count({ where: { avatarMediaId: mediaId } }),
  ]);
  return msgs + posts + stories + profiles + chats > 0;
}

/** Удаляет файл, если на него больше ничто не ссылается (треки профиля не трогаем). */
export async function gcMedia(mediaId: string) {
  const m = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!m || m.kind === 'TRACK') return;
  if (await isMediaReferenced(mediaId)) return;
  await prisma.media.delete({ where: { id: mediaId } }).catch(() => {});
  await removeFile(m.file);
}
