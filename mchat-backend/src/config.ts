import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  /** Публичный адрес приложения, БЕЗ слэша в конце. В проде — только https:// */
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  /** Секрет для подписи JWT и хэширования кодов. Минимум 32 символа. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть не короче 32 символов (npm run secret)'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Mchat <no-reply@example.com>'),
  /** Отправка писем через HTTPS-API Brevo (работает на бесплатном Render, где SMTP-порты закрыты). Ключ: Brevo → SMTP & API → API Keys. */
  BREVO_API_KEY: z.string().optional(),
  BREVO_API_URL: z.string().default('https://api.brevo.com/v3/smtp/email'),
  /** Email-адреса (через запятую), которым автоматически даётся роль ADMIN */
  ADMIN_EMAILS: z.string().default(''),
  /** Требовать код при входе с нового устройства. «false» — Google-вход сразу пускает (код не нужен). */
  REQUIRE_DEVICE_CODE: z.enum(['true', 'false']).default('true'),
  /** Если код входа доставить некуда (почта не работает, других устройств нет) — пустить человека, а не запирать аккаунт навсегда. */
  ALLOW_LOGIN_WHEN_CODE_UNDELIVERABLE: z.enum(['true', 'false']).default('true'),
  /** Разрешить кнопку «Отправить код на почту» на экране ввода кода */
  ALLOW_EMAIL_FALLBACK: bool,
  /** Куда сохранять голосовые, кружки, фото и треки (в Docker — примонтированный том) */
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Постоянное хранилище файлов (S3-совместимое: Supabase, Cloudflare R2, Backblaze B2). Без него — диск сервера. */
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** ZEGOCLOUD (звонки): AppID и ServerSecret (32 символа) из console.zegocloud.com → ваш проект. Без них звонки отключены. */
  ZEGO_APP_ID: z.coerce.number().int().positive().optional(),
  ZEGO_SERVER_SECRET: z.string().length(32, 'ZEGO_SERVER_SECRET должен быть ровно 32 символа').optional(),
  /** Адрес сигнального сервера ZEGO для веб-клиента (необязательно). По умолчанию: wss://webliveroom<AppID>-api.zegocloud.com/ws */
  ZEGO_SERVER: z.string().optional(),
  /** TURN-сервер для звонков за строгим NAT (необязательно): turn:host:3478?transport=udp,turns:host:5349 */
  TURN_URL: z.string().optional(),
  TURN_USER: z.string().optional(),
  TURN_PASS: z.string().optional(),
  /** Сколько прокси стоит перед приложением (Caddy/nginx = 1) */
  TRUST_PROXY: z.coerce.number().int().default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Ошибка в .env:');
  for (const i of parsed.error.issues) console.error(`  - ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}

const env = parsed.data;
const appUrl = new URL(env.APP_URL);

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  appOrigin: appUrl.origin,
  cookieSecure: appUrl.protocol === 'https:',
  adminEmails: env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  uploadDir: path.resolve(env.UPLOAD_DIR),
  googleRedirectUri: `${appUrl.origin}/api/auth/google/callback`,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 дней
  deviceTtlMs: 365 * 24 * 60 * 60 * 1000, // 1 год
  requireDeviceCode: env.REQUIRE_DEVICE_CODE === 'true',
  allowLoginWhenUndeliverable: env.ALLOW_LOGIN_WHEN_CODE_UNDELIVERABLE === 'true',
  codeTtlMs: 10 * 60 * 1000, // код живёт 10 минут
  codeMaxAttempts: 5,
};

if (config.isProd && !config.cookieSecure) {
  console.error('❌ В production APP_URL должен начинаться с https:// (иначе нет WSS и Secure-cookie).');
  process.exit(1);
}
