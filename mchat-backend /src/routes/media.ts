import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { authOf, requireAuth } from '../middleware/auth';
import {
  canAccessMedia, cleanTitle, ensureUploadDir, MAX_TRACKS_PER_USER, MEDIA_RULES, mediaFilePath, toMediaDTO,
} from '../services/media';
import { HttpError, wrap } from '../utils/errors';

export const mediaRouter = Router();
mediaRouter.use(requireAuth);

const uploadLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'rate_limited' },
});

const KIND = { voice: 'VOICE', videonote: 'VIDEO_NOTE', image: 'IMAGE', track: 'TRACK' } as const;

/**
 * Загрузка: тело запроса — сам файл (Content-Type = его MIME-тип).
 *   POST /api/media?kind=voice|videonote|image|track&duration=12&name=Моя песня
 * Файл пишется на диск потоком и обрывается, как только превышен лимит размера.
 */
mediaRouter.post('/', uploadLimiter, wrap(async (req, res) => {
  const { userId } = authOf(req);
  const q = z.object({
    kind: z.enum(['voice', 'videonote', 'image', 'track']),
    duration: z.coerce.number().min(0).max(3600).optional(),
    name: z.string().max(200).optional(),
  }).parse(req.query);
  const kind = KIND[q.kind];
  const rule = MEDIA_RULES[kind];

  const mime = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
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
  const full = mediaFilePath(file);
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(full, { flags: 'wx', mode: 0o640 });
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > rule.maxBytes) { req.unpipe(ws); ws.destroy(); reject(new HttpError(413, 'too_large')); }
      });
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('aborted')));
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    if (size === 0) throw new HttpError(400, 'empty_file');
  } catch (e) {
    fs.promises.unlink(full).catch(() => {});
    throw e;
  }

  const media = await prisma.media.create({
    data: {
      ownerId: userId, kind, mime, size, file,
      title: kind === 'TRACK' ? cleanTitle(q.name ?? '') || 'Без названия' : null,
      durationSec: q.duration ? Math.round(q.duration) : null,
    },
  });
  res.json({ media: toMediaDTO(media) });
}));

/** Отдача файла (с поддержкой Range — перемотка аудио/видео). Доступ проверяется на КАЖДЫЙ запрос. */
mediaRouter.get('/:id', wrap(async (req, res) => {
  const m = await prisma.media.findUnique({ where: { id: String(req.params.id) } });
  if (!m || !(await canAccessMedia(authOf(req).userId, m))) throw new HttpError(404, 'media_not_found');
  res.sendFile(mediaFilePath(m.file), {
    headers: {
      'Content-Type': m.mime, // тип берём из нашей БД (белый список), а не «угадываем» по файлу
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': 'inline',
    },
  }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'media_not_found' }); });
}));

/** Удалить свой трек из профиля. (Файлы сообщений удаляются вместе с сообщением.) */
mediaRouter.delete('/:id', wrap(async (req, res) => {
  const m = await prisma.media.findUnique({ where: { id: String(req.params.id) } });
  if (!m || m.ownerId !== authOf(req).userId || m.kind !== 'TRACK') throw new HttpError(404, 'media_not_found');
  await prisma.media.delete({ where: { id: m.id } });
  await fs.promises.unlink(mediaFilePath(m.file)).catch(() => {});
  res.json({ ok: true });
}));
