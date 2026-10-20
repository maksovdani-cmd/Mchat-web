import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config';
import { prisma } from './db';
import { apiLimiter, noStore, originGuard } from './middleware/security';
import { initSocket } from './realtime/socket';
import { authRouter } from './routes/auth';
import { chatsRouter } from './routes/chats';
import { friendsRouter } from './routes/friends';
import { mediaRouter } from './routes/media';
import { momentsRouter } from './routes/moments';
import { messagesRouter } from './routes/messages';
import { postsRouter, storiesRouter } from './routes/posts';
import { purgeExpiredAndBroadcast } from './services/messaging';
import { purgeExpiredStories } from './services/posts';
import { verificationRouter } from './routes/verification';
import { callsRouter } from './routes/calls';
import { supportRouter } from './routes/support';
import { expireVerifications } from './services/verification';
import { pushRouter } from './routes/push';
import { titlesRouter } from './routes/titles';
import { usersRouter } from './routes/users';
import { ensureUploadDir, storageMode } from './services/storage';
import { HttpError } from './utils/errors';

const app = express();
app.set('trust proxy', config.TRUST_PROXY); // корректный req.ip и req.protocol за Caddy/nginx
app.disable('x-powered-by');

// В проде: только HTTPS (а значит, и только WSS)
app.use((req, res, next) => {
  if (config.isProd && req.path !== '/healthz' && req.path !== '/ping' && req.protocol !== 'https') {
    return res.redirect(301, `${config.appOrigin}${req.originalUrl}`);
  }
  next();
});

const wsOrigin = config.appOrigin.replace(/^http/, 'ws');
// ZEGOCLOUD (звонки): веб-клиент ходит на их серверы по https (проверка/логирование) и wss (сигналинг).
// Сам клиент грузится из /vendor или с cdn.jsdelivr.net; медиа идёт по WebRTC и CSP не затрагивается.
// SDK выбирает серверы из семейства доменов cool<буква>cloud.com (coolgcloud, coolbcloud, coolzcloud…), поэтому разрешаем все буквы.
const zegoDomains = [
  'zegocloud.com', 'zego.im',
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `cool${c}cloud.com`),
];
// происхождение публичного бакета (если задан S3_PUBLIC_URL) — чтобы браузер мог играть/скачивать файлы прямо из облака
const cloudOrigin: string[] = (() => { try { return config.s3PublicBase ? [new URL(config.s3PublicBase).origin] : []; } catch { return []; } })();
const zegoConnect = zegoDomains.flatMap((d) => [`https://*.${d}`, `wss://*.${d}`]);
app.use(
  helmet({
    hsts: config.isProd ? { maxAge: 63072000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' нужен, пока в вёрстке есть onclick="..." и <script> внутри HTML.
        // Когда перейдёшь на addEventListener — можно убрать и получить сильную защиту от XSS.
        // cdn.jsdelivr.net — запасной источник клиента ZEGOCLOUD, если локальный файл в /vendor не загрузился
        // 'wasm-unsafe-eval' — MediaPipe Face Landmarker (маски в видеозвонках) работает на WebAssembly
        scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:', ...cloudOrigin],
        // data:/blob: нужны, чтобы превью видео и медиа историй из памяти браузера можно было загрузить на сервер
        // cdn.jsdelivr.net и storage.googleapis.com — файлы и модель MediaPipe (маски в видеозвонках)
        connectSrc: ["'self'", wsOrigin, 'data:', 'blob:', 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com', ...cloudOrigin, ...zegoConnect],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
  }),
);

// Браузерные возможности отдаём только своей странице: камера/микрофон (звонки, кружки), показ экрана; остальное закрыто
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: '64kb' }));

// Лёгкий эндпоинт для «пинга»: не трогает базу, просто отвечает 200
app.get('/ping', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// ── API ──
app.use('/api', noStore, apiLimiter, originGuard);
app.use('/api/auth', authRouter);
app.use('/api/push', pushRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/posts', postsRouter);
app.use('/api/stories', storiesRouter);
app.use('/api/moments', momentsRouter);
app.use('/api/verification', verificationRouter);
app.use('/api/calls', callsRouter);
app.use('/api/support', supportRouter);
app.use('/api/titles', titlesRouter);
app.use('/api', usersRouter); // /api/me, /api/users/*, /api/me/devices
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ── Фронтенд (твои HTML/CSS/JS лежат в public/) ──
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      if (/(sw\.js|index\.html|manifest\.webmanifest|mchat-api\.js|mchat-ext\.js|mchat-fixes\.js|mchat-fixes\.css|mchat-features\.js|mchat-features\.css|i18n\.js|masks\.js|script\.js|style\.css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
      if (filePath.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
    },
  }),
);

// Адреса вида /profile/anna и /join/abc123 открывают то же одностраничное приложение;
// дальше по адресу решает script.js (открыть профиль / вступить в группу).
app.get(['/profile/:username', '/join/:code'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.code });
  if (err instanceof ZodError) return void res.status(400).json({ error: 'bad_request' });
  if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: 'bad_json' });
  if ((err as { type?: string }).type === 'entity.too.large') return void res.status(413).json({ error: 'too_large' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
};
app.use(onError);

ensureUploadDir();
if (config.isProd && storageMode === 'disk') {
  console.warn('[storage] Файлы хранятся на диске сервера и пропадут при следующем деплое. Задай S3_* (см. CHANGES-step4.md), чтобы они жили в облаке.');
}
import('./services/media').then((m) => m.checkMediaIntegrity()).catch((e) => console.error('media integrity', e));
const server = http.createServer(app);
const io = initSocket(server);

const expireNow = () => expireVerifications().catch((e) => console.error('expire verifications', e));
expireNow();
setInterval(expireNow, 5 * 60 * 1000).unref(); // срок галочки вышел — она исчезает (проверка раз в 5 минут)
setInterval(() => purgeExpiredAndBroadcast().catch((e) => console.error('purge disappearing messages', e)), 60 * 1000).unref(); // «очистка чата через 24 часа»
setInterval(() => purgeExpiredStories().catch((e) => console.error('purge stories', e)), 60 * 60 * 1000).unref();

// Чтобы бесплатный Render не засыпал: раз в 10 минут сервер сам стучится на свой /ping (только в проде)
if (config.isProd) {
  const SERVER_URL = config.appOrigin;
  setInterval(() => {
    fetch(`${SERVER_URL}/ping`).catch((e) => console.error('self ping', e instanceof Error ? e.message : e));
  }, 10 * 60 * 1000).unref();
}

server.listen(config.PORT, () => {
  console.log(`✅ Mchat запущен: ${config.appOrigin}  (порт ${config.PORT}, ${config.NODE_ENV})`);
});

const shutdown = async () => {
  console.log('Останавливаю сервер…');
  io.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);