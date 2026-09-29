import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Анти-CSRF для cookie-авторизации: любой запрос, меняющий данные, обязан прийти
 * с нашего же origin. Вместе с SameSite=Lax это закрывает подделку запросов с чужих сайтов.
 */
export const originGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin) {
    if (origin === config.appOrigin) return next();
    return void res.status(403).json({ error: 'bad_origin' });
  }
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return void res.status(403).json({ error: 'bad_origin' });
  next();
};

const make = (windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });

export const apiLimiter = make(60_000, 300); // общий потолок на IP
export const authLimiter = make(15 * 60_000, 40); // вход через Google
export const codeLimiter = make(15 * 60_000, 30); // ввод/запрос кодов
export const searchLimiter = make(60_000, 60);

/** Простое «ведро токенов» на пользователя для сокетов (анти-спам сообщений). */
export class Bucket {
  private hits = new Map<string, number[]>();
  constructor(private windowMs: number, private limit: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
