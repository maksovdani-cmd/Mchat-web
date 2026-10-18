import { isForbidden } from './moderation';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Ники, которые нельзя занимать (защита от подделки официальных аккаунтов). */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'mchat', 'mchat_official',
  'official', 'moderator', 'security', 'api', 'null', 'undefined', 'me', 'settings',
]);

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'too_short' | 'too_long' | 'invalid_chars' | 'reserved' | 'forbidden' };

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function validateUsername(raw: string): UsernameCheck {
  const v = normalizeUsername(raw);
  if (v.length < 3) return { ok: false, reason: 'too_short' };
  if (v.length > 20) return { ok: false, reason: 'too_long' };
  if (!USERNAME_RE.test(v)) return { ok: false, reason: 'invalid_chars' };
  if (RESERVED.has(v)) return { ok: false, reason: 'reserved' };
  // чёрный список: проверка по вхождению подстроки («123negr» тоже блокируется)
  if (isForbidden(v)) return { ok: false, reason: 'forbidden' };
  return { ok: true, value: v };
}

export const cleanQuery = (q: string) => q.trim().replace(/^@+/, '').slice(0, 40);

/** Отображаемое имя (Display Name): можно менять и повторять, но нецензурное и оскорбительное нельзя. */
export function displayNameAllowed(raw: string): boolean {
  return !isForbidden(raw);
}

/** Безопасное имя из Google при регистрации: без угловых скобок и управляющих символов; запрещённое → ник. */
export function safeDisplayName(raw: string | undefined | null, fallback: string): string {
  const v = (raw ?? '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return v && displayNameAllowed(v) ? v : fallback;
}
