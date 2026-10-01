import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import { adminOverview, approve, assertAdmin, createRequest, myVerification, reject, revoke } from './services/verification';
import { wrap } from '../utils/errors';

export const verificationRouter = Router();
verificationRouter.use(requireAuth);

const intId = z.coerce.number().int().positive();

/** Моя галочка: действует ли, когда выдана и до какого числа; статус последнего запроса. */
verificationRouter.get('/mine', wrap(async (req, res) => res.json(await myVerification(authOf(req).userId))));

verificationRouter.post('/requests', wrap(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500).regex(/^[^<>]+$/) }).parse(req.body);
  res.json(await createRequest(authOf(req).userId, reason));
}));

// ───────── только админ ─────────
verificationRouter.get('/admin', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  res.json(await adminOverview());
}));

/** days: 5 | 10 | 15 | 30 или null («навсегда»). */
verificationRouter.post('/requests/:id/approve', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  const { days } = z.object({ days: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.null()]) }).parse(req.body);
  res.json(await approve(intId.parse(req.params.id), days));
}));

verificationRouter.post('/requests/:id/reject', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  res.json(await reject(intId.parse(req.params.id)));
}));

/** Снять галочку досрочно. */
verificationRouter.post('/users/:userId/revoke', wrap(async (req, res) => {
  await assertAdmin(authOf(req).userId);
  res.json(await revoke(String(req.params.userId)));
}));
