import crypto from 'node:crypto';
import { prisma } from '../db';
import { config } from '../config';
import { emitToChat } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { assertMember } from './chat';
import { mediaUrl } from './media';
import { removeFile } from './storage';

/** Сколько минут после открытия получатель может смотреть/слушать. Потом файл удаляется сервером, даже если приложение закрыли. */
export const VIEW_ONCE_WINDOW_MIN = 20;
export const VIEW_ONCE_KINDS = ['IMAGE', 'VIDEO', 'VOICE', 'VIDEO_NOTE'] as const;

const sign = (messageId: string, mediaId: string, userId: string, exp: number) =>
  crypto.createHmac('sha256', config.JWT_SECRET).update(`vo|${messageId}|${mediaId}|${userId}|${exp}`).digest('hex').slice(0, 40);

/** Проверка ссылки на одноразовый файл (используется в GET /api/media/:id). */
export async function viewOnceMediaAllowed(userId: string, mediaId: string, token: string | undefined): Promise<'free' | 'ok' | 'deny'> {
  const m = await prisma.message.findFirst({ where: { mediaId, viewOnce: true }, select: { id: true, viewOnceOpenedBy: true, deletedAt: true } });
  if (!m) return 'free';                                    // файл не одноразовый — обычные правила доступа
  if (m.deletedAt || m.viewOnceOpenedBy !== userId || !token) return 'deny';
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!exp || exp < Date.now() || !sig) return 'deny';
  const want = sign(m.id, mediaId, userId, exp);
  const a = Buffer.from(sig), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'deny';
}

/** Получатель нажал на одноразовое медиа: открыть можно ТОЛЬКО ОДИН раз. Возвращает временную ссылку. */
export async function openViewOnce(userId: string, messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg || msg.deletedAt) throw new HttpError(410, 'view_once_gone');
  await assertMember(msg.chatId, userId);
  if (!msg.viewOnce || !msg.mediaId) throw new HttpError(400, 'bad_request');
  if (msg.senderId === userId) throw new HttpError(403, 'view_once_sender');   // отправитель свой файл уже не откроет
  const r = await prisma.message.updateMany({
    where: { id: messageId, viewOnce: true, viewOnceOpenedAt: null, deletedAt: null },
    data: { viewOnceOpenedAt: new Date(), viewOnceOpenedBy: userId },
  });
  if (r.count === 0) throw new HttpError(410, 'view_once_gone');               // уже открывали
  const exp = Date.now() + VIEW_ONCE_WINDOW_MIN * 60_000;
  const token = `${exp}.${sign(messageId, msg.mediaId, userId, exp)}`;
  return { url: `${mediaUrl(msg.mediaId)}?vo=${encodeURIComponent(token)}`, kind: msg.kind, durationSec: msg.durationSec, expiresAt: new Date(exp).toISOString() };
}

/** Навсегда стереть одноразовое медиа: файл, запись в БД и само сообщение (у обоих). */
export async function destroyViewOnce(messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, chatId: true, mediaId: true, deletedAt: true } });
  if (!msg || msg.deletedAt) return false;
  await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), text: '', mediaId: null } });
  if (msg.mediaId) {
    const media = await prisma.media.findUnique({ where: { id: msg.mediaId }, select: { id: true, file: true } });
    if (media) {
      await prisma.media.delete({ where: { id: media.id } }).catch(() => {});
      await removeFile(media.file).catch(() => {});
    }
  }
  await prisma.chat.updateMany({ where: { id: msg.chatId, pinnedMessageId: messageId }, data: { pinnedMessageId: null } });
  emitToChat(msg.chatId, 'message:deleted', { id: msg.id, chatId: msg.chatId });
  return true;
}

/** Получатель закрыл просмотр / дослушал: удаляем. */
export async function closeViewOnce(userId: string, messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { viewOnce: true, viewOnceOpenedBy: true } });
  if (!msg || !msg.viewOnce || msg.viewOnceOpenedBy !== userId) throw new HttpError(403, 'forbidden');
  await destroyViewOnce(messageId);
  return { ok: true };
}

/** Страховка: открыл и закрыл приложение/пропала связь — через окно просмотра файл всё равно стирается. */
export async function purgeViewOnce() {
  const cutoff = new Date(Date.now() - (VIEW_ONCE_WINDOW_MIN + 1) * 60_000);
  const stale = await prisma.message.findMany({ where: { viewOnce: true, deletedAt: null, viewOnceOpenedAt: { lt: cutoff } }, select: { id: true }, take: 200 });
  for (const m of stale) await destroyViewOnce(m.id).catch((e) => console.error('view-once purge', e));
}
