import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { randomToken, sha256, signJwt } from '../utils/crypto';
import { clientIp, deviceLabel } from '../utils/device';
import { disconnectDevice, disconnectSession } from '../realtime/hub';

export const COOKIE = {
  session: 'mchat_session', // JWT сессии, 30 дней
  device: 'mchat_device', // секрет доверенного устройства, 1 год
  pending: 'mchat_pending', // ожидание кода нового устройства, 10 минут
  oauth: 'mchat_oauth', // state/PKCE на время похода в Google, 10 минут
} as const;

const base: CookieOptions = {
  httpOnly: true, // JS на странице не может прочитать cookie → XSS не украдёт сессию
  secure: config.cookieSecure, // только по HTTPS
  sameSite: 'lax', // защита от CSRF; Lax нужен, чтобы работал возврат из Google
  path: '/',
};

export const setCookie = (res: Response, name: string, value: string, maxAgeMs: number) =>
  res.cookie(name, value, { ...base, maxAge: maxAgeMs });
export const dropCookie = (res: Response, name: string) => res.clearCookie(name, base);

export async function createDevice(userId: string, req: Request) {
  const raw = randomToken(32);
  const device = await prisma.device.create({
    data: { userId, tokenHash: sha256(raw), label: deviceLabel(req), ip: clientIp(req) },
  });
  return { device, raw };
}

export const setDeviceCookie = (res: Response, raw: string) =>
  setCookie(res, COOKIE.device, raw, config.deviceTtlMs);

/** Устройство «знакомо», если его секрет из cookie принадлежит этому пользователю и не отозван. */
export async function findTrustedDevice(userId: string, raw: string | undefined) {
  if (!raw) return null;
  const d = await prisma.device.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!d || d.userId !== userId || d.revokedAt) return null;
  return d;
}

/** Создаёт сессию и кладёт JWT в httpOnly cookie. */
export async function startSession(res: Response, userId: string, deviceId: string) {
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  const session = await prisma.session.create({ data: { userId, deviceId, expiresAt } });
  const token = signJwt({ sid: session.id, sub: userId }, Math.floor(config.sessionTtlMs / 1000));
  setCookie(res, COOKIE.session, token, config.sessionTtlMs);
  await prisma.device.update({ where: { id: deviceId }, data: { lastUsedAt: new Date() } });
  return session;
}

export async function revokeSession(sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  disconnectSession(sessionId);
}

/** Полностью отзывает устройство: сессии, пуши, живые сокеты. Следующий вход потребует код. */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const res = await prisma.device.updateMany({
    where: { id: deviceId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) return false;
  await prisma.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.pushSubscription.deleteMany({ where: { deviceId } });
  disconnectDevice(deviceId);
  return true;
}
