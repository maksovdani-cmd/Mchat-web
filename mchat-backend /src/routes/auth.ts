import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../db';
import { authOf, requireAuth } from '../middleware/auth';
import { authLimiter, codeLimiter } from '../middleware/security';
import { emitToUser, isConnected } from '../realtime/hub';
import { sendLoginCodeEmail } from '../services/mailer';
import { sendPushToUser } from '../services/push';
import {
  COOKIE, createDevice, dropCookie, findTrustedDevice, revokeSession, setCookie, setDeviceCookie, startSession,
} from '../services/session';
import { generateCode, hashCode, randomToken, safeEqualHex, sha256Buf, signJwt, verifyJwt } from '../utils/crypto';
import { clientIp, deviceLabel } from '../utils/device';
import { HttpError, wrap } from '../utils/errors';
import { validateUsername } from '../utils/validate';

export const authRouter = Router();

const oauth = new OAuth2Client(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.googleRedirectUri);

/** Ошибки OAuth-потока возвращаем на главную с кодом — фронт показывает понятный текст. */
const fail = (res: Response, code: string) => res.redirect(`/?auth_error=${encodeURIComponent(code)}`);

const strEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ─────────────────────────────────────────────────────────────
// 1. Старт: браузер уходит в Google
//    GET /api/auth/google/start?username=nick   (username нужен только новым пользователям)
// ─────────────────────────────────────────────────────────────
authRouter.get('/google/start', authLimiter, (req, res) => {
  const raw = typeof req.query.username === 'string' ? req.query.username : '';
  let username: string | null = null;
  if (raw.trim()) {
    const v = validateUsername(raw);
    if (!v.ok) return fail(res, `nick_${v.reason}`);
    username = v.value;
  }

  const state = randomToken(24); // защита от CSRF при логине
  const nonce = randomToken(24); // привязка id_token к этому запросу
  const verifier = randomToken(48); // PKCE
  const challenge = sha256Buf(verifier).toString('base64url');

  setCookie(res, COOKIE.oauth, signJwt({ state, nonce, cv: verifier, u: username }, 600), 600_000);

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account', // «Выбрал аккаунт»
  }).toString();
  res.redirect(url.toString());
});

