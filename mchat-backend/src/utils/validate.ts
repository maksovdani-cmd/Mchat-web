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
  const v = cleanDisplayName((raw ?? '').replace(/[<>]/g, '')).slice(0, 40);
  return v && displayNameAllowed(v) ? v : fallback;
}

/**
 * Чистка отображаемых имён: из-за таких символов в профиле вместо имени появлялись «квадратики» (NO GLYPH) и «иконки неподдерживаемого символа».
 *   • U+FFFD (символ замены — след битой кодировки), управляющие и «невидимые» символы, мусорные суррогаты;
 *   • область личного использования U+E000–F8FF (там лежат иконки чужих шрифтов — на других устройствах их нет);
 *   • коды управления направлением текста (U+202A–202E, U+2066–2069): через них можно «перевернуть» имя и подделать чужое;
 *   • «красивые» математические/полноширинные буквы (𝓗𝓮𝓵𝓵𝓸, Ｈｅｌｌｏ) приводятся к обычным — их нет в большинстве шрифтов.
 * Эмодзи, кириллица, латиница и другие настоящие письменности остаются как есть.
 */
export function cleanDisplayName(raw: string): string {
  const mapped = Array.from(raw.normalize('NFC')).map((ch) => {
    const cp = ch.codePointAt(0)!;
    // математические алфавиты (U+1D400–1D7FF) и полноширинные формы (U+FF01–FF5E) → обычные буквы/цифры через NFKC
    if ((cp >= 0x1d400 && cp <= 0x1d7ff) || (cp >= 0xff01 && cp <= 0xff5e)) return ch.normalize('NFKC');
    return ch;
  }).join('');
  return mapped
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')                    // управляющие
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad\u180e]/g, '')  // невидимые и управление направлением (ZWJ/ZWNJ U+200C–200D оставляем: на них держатся составные эмодзи)
    .replace(/[\ue000-\uf8ff\ufffd\ufff0-\uffff]/g, '')               // личное использование, символ замены, служебные
    .replace(/[\u{f0000}-\u{10ffff}]/gu, '')                              // дополнительные области личного использования
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '') // только ОДИНОЧНЫЕ «половинки» суррогатов (пары — это эмодзи, их не трогаем)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Один раз при старте чистим уже сохранённые «битые» имена пользователей и названий групп. */
export async function sanitizeStoredNames(prisma: { user: { findMany: (a: unknown) => Promise<{ id: string; name: string; username: string }[]>; update: (a: unknown) => Promise<unknown> } }) {
  const users = await prisma.user.findMany({ select: { id: true, name: true, username: true }, take: 50000 });
  let fixed = 0;
  for (const u of users) {
    const c = cleanDisplayName(u.name);
    const next = c || u.username;                       // имя целиком состояло из мусора — показываем ник
    if (next !== u.name) { await prisma.user.update({ where: { id: u.id }, data: { name: next.slice(0, 40) } }); fixed++; }
  }
  if (fixed) console.log(`[names] исправлено «битых» имён: ${fixed}`);
}
