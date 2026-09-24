import type { Request } from 'express';
import { prisma } from '../db';
import { verifyJwt } from '../utils/crypto';
import { HttpError, wrap } from '../utils/errors';
import { COOKIE } from '../services/session';

export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Общая проверка для REST и Socket.IO: подпись JWT + сессия/устройство не отозваны и не истекли. */
export async function resolveSessionToken(token: string | undefined): Promise<AuthContext | null> {
  const p = verifyJwt<{ sid?: string; sub?: string }>(token);
  if (!p?.sid || !p.sub) return null;
  const s = await prisma.session.findUnique({ where: { id: p.sid }, include: { device: true } });
  if (!s || s.userId !== p.sub || s.revokedAt || s.expiresAt < new Date() || s.device.revokedAt) return null;
  return { userId: s.userId, sessionId: s.id, deviceId: s.deviceId };
}

export const requireAuth = wrap(async (req, _res, next) => {
  const ctx = await resolveSessionToken(req.cookies?.[COOKIE.session]);
  if (!ctx) throw new HttpError(401, 'unauthorized');
  req.auth = ctx;
  next();
});

export const authOf = (req: Request): AuthContext => {
  if (!req.auth) throw new HttpError(401, 'unauthorized');
  return req.auth;
};
