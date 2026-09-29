export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Ники, которые нельзя занимать (защита от подделки официальных аккаунтов). */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'mchat', 'mchat_official',
  'official', 'moderator', 'security', 'api', 'null', 'undefined', 'me', 'settings',
]);

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: 'too_short' | 'too_long' | 'invalid_chars' | 'reserved' };

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function validateUsername(raw: string): UsernameCheck {
  const v = normalizeUsername(raw);
  if (v.length < 3) return { ok: false, reason: 'too_short' };
  if (v.length > 20) return { ok: false, reason: 'too_long' };
  if (!USERNAME_RE.test(v)) return { ok: false, reason: 'invalid_chars' };
  if (RESERVED.has(v)) return { ok: false, reason: 'reserved' };
  return { ok: true, value: v };
}

export const cleanQuery = (q: string) => q.trim().replace(/^@+/, '').slice(0, 40);
