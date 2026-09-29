import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { authOf, requireAuth } from '../middleware/auth';
import {
  canAccessMedia, cleanFileName, cleanTitle, FILE_EXTS, fileExt, MAX_TRACKS_PER_USER, MEDIA_RULES, toMediaDTO,
} from '../services/media';
import { ensureUploadDir, removeFile, saveUpload, sendFile } from '../services/storage';
import { HttpError, wrap } from '../utils/errors';

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

const uploadLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'rate_limited' },
});

const KIND = { voice: 'VOICE', videonote: 'VIDEO_NOTE', image: 'IMAGE', track: 'TRACK', video: 'VIDEO', file: 'FILE' } as const;

/**
 * Загрузка: тело запроса — сам файл (Content-Type = его MIME-тип).
 *   POST /api/media?kind=voice|videonote|image|track|video|file&duration=12&name=Моя песня
 * Файл пишется на диск потоком и обрывается, как только превышен лимит размера.
 */
mediaRouter.post('/', uploadLimiter, wrap(async (req, res) => {
  const { userId } = authOf(req);
  const q = z.object({
    kind: z.enum(['voice', 'videonote', 'image', 'track', 'video', 'file']),
    duration: z.coerce.number().min(0).max(3600).optional(),
    name: z.string().max(200).optional(),
  }).parse(req.query);
  const kind = KIND[q.kind];
  const rule = MEDIA_RULES[kind];

  let mime = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (kind === 'FILE') {
    // документ: тип не доверяем браузеру — смотрим на расширение из белого списка
    if (!FILE_EXTS.has(fileExt(q.name ?? ''))) throw new HttpError(415, 'unsupported_type');
    mime = 'application/octet-stream';
  }
  const ext = rule.mimes[mime];
  if (!ext) throw new HttpError(415, 'unsupported_type');
  const declared = Number(req.get('content-length') ?? 0);
  if (declared > rule.maxBytes) throw new HttpError(413, 'too_large');

  if (kind === 'TRACK') {
    const count = await prisma.media.count({ where: { ownerId: userId, kind: 'TRACK' } });
    if (count >= MAX_TRACKS_PER_USER) throw new HttpError(409, 'too_many_tracks');
  }

  ensureUploadDir();
  const file = `${crypto.randomUUID()}${ext}`;
  const size = await saveUpload(req, file, mime, rule.maxBytes);

  const media = await prisma.media.create({
    data: {
      ownerId: userId, kind, mime, size, file,
      title: kind === 'TRACK' ? cleanTitle(q.name ?? '') || 'Без названия' : kind === 'FILE' ? cleanFileName(q.name ?? '') : null,
      durationSec: q.duration ? Math.round(q.duration) : null,
    },
  });
  res.json({ media: toMediaDTO(media) });
}));

/** Отдача файла (с поддержкой Range — перемотка аудио/видео). Доступ проверяется на КАЖДЫЙ запрос. */
mediaRouter.get('/:id', wrap(async (req, res) => {
  const m = await prisma.media.findUnique({ where: { id: String(req.params.id) } });
  if (!m || !(await canAccessMedia(authOf(req).userId, m))) throw new HttpError(404, 'media_not_found');
  const headers: Record<string, string> = {
    'Content-Type': m.mime, // тип берём из нашей БД (белый список), а не «угадываем» по файлу
    'Cache-Control': 'private, max-age=86400',
    'Content-Disposition': 'inline',
  };
  if (m.kind === 'FILE') {
    // документы — только скачивание, никогда не открываются в браузере; песочница закрывает любые скрипты
    const name = m.title || 'file';
    headers['Content-Disposition'] = `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
  }
  await sendFile(req, res, m.file, headers);
}));

/** Удалить свой трек из профиля. (Файлы сообщений удаляются вместе с сообщением.) */
mediaRouter.delete('/:id', wrap(async (req, res) => {
  const m = await prisma.media.findUnique({ where: { id: String(req.params.id) } });
  if (!m || m.ownerId !== authOf(req).userId || m.kind !== 'TRACK') throw new HttpError(404, 'media_not_found');
  await prisma.media.delete({ where: { id: m.id } });
  await removeFile(m.file);
  res.json({ ok: true });
}));
