import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Анти-CSRF для cookie-авторизации. Любой запрос, меняющий данные, обязан доказать, что пришёл с нашего сайта:
 *   1) заголовок Origin (его браузер ставит на все POST/PUT/PATCH/DELETE) — должен совпасть с нашим адресом;
 *   2) если Origin нет — Referer должен начинаться с нашего адреса;
 *   3) если нет и его — разрешаем только при Sec-Fetch-Site: same-origin/none.
 * Запрос без всех трёх признаков (старый браузер / форма с чужого сайта без заголовков) отклоняется.
 * Вместе с SameSite=Lax на cookie это закрывает подделку запросов с чужих сайтов.
 */
export const originGuard: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const deny = () => void res.status(403).json({ error: 'bad_origin' });
  const origin = req.get('origin');
  if (origin && origin !== 'null') return origin === config.appOrigin ? next() : deny();
  const referer = req.get('referer');
  if (referer) return referer === config.appOrigin || referer.startsWith(config.appOrigin + '/') ? next() : deny();
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none' ? next() : deny();
  // ни Origin, ни Referer, ни Sec-Fetch-Site: браузер так не делает. Пускаем только запросы без cookie (например, curl без входа)
  return req.headers.cookie ? deny() : next();
};

/** Ответы API содержат личные данные — их нельзя сохранять ни в браузерном, ни в промежуточных кэшах. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
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
export const usernameLimiter = make(60_000, 40); // проверка ника «на лету»: защита от перебора занятых ников

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
