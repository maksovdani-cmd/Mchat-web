import webpush from 'web-push';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError } from '../utils/errors';

webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

/**
 * Защита от SSRF: сервер сам делает HTTP-запрос на endpoint из подписки, поэтому
 * принимаем только настоящие push-сервисы браузеров, а не произвольные адреса.
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  '.push.apple.com',
  '.notify.windows.com',
];

export function assertPushEndpoint(endpoint: string) {
  let u: URL;
  try { u = new URL(endpoint); } catch { throw new HttpError(400, 'bad_endpoint'); }
  const ok = u.protocol === 'https:' && PUSH_HOSTS.some((h) => (h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h));
  if (!ok) throw new HttpError(400, 'bad_endpoint');
}

export async function saveSubscription(
  userId: string,
  deviceId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  assertPushEndpoint(sub.endpoint);
  // endpoint уникален для браузера: при смене пользователя на том же устройстве подписка переезжает к новому
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, deviceId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId, deviceId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removeSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function hasPushChannel(userId: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { userId } })) > 0;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: 'high' },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: s.id } }); // подписка протухла
        } else {
          console.warn('push error', code ?? (e as Error).message);
        }
      }
    }),
  );
  return sent;
}
