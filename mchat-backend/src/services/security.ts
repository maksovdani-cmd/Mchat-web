import type { Request } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { emitToChat, emitToUser } from '../realtime/hub';
import { describeClient } from '../utils/device';
import { approxLocation } from '../utils/geo';
import { HttpError } from '../utils/errors';
import { messageInclude, toMessageDTO, type SystemCardDTO } from './chat';
import { revokeDevice } from './session';
import { sendSystemMessage } from './system';

/**
 * Подтверждение входа с нового устройства (вариант «вход ждёт подтверждения»).
 *
 * Как это работает:
 *  1. Новое устройство прошло Google, но у пользователя уже есть другое вошедшее устройство →
 *     создаются Device и Session(approval=PENDING). Такая сессия НИКУДА не пускается (REST и Socket.IO).
 *  2. LoginAlert связывает запрос с ОДНОЙ конкретной сессией. В чат «Mchat — Безопасность» приходит карточка
 *     с кнопками «Это я» / «Это не я» (и пуш на уже вошедшие устройства).
 *  3. «Это я» — сессия становится ACTIVE. «Это не я» — сессия и устройство немедленно отзываются на сервере.
 *  4. Не ответили за ALERT_TTL — вход отменяется (EXPIRED, сессия отозвана).
 *  5. Запасной путь — код из письма (routes/auth.ts), если другое устройство недоступно.
 *
 * Это подтверждение входа с доверенного устройства, а не полноценная двухфакторная аутентификация (TOTP/ключи).
 * Предел защиты: подтвердить может любая УЖЕ вошедшая сессия аккаунта — если злоумышленник давно владеет
 * активной сессией, он сможет подтвердить и чужой новый вход.
 */
export const alertTtlMs = () => config.codeTtlMs;

export const hasApprover = async (userId: string) =>
  (await prisma.session.count({
    where: { userId, approval: 'ACTIVE', revokedAt: null, expiresAt: { gt: new Date() }, device: { revokedAt: null } },
  })) > 0;

export async function createLoginAlert(req: Request, p: { userId: string; sessionId: string; deviceId: string; expiresAt: Date }) {
  const info = describeClient(req);
  const location = approxLocation(req); // null → в карточке «недоступно»; IP в карточку и в сообщение не попадает
  const alert = await prisma.loginAlert.create({
    data: {
      userId: p.userId, sessionId: p.sessionId, deviceId: p.deviceId, expiresAt: p.expiresAt,
      deviceType: info.type, os: info.os, client: info.client, location,
    },
  });
  const card: SystemCardDTO = {
    type: 'login_alert', alertId: alert.id, state: 'PENDING', deviceType: info.type, os: info.os, client: info.client,
    location, at: alert.createdAt.toISOString(), expiresAt: p.expiresAt.toISOString(), resolvedVia: null,
  };
  const { message, chatId } = await sendSystemMessage(p.userId, 'SECURITY', { kind: 'SYSTEM_CARD', text: JSON.stringify(card) }, {
    push: {
      title: 'Mchat — Безопасность',
      body: `Вход с нового устройства: ${[info.client, info.os].filter(Boolean).join(', ')}. Подтвердите или отклоните.`,
      tag: 'login-approve',
    },
  });
  await prisma.loginAlert.update({ where: { id: alert.id }, data: { messageId: message.id } });
  emitToUser(p.userId, 'security:alert', { alertId: alert.id, chatId });
  return alert;
}

/** Переписывает состояние в карточке и сообщает открытым чатам (без пометки «изменено»). */
async function syncCard(alertId: string) {
  const a = await prisma.loginAlert.findUnique({ where: { id: alertId } });
  if (!a?.messageId) return;
  const msg = await prisma.message.findUnique({ where: { id: a.messageId } });
  if (!msg) return;
  let card: SystemCardDTO;
  try { card = JSON.parse(msg.text) as SystemCardDTO; } catch { return; }
  card.state = a.state as SystemCardDTO['state'];
  card.resolvedVia = a.resolvedVia === 'EMAIL' ? 'EMAIL' : a.resolvedVia === 'DEVICE' ? 'DEVICE' : null;
  const updated = await prisma.message.update({ where: { id: msg.id }, data: { text: JSON.stringify(card) }, include: messageInclude });
  emitToChat(updated.chatId, 'message:edited', toMessageDTO(updated));
  emitToUser(a.userId, 'security:alert-resolved', { alertId: a.id, state: a.state });
}

export interface Resolver { sessionId: string; deviceId: string }

