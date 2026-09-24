import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** 6-значный код, криптостойкий генератор (без модульного смещения). */
export const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Хэш кода с секретом сервера и привязкой к пользователю: утечка БД не даёт перебрать 1 млн кодов. */
export const hashCode = (userId: string, code: string) =>
  crypto.createHmac('sha256', config.JWT_SECRET).update(`code:${userId}:${code}`).digest('hex');

export const safeEqualHex = (a: string, b: string) => {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export function signJwt(payload: object, ttlSeconds: number): string {
  return jwt.sign(payload, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: ttlSeconds });
}

export function verifyJwt<T extends object>(token: string | undefined): T | null {
  if (!token) return null;
  try {
    return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as T;
  } catch {
    return null;
  }
}

export const sha256Buf = (s: string) => crypto.createHash('sha256').update(s).digest();
