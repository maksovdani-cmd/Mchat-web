import crypto from 'node:crypto';
import { prisma } from '../db';
import { config } from '../config';
import { emitToChat, emitToUser } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { assertMember } from './chat';
import { mediaUrl } from './media';
import { removeFile } from './storage';

/** Сколько минут после открытия получатель может смотреть/слушать. Потом файл удаляется сервером, даже если приложение закрыли. */
export const VIEW_ONCE_WINDOW_MIN = 20;
export const VIEW_ONCE_GROUP_TTL_DAYS = 14;
export const VIEW_ONCE_KINDS = ['IMAGE', 'VIDEO', 'VOICE'] as const;   // кружки (VIDEO_NOTE) — никогда не одноразовые

const sign = (messageId: string, mediaId: string, userId: string, exp: number) =>
  crypto.createHmac('sha256', config.JWT_SECRET).update(`vo|${messageId}|${mediaId}|${userId}|${exp}`).digest('hex').slice(0, 40);

/** Проверка ссылки на одноразовый файл (используется в GET /api/media/:id). */
export async function viewOnceMediaAllowed(userId: string, mediaId: string, token: string | undefined): Promise<'free' | 'ok' | 'deny'> {
  const m = await prisma.message.findFirst({ where: { mediaId, viewOnce: true }, select: { id: true, viewOnceOpenedBy: true, deletedAt: true } });
  if (!m) return 'free';                                    // файл не одноразовый — обычные правила доступа
  if (m.deletedAt || !token) return 'deny';
  // доступ только у того, кто открыл (в группе — у каждого получателя свой просмотр) и пока он не закрыт
  const view = await prisma.viewOnceView.findUnique({ where: { messageId_userId: { messageId: m.id, userId } }, select: { closedAt: true } });
  if (view ? view.closedAt : m.viewOnceOpenedBy !== userId) return 'deny';
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
  // сообщение открыли ещё до появления таблицы просмотров (старые данные) — повторно не открываем
  if (msg.viewOnceOpenedAt && (await prisma.viewOnceView.count({ where: { messageId } })) === 0) throw new HttpError(410, 'view_once_gone');
  // уникальность (messageId, userId) защищает от параллельных запросов и повторных открытий: второй запрос получает 410
  try { await prisma.viewOnceView.create({ data: { messageId, userId } }); }
  catch { throw new HttpError(410, 'view_once_gone'); }
  if (msg.viewOnceOpenedAt === null) await prisma.message.updateMany({ where: { id: messageId, viewOnceOpenedAt: null }, data: { viewOnceOpenedAt: new Date(), viewOnceOpenedBy: userId } });
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

/** Завершить просмотр одним получателем. В личном чате сообщение удаляется сразу, в группе — у него одного; у всех — когда посмотрели все. */
async function finishView(userId: string, messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, chatId: true, senderId: true, viewOnce: true, deletedAt: true, chat: { select: { type: true } } } });
  if (!msg || !msg.viewOnce || msg.deletedAt) return;
  await prisma.viewOnceView.updateMany({ where: { messageId, userId, closedAt: null }, data: { closedAt: new Date() } });
  if (msg.chat.type !== 'GROUP') { await destroyViewOnce(messageId); return; }
  await prisma.messageHide.createMany({ data: [{ messageId, userId }], skipDuplicates: true });
  emitToUser(userId, 'message:deleted', { id: messageId, chatId: msg.chatId });
  const [recipients, done] = await Promise.all([
    prisma.chatMember.count({ where: { chatId: msg.chatId, userId: { not: msg.senderId ?? '' } } }),
    prisma.viewOnceView.count({ where: { messageId, closedAt: { not: null } } }),
  ]);
  if (done >= recipients) await destroyViewOnce(messageId);                    // все получатели посмотрели — файл стирается навсегда
}

/** Получатель закрыл просмотр / дослушал. */
export async function closeViewOnce(userId: string, messageId: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { viewOnce: true, viewOnceOpenedBy: true } });
  if (!msg || !msg.viewOnce) throw new HttpError(403, 'forbidden');
  const view = await prisma.viewOnceView.findUnique({ where: { messageId_userId: { messageId, userId } } });
  if (!view && msg.viewOnceOpenedBy !== userId) throw new HttpError(403, 'forbidden');
  await finishView(userId, messageId);
  return { ok: true };
}

/** Страховка: открыл и закрыл приложение/пропала связь — через окно просмотра файл всё равно стирается. */
export async function purgeViewOnce() {
  const cutoff = new Date(Date.now() - (VIEW_ONCE_WINDOW_MIN + 1) * 60_000);
  const stale = await prisma.viewOnceView.findMany({ where: { closedAt: null, openedAt: { lt: cutoff } }, select: { messageId: true, userId: true }, take: 200 });
  for (const v of stale) await finishView(v.userId, v.messageId).catch((e) => console.error('view-once purge', e));
  // старые записи без строки просмотра (открыты до обновления)
  const legacy = await prisma.message.findMany({ where: { viewOnce: true, deletedAt: null, viewOnceOpenedAt: { lt: cutoff }, viewOnceViews: { none: {} } }, select: { id: true }, take: 200 });
  for (const m of legacy) await destroyViewOnce(m.id).catch((e) => console.error('view-once purge', e));
  // в группе не открытое никем медиа не должно жить вечно
  const old = await prisma.message.findMany({ where: { viewOnce: true, deletedAt: null, createdAt: { lt: new Date(Date.now() - VIEW_ONCE_GROUP_TTL_DAYS * 86_400_000) } }, select: { id: true }, take: 200 });
  for (const m of old) await destroyViewOnce(m.id).catch((e) => console.error('view-once purge', e));
}