import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config';
import { prisma } from './db';
import { apiLimiter, originGuard } from './middleware/security';
import { initSocket } from './realtime/socket';
import { authRouter } from './routes/auth';
import { chatsRouter } from './routes/chats';
import { friendsRouter } from './routes/friends';
import { mediaRouter } from './routes/media';
import { messagesRouter } from './routes/messages';
import { pushRouter } from './routes/push';
import { usersRouter } from './routes/users';
import { ensureUploadDir } from './services/storage';
import { HttpError } from './utils/errors';

const app = express();
app.set('trust proxy', config.TRUST_PROXY); // корректный req.ip и req.protocol за Caddy/nginx
app.disable('x-powered-by');

// В проде: только HTTPS (а значит, и только WSS)
app.use((req, res, next) => {
  if (config.isProd && req.path !== '/healthz' && req.protocol !== 'https') {
    return res.redirect(301, `${config.appOrigin}${req.originalUrl}`);
  }
  next();
});

const wsOrigin = config.appOrigin.replace(/^http/, 'ws');
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
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", wsOrigin],
        workerSrc: ["'self'"],
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

app.use(cookieParser());
app.use(express.json({ limit: '64kb' }));

app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// ── API ──
app.use('/api', apiLimiter, originGuard);
app.use('/api/auth', authRouter);
app.use('/api/push', pushRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/media', mediaRouter);
app.use('/api', usersRouter); // /api/me, /api/users/*, /api/me/devices
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ── Фронтенд (твои HTML/CSS/JS лежат в public/) ──
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      if (/(sw\.js|index\.html|manifest\.webmanifest|mchat-api\.js)$/.test(filePath)) {
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
const server = http.createServer(app);
const io = initSocket(server);

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