/**
 * Кнопки «Это я» / «Это не я». Защита:
 *  • алерт принадлежит вызывающему пользователю;
 *  • нажать может только ДРУГАЯ, уже существовавшая до запроса сессия — само проверяемое устройство подтвердить себя не может;
 *  • решение принимается один раз и атомарно (повторные и параллельные нажатия получают 409);
 *  • просроченный запрос подтвердить нельзя (410);
 *  • «Это не я» отзывает именно эту сессию и это устройство, остальные сессии пользователя не затрагиваются.
 */
export async function resolveLoginAlert(userId: string, by: Resolver, alertId: string, decision: 'CONFIRM' | 'DENY') {
  const alert = await prisma.loginAlert.findUnique({ where: { id: alertId } });
  if (!alert || alert.userId !== userId) throw new HttpError(404, 'alert_not_found');
  if (by.sessionId === alert.sessionId || by.deviceId === alert.deviceId) throw new HttpError(403, 'cannot_confirm_own_login');
  const caller = await prisma.session.findUnique({ where: { id: by.sessionId }, select: { createdAt: true } });
  if (!caller || caller.createdAt >= alert.createdAt) throw new HttpError(403, 'session_too_new'); // подтверждает только давно вошедшее устройство
  const now = new Date();
  if (alert.state === 'PENDING' && alert.expiresAt <= now) {
    await expireAlert(alert.id);
    throw new HttpError(410, 'alert_expired');
  }

  const state = decision === 'CONFIRM' ? 'CONFIRMED' : 'DENIED';
  const ok = await prisma.$transaction(async (tx) => {
    const won = await tx.loginAlert.updateMany({
      where: { id: alert.id, state: 'PENDING', expiresAt: { gt: now } },
      data: { state, resolvedAt: now, resolvedVia: 'DEVICE', resolvedBySessionId: by.sessionId },
    });
    if (won.count === 0) return false;
    if (decision === 'CONFIRM') {
      const s = await tx.session.updateMany({ where: { id: alert.sessionId, approval: 'PENDING', revokedAt: null }, data: { approval: 'ACTIVE' } });
      if (s.count === 0) throw new HttpError(410, 'session_gone'); // откатывает и алерт
    } else {
      await tx.session.updateMany({ where: { id: alert.sessionId, revokedAt: null }, data: { approval: 'DENIED', revokedAt: now } });
    }
    return true;
  });
  if (!ok) {
    const cur = await prisma.loginAlert.findUnique({ where: { id: alert.id }, select: { state: true } });
    throw new HttpError(409, cur?.state === 'EXPIRED' ? 'alert_expired' : 'alert_already_resolved');
  }
  if (decision === 'DENY') await revokeDevice(userId, alert.deviceId); // сессии, пуши и сокеты именно этого устройства
  await syncCard(alert.id);
  return { state } as const;
}

/** Подтверждение входа кодом из письма (запасной путь) — тот же автомат состояний, что и у кнопок. */
export async function confirmAlertByEmail(sessionId: string) {
  const now = new Date();
  const alert = await prisma.loginAlert.findUnique({ where: { sessionId } });
  if (!alert) return false;
  const ok = await prisma.$transaction(async (tx) => {
    const won = await tx.loginAlert.updateMany({
      where: { id: alert.id, state: 'PENDING', expiresAt: { gt: now } },
      data: { state: 'CONFIRMED', resolvedAt: now, resolvedVia: 'EMAIL' },
    });
    if (won.count === 0) return false;
    const s = await tx.session.updateMany({ where: { id: sessionId, approval: 'PENDING', revokedAt: null }, data: { approval: 'ACTIVE' } });
    if (s.count === 0) throw new HttpError(410, 'session_gone');
    return true;
  });
  if (ok) await syncCard(alert.id);
  return ok;
}

/** Время вышло: вход отменяется, сессия и устройство отзываются. Идемпотентно. */
export async function expireAlert(alertId: string) {
  const now = new Date();
  const alert = await prisma.loginAlert.findUnique({ where: { id: alertId } });
  if (!alert) return;
  const won = await prisma.loginAlert.updateMany({ where: { id: alertId, state: 'PENDING' }, data: { state: 'EXPIRED', resolvedAt: now } });
  if (won.count === 0) return;
  await prisma.session.updateMany({ where: { id: alert.sessionId, approval: 'PENDING', revokedAt: null }, data: { approval: 'EXPIRED', revokedAt: now } });
  await revokeDevice(alert.userId, alert.deviceId);
  await syncCard(alertId);
}

/** Раз в минуту: просроченные неподтверждённые входы отменяются. */
export async function expireStaleAlerts() {
  const stale = await prisma.loginAlert.findMany({ where: { state: 'PENDING', expiresAt: { lte: new Date() } }, select: { id: true }, take: 100 });
  for (const a of stale) await expireAlert(a.id).catch((e) => console.warn('expireAlert failed:', (e as Error).message));
}
