import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { MAX_TEXT } from '../services/chat';
import { deleteAndDispatch, editAndDispatch, forwardAndDispatch, reactAndDispatch } from '../services/messaging';
import { wrap } from '../utils/errors';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

const mid = (req: { params: Record<string, unknown> }) => String(req.params.id);

/** Изменить свой текст. */
messagesRouter.patch('/:id', wrap(async (req, res) => {
  const { text } = z.object({ text: z.string().max(MAX_TEXT + 500) }).parse(req.body);
  res.json({ message: await editAndDispatch(authOf(req).userId, mid(req), text) });
}));

/** Удалить: scope=all — у всех, scope=me — только у меня. */
messagesRouter.delete('/:id', wrap(async (req, res) => {
  const { scope } = z.object({ scope: z.enum(['me', 'all']).default('all') }).parse(req.query);
  const r = await deleteAndDispatch(authOf(req).userId, mid(req), scope);
  res.json({ ok: true, scope: r.scope });
}));

/** Поставить реакцию; emoji=null или тот же эмодзи повторно — снять. */
messagesRouter.put('/:id/reaction', wrap(async (req, res) => {
  const { emoji } = z.object({ emoji: z.string().max(16).nullable() }).parse(req.body);
  res.json(await reactAndDispatch(authOf(req).userId, mid(req), emoji));
}));

/** Переслать в другой чат, где я участник. */
messagesRouter.post('/:id/forward', wrap(async (req, res) => {
  const b = z.object({ chatId: z.string().min(1).max(40), clientId: z.string().min(1).max(64).optional() }).parse(req.body);
  res.json({ message: await forwardAndDispatch(authOf(req).userId, mid(req), b.chatId, b.clientId) });
}));