// ─────────────────────────────────────────────────────────────
// 2. Возврат из Google
// ─────────────────────────────────────────────────────────────
authRouter.get(
  '/google/callback',
  authLimiter,
  wrap(async (req, res) => {
    const saved = verifyJwt<{ state: string; nonce: string; cv: string; u: string | null }>(req.cookies?.[COOKIE.oauth]);
    dropCookie(res, COOKIE.oauth);
    if (!saved || typeof req.query.state !== 'string' || !strEq(req.query.state, saved.state)) return fail(res, 'bad_state');
    if (req.query.error) return fail(res, 'google_denied');
    const code = req.query.code;
    if (typeof code !== 'string') return fail(res, 'google_failed');

    let payload;
    try {
      const { tokens } = await oauth.getToken({ code, codeVerifier: saved.cv });
      if (!tokens.id_token) throw new Error('no id_token');
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (e) {
      console.error('google auth error:', (e as Error).message);
      return fail(res, 'google_failed');
    }
    if (!payload?.sub || !payload.email || !payload.email_verified || payload.nonce !== saved.nonce) {
      return fail(res, 'google_failed');
    }

    const email = payload.email.toLowerCase();
    const wantsAdmin = config.adminEmails.includes(email);
    const existing = await prisma.user.findUnique({ where: { googleId: payload.sub } });

    // ── РЕГИСТРАЦИЯ: ник + Google, без кода ──
    if (!existing) {
      if (!saved.u) return fail(res, 'nick_required');
      let user;
      try {
        user = await prisma.user.create({
          data: {
            googleId: payload.sub,
            email,
            username: saved.u,
            name: ((payload.name || '').replace(/[<>]/g, '').trim() || saved.u).slice(0, 40),
            avatarUrl: payload.picture ?? null,
            role: wantsAdmin ? 'ADMIN' : 'USER',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // формат meta.target зависит от драйвера — надёжнее спросить базу напрямую
          const taken = await prisma.user.findUnique({ where: { username: saved.u }, select: { id: true } });
          return fail(res, taken ? 'nick_taken' : 'account_conflict');
        }
        throw e;
      }
      const { device, raw } = await createDevice(user.id, req);
      setDeviceCookie(res, raw);
      await startSession(res, user.id, device.id);
      return res.redirect('/');
    }

    // ── ВХОД: известное устройство → сразу; новое → код ──
    if (wantsAdmin && existing.role !== 'ADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    }
    const trusted = await findTrustedDevice(existing.id, req.cookies?.[COOKIE.device]);
    if (trusted) {
      await startSession(res, existing.id, trusted.id);
      return res.redirect('/');
    }
    return beginDeviceVerification(req, res, existing);
  }),
);

/** Новое устройство: генерируем код и доставляем его на УЖЕ вошедшие устройства (как Telegram). */
async function beginDeviceVerification(req: Request, res: Response, user: { id: string; email: string }) {
  const recent = await prisma.loginCode.count({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
  });
  if (recent >= 5) return fail(res, 'too_many_codes');

  const code = generateCode();
  const label = deviceLabel(req);
  const ip = clientIp(req);
  const expiresAt = new Date(Date.now() + config.codeTtlMs);
  const rec = await prisma.loginCode.create({
    data: { userId: user.id, codeHash: hashCode(user.id, code), label, ip, expiresAt },
  });

  // Канал 1: живое соединение (Socket.IO) на уже вошедших устройствах
  const viaSocket = isConnected(user.id);
  emitToUser(user.id, 'auth:login-code', { code, label, ip, expiresAt: expiresAt.toISOString() });
  // Канал 2: пуш-уведомление на телефон/браузер
  const pushed = await sendPushToUser(user.id, {
    title: 'Вход в Mchat с нового устройства',
    body: `Код: ${code}. Устройство: ${label}. Если это не вы — никому не сообщайте код.`,
    tag: 'login-code',
    data: { kind: 'login-code' },
  });
  // Канал 3: если доставить некуда — сразу почта (иначе человек навсегда за дверью)
  let emailSent = false;
  if (!viaSocket && pushed === 0) emailSent = await sendLoginCodeEmail(user.email, code, label);
  if (emailSent) await prisma.loginCode.update({ where: { id: rec.id }, data: { emailSent: true } });

  setCookie(res, COOKIE.pending, signJwt({ cid: rec.id, uid: user.id }, 600), 600_000);
  return res.redirect('/?auth=code');
}

// ─────────────────────────────────────────────────────────────
// 3. Экран ввода кода
// ─────────────────────────────────────────────────────────────
function getPending(req: Request) {
  const p = verifyJwt<{ cid?: string; uid?: string }>(req.cookies?.[COOKIE.pending]);
  if (!p?.cid || !p.uid) throw new HttpError(401, 'no_pending_login');
  return { cid: p.cid, uid: p.uid };
}

const maskEmail = (e: string) => {
  const [n = '', d = ''] = e.split('@');
  return `${n.slice(0, 2)}***@${d}`;
};

authRouter.get(
  '/pending',
  wrap(async (req, res) => {
    const { cid } = getPending(req);
    const rec = await prisma.loginCode.findUnique({ where: { id: cid }, include: { user: { select: { email: true } } } });
    if (!rec || rec.consumedAt || rec.expiresAt < new Date()) throw new HttpError(410, 'code_expired');
    res.json({
      emailMasked: maskEmail(rec.user.email),
      emailSent: rec.emailSent,
      canSendEmail: config.ALLOW_EMAIL_FALLBACK && !rec.emailSent,
      attemptsLeft: Math.max(0, config.codeMaxAttempts - rec.attempts),
      expiresAt: rec.expiresAt.toISOString(),
    });
  }),
);

authRouter.post(
  '/verify-code',
  codeLimiter,
  wrap(async (req, res) => {
    const { cid, uid } = getPending(req);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);

    // Атомарно «съедаем» попытку ДО проверки — параллельным перебором лимит не обойти
    const taken = await prisma.loginCode.updateMany({
      where: { id: cid, userId: uid, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: config.codeMaxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (taken.count === 0) throw new HttpError(410, 'code_expired');

    const rec = await prisma.loginCode.findUniqueOrThrow({ where: { id: cid } });
    if (!safeEqualHex(rec.codeHash, hashCode(uid, code))) {
      return void res.status(400).json({ error: 'invalid_code', attemptsLeft: Math.max(0, config.codeMaxAttempts - rec.attempts) });
    }

    // Одноразовость: только один запрос сможет пометить код использованным
    const consumed = await prisma.loginCode.updateMany({ where: { id: cid, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw new HttpError(409, 'code_used');

    const { device, raw } = await createDevice(uid, req); // устройство становится доверенным
    setDeviceCookie(res, raw);
    await startSession(res, uid, device.id);
    dropCookie(res, COOKIE.pending);
    emitToUser(uid, 'auth:new-device', { label: device.label }); // «в ваш аккаунт вошли с …»
    res.json({ ok: true });
  }),
);

/** Запасной путь: новый код на email из Google-аккаунта (можно выключить ALLOW_EMAIL_FALLBACK=false). */
authRouter.post(
  '/send-email-code',
  codeLimiter,
  wrap(async (req, res) => {
    if (!config.ALLOW_EMAIL_FALLBACK) throw new HttpError(403, 'email_disabled');
    const { cid, uid } = getPending(req);

    const lock = await prisma.loginCode.updateMany({
      where: { id: cid, userId: uid, consumedAt: null, emailSent: false, expiresAt: { gt: new Date() } },
      data: { emailSent: true },
    });
    if (lock.count === 0) throw new HttpError(409, 'already_sent');

    const [rec, user] = await Promise.all([
      prisma.loginCode.findUniqueOrThrow({ where: { id: cid } }),
      prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { email: true } }),
    ]);
    const code = generateCode(); // новый код (старый в базе хранится только как хэш)
    const ok = await sendLoginCodeEmail(user.email, code, rec.label);
    if (!ok) {
      await prisma.loginCode.update({ where: { id: cid }, data: { emailSent: false } });
      throw new HttpError(502, 'email_failed');
    }
    await prisma.loginCode.update({ where: { id: cid }, data: { codeHash: hashCode(uid, code) } });
    res.json({ ok: true });
  }),
);

// ─────────────────────────────────────────────────────────────
// 4. Выход (устройство остаётся доверенным, сессия отзывается на сервере)
// ─────────────────────────────────────────────────────────────
authRouter.post(
  '/logout',
  requireAuth,
  wrap(async (req, res) => {
    const a = authOf(req);
    // чтобы следующий человек на этом браузере не получал чужие пуши
    await prisma.pushSubscription.deleteMany({ where: { userId: a.userId, deviceId: a.deviceId } });
    await revokeSession(a.sessionId);
    dropCookie(res, COOKIE.session);
    res.json({ ok: true });
  }),
);
