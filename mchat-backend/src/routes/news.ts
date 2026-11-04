import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAdmin, requireAuth } from '../middleware/auth';
import { createStory, deleteStory } from '../services/posts';
import { deleteNews, listNews, publishNews, systemId } from '../services/system';
import { prisma } from '../db';
import { gcMedia, mediaUrl } from '../services/media';
import { emitToChat } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { wrap } from '../utils/errors';

/**
 * Публикации официального аккаунта «Mchat — Новости». ВСЕ маршруты только для администратора:
 * requireAdmin на каждом запросе читает роль из БД — скрытие кнопок в интерфейсе безопасностью не считается.
 */
export const newsRouter = Router();
newsRouter.use(requireAuth, requireAdmin);

const mediaId = z.string().min(1).max(40);

newsRouter.get('/', wrap(async (_req, res) => {
  res.json({ posts: await listNews() });
}));

// Администратор меняет постоянный аватар системного аккаунта; ссылка хранится в User и раздаётся всем клиентам.
newsRouter.put('/avatar/:kind', wrap(async (req, res) => {
  const kind = z.enum(['SECURITY', 'NEWS']).parse(req.params.kind);
  const { mediaId } = z.object({ mediaId: z.string().min(1).max(40) }).strict().parse(req.body);
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media || media.ownerId !== authOf(req).userId || media.kind !== 'IMAGE') throw new HttpError(400, 'bad_media');
  const userId = await systemId(kind);
  const old = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
  await prisma.user.update({ where: { id: userId }, data: { avatarUrl: mediaUrl(mediaId) } });
  const memberships = await prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } });
  memberships.forEach(({ chatId }) => emitToChat(chatId, 'chat:changed', { chatId }));
  const previous = old?.avatarUrl && /^\/api\/media\/([\w-]+)$/.exec(old.avatarUrl);
  if (previous) gcMedia(previous[1]).catch(() => {});
  res.json({ ok: true, avatar: mediaUrl(mediaId) });
}));

newsRouter.post('/', wrap(async (req, res) => {
  const b = z.object({ text: z.string().max(4000).default(''), mediaId: mediaId.optional() }).strict().parse(req.body);
  const post = await publishNews(authOf(req).userId, b);
  res.status(202).json({ post }); // раскладывание по чатам идёт в фоне
}));

newsRouter.delete('/:id', wrap(async (req, res) => {
  res.json(await deleteNews(z.string().min(1).max(40).parse(req.params.id)));
}));

/** История от имени «Mchat — Новости» (видна всем пользователям). Файл загружает администратор обычным /api/media. */
newsRouter.post('/story', wrap(async (req, res) => {
  const b = z.object({
    mediaId: mediaId.optional(),
    bg: z.string().regex(/^[\w#(),.%\s-]{1,200}$/).optional(),
    textBlocks: z.array(z.object({
      text: z.string().trim().max(300),
      color: z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-z]{3,20})$/).default('#ffffff'),
      font: z.string().regex(/^[\w ,'"-]{1,80}$/).default('Syne'),
      left: z.string().regex(/^\d{1,3}(\.\d{1,4})?%$/).default('50%'),
      top: z.string().regex(/^\d{1,3}(\.\d{1,4})?%$/).default('45%'),
      fontSize: z.number().min(8).max(120).default(26),
    })).max(20).default([]),
  }).parse(req.body);
  const news = await systemId('NEWS');
  res.json({ story: await createStory(news, b, authOf(req).userId) });
}));

newsRouter.delete('/story/:id', wrap(async (req, res) => {
  await deleteStory(await systemId('NEWS'), z.coerce.number().int().positive().parse(req.params.id));
  res.json({ ok: true });
}));
