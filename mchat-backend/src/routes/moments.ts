import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import {
  MAX_MOMENT_COMMENT, MAX_MOMENT_TEXT, addMomentComment, createMoment, deleteMoment, deleteMomentComment, getMoment,
  listMomentComments, listMoments, recordView, setMomentComments,
} from '../services/moments';
import { wrap } from '../utils/errors';

const intId = z.coerce.number().int().positive();
const mediaId = z.string().min(1).max(40);
const clean = z.string().trim().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/);

export const momentsRouter = Router();
momentsRouter.use(requireAuth);

/** Стена: GET /api/moments?username=anna&before=123 */
momentsRouter.get('/', wrap(async (req, res) => {
  const q = z.object({ username: z.string().min(1).max(40), before: intId.optional() }).parse(req.query);
  res.json(await listMoments(authOf(req).userId, q.username, q.before));
}));

/** Новый момент: фото/видео (mediaId из /api/media), заметка, трек дня (trackId), комментарии вкл/выкл. */
momentsRouter.post('/', wrap(async (req, res) => {
  const b = z.object({
    text: clean.pipe(z.string().max(MAX_MOMENT_TEXT)).default(''),
    mediaId: mediaId.nullish(),
    trackId: mediaId.nullish(),
    commentsEnabled: z.boolean().default(true),
  }).parse(req.body);
  res.status(201).json({ moment: await createMoment(authOf(req).userId, b) });
}));

momentsRouter.get('/:id', wrap(async (req, res) => {
  res.json({ moment: await getMoment(authOf(req).userId, intId.parse(req.params.id)) });
}));

/** Зафиксировать просмотр (уникальный на человека). */
momentsRouter.post('/:id/view', wrap(async (req, res) => {
  res.json(await recordView(authOf(req).userId, intId.parse(req.params.id)));
}));

momentsRouter.patch('/:id', wrap(async (req, res) => {
  const { commentsEnabled } = z.object({ commentsEnabled: z.boolean() }).parse(req.body);
  res.json(await setMomentComments(authOf(req).userId, intId.parse(req.params.id), commentsEnabled));
}));

momentsRouter.delete('/:id', wrap(async (req, res) => {
  res.json(await deleteMoment(authOf(req).userId, intId.parse(req.params.id)));
}));

momentsRouter.get('/:id/comments', wrap(async (req, res) => {
  res.json(await listMomentComments(authOf(req).userId, intId.parse(req.params.id)));
}));

momentsRouter.post('/:id/comments', wrap(async (req, res) => {
  const { text } = z.object({ text: clean.pipe(z.string().min(1).max(MAX_MOMENT_COMMENT)) }).parse(req.body);
  res.status(201).json({ comment: await addMomentComment(authOf(req).userId, intId.parse(req.params.id), text) });
}));

momentsRouter.delete('/:id/comments/:commentId', wrap(async (req, res) => {
  res.json(await deleteMomentComment(authOf(req).userId, intId.parse(req.params.id), intId.parse(req.params.commentId)));
}));