import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import {
  addSticker, createPack, deletePack, deleteSticker, getPack, listMyPacks, renamePack, savePack, unsavePack,
} from '../services/stickers';
import { wrap } from '../utils/errors';

export const stickersRouter = Router();
stickersRouter.use(requireAuth);

const id = z.string().min(1).max(40);
const title = z.string().trim().min(1).max(40);

/** Моя библиотека: свои и сохранённые коллекции. */
stickersRouter.get('/', wrap(async (req, res) => {
  res.json({ packs: await listMyPacks(authOf(req).userId) });
}));

/** Карточка коллекции (в том числе чужой — по нажатию на стикер в чате). */
stickersRouter.get('/packs/:id', wrap(async (req, res) => {
  res.json({ pack: await getPack(authOf(req).userId, String(req.params.id)) });
}));

stickersRouter.post('/packs', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({ title }).parse(req.body);
  const p = await createPack(userId, b.title);
  res.json({ pack: await getPack(userId, p.id) });
}));

stickersRouter.patch('/packs/:id', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const b = z.object({ title }).parse(req.body);
  await renamePack(userId, String(req.params.id), b.title);
  res.json({ pack: await getPack(userId, String(req.params.id)) });
}));

stickersRouter.delete('/packs/:id', wrap(async (req, res) => {
  await deletePack(authOf(req).userId, String(req.params.id));
  res.json({ ok: true });
}));

/** «Скачать коллекцию целиком» / убрать из библиотеки. */
stickersRouter.put('/packs/:id/save', wrap(async (req, res) => {
  res.json({ pack: await savePack(authOf(req).userId, String(req.params.id)) });
}));
stickersRouter.delete('/packs/:id/save', wrap(async (req, res) => {
  await unsavePack(authOf(req).userId, String(req.params.id));
  res.json({ saved: false });
}));

/** Создать стикер из загруженной картинки: packId — существующая коллекция, packTitle — название (новой или существующей). */
stickersRouter.post('/', wrap(async (req, res) => {
  const b = z.object({ mediaId: id, packId: id.optional(), packTitle: title.optional() }).parse(req.body);
  res.json(await addSticker(authOf(req).userId, b));
}));

stickersRouter.delete('/:id', wrap(async (req, res) => {
  await deleteSticker(authOf(req).userId, String(req.params.id));
  res.json({ ok: true });
}));
