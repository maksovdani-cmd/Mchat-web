import crypto from 'node:crypto';
import { prisma } from '../db';
import { config } from '../config';
import { emitToUser } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { assertMember, directAccess, isGroupType, listContacts } from './chat';
import { postCallCard } from './messaging';
import { sendPushToUser } from './push';

/** Звонок живёт в памяти сервера (он короткий; после перезапуска активные звонки просто закончатся). */
interface Call {
  id: string;
  chatId: string;
  isGroup: boolean;
  title: string;
  video: boolean;
  initiatorId: string;
  roomId: string;        // комната ZEGOCLOUD (создаётся сама при первом входе, REST-вызовов не нужно)
  joined: Set<string>;   // кто сейчас в комнате
  invited: Set<string>;  // кого звонят и кто ещё не ответил
  pushed: Set<string>;   // кому ушёл push «входящий звонок» (им же отправим «звонок окончен», чтобы уведомление не висело)
  allowed: Set<string>;  // кому можно получить токен
  timer: NodeJS.Timeout | null;
  startedAt: number;                       // когда начали звонить (для истории звонков)
  answeredAt: number | null;               // когда кто-то ответил (с этого момента идёт «длительность разговора»)
  presence: Map<string, { from: number; to: number | null }>; // кто и когда был в разговоре
}
const calls = new Map<string, Call>();
const RING_MS = 45_000;

export const callsEnabled = () => !!config.ZEGO_APP_ID && !!config.ZEGO_SERVER_SECRET;

const TOKEN_TTL_SEC = 2 * 60 * 60;

/**
 * Токен ZEGOCLOUD token04 (AES-256-GCM) — алгоритм из официального zego_server_assistant.
 * Токен привязан к одной комнате и пользователю: войти в чужой звонок с ним нельзя.
 */
function generateToken04(appId: number, userId: string, secret: string, ttlSec: number, payload: string): string {
  const ctime = Math.floor(Date.now() / 1000);
  const info = {
    app_id: appId,
    user_id: userId,
    nonce: crypto.randomInt(-(2 ** 31), 2 ** 31),
    ctime,
    expire: ctime + ttlSec,
    payload,
  };
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(info), 'utf8'), cipher.final(), cipher.getAuthTag()]);

  const expire = Buffer.alloc(8); expire.writeBigInt64BE(BigInt(info.expire));
  const nonceLen = Buffer.alloc(2); nonceLen.writeUInt16BE(nonce.length);
  const dataLen = Buffer.alloc(2); dataLen.writeUInt16BE(encrypted.length);
  const mode = Buffer.from([1]); // 1 = GCM
  return '04' + Buffer.concat([expire, nonceLen, nonce, dataLen, encrypted, mode]).toString('base64');
}

/** Данные, которые клиенту нужны для входа в комнату ZEGOCLOUD. */
async function tokenFor(call: Call, userId: string) {
  if (!callsEnabled()) throw new HttpError(503, 'calls_disabled');
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, username: true } });
  const appId = config.ZEGO_APP_ID!;
  let token: string;
  try {
    token = generateToken04(appId, userId, config.ZEGO_SERVER_SECRET!, TOKEN_TTL_SEC, JSON.stringify({
      room_id: call.roomId,
      privilege: { 1: 1, 2: 1 }, // 1 — вход в комнату, 2 — публикация звука/видео
      stream_id_list: null,
    }));
  } catch (e) {
    console.error('ZEGO: не удалось создать токен:', (e as Error).message);
    throw new HttpError(502, 'calls_bad_key');
  }
  return {
    token,
    appId,
    roomId: call.roomId,
    userId,
    userName: u.name || u.username,
    server: config.ZEGO_SERVER || `wss://webliveroom${appId}-api.zegocloud.com/ws`,
  };
}

const userBrief = (u: { id: string; username: string; name: string; avatarUrl: string | null }) => ({
  id: u.id, username: u.username, name: u.name || u.username, avatar: u.avatarUrl,
});

function getCall(id: string): Call {
  const c = calls.get(id);
  if (!c) throw new HttpError(404, 'call_not_found');
  return c;
}

/** Звонок окончен: пишем строку в историю и карточку «Разговор длился…» в чат. */
async function recordCall(call: Call, reason: string) {
  const endedAt = Date.now();
  const answered = call.answeredAt;
  const status = answered ? 'ENDED' : reason === 'declined' ? 'DECLINED' : 'MISSED';
  const durationSec = answered ? Math.max(1, Math.round((endedAt - answered) / 1000)) : 0;
  try {
    const existing = await prisma.user.findMany({ where: { id: { in: [...call.allowed] } }, select: { id: true } });
    const users = existing.map((u) => {
      const p = call.presence.get(u.id);
      return { userId: u.id, joined: !!p && (u.id === call.initiatorId ? !!answered : true), durationSec: p ? Math.max(0, Math.round(((p.to ?? endedAt) - p.from) / 1000)) : 0 };
    });
    const initiator = await prisma.user.findUnique({ where: { id: call.initiatorId }, select: { id: true } });
    await prisma.callLog.create({
      data: {
        callId: call.id, chatId: call.chatId, initiatorId: initiator ? initiator.id : null, video: call.video, isGroup: call.isGroup, title: call.title,
        status, startedAt: new Date(call.startedAt), answeredAt: answered ? new Date(answered) : null, endedAt: new Date(endedAt), durationSec,
        users: { create: users },
      },
    });
    if (initiator) {
      await postCallCard(call.chatId, initiator.id, {
        callId: call.id, status: status === 'ENDED' ? 'ended' : status === 'DECLINED' ? 'declined' : 'missed',
        video: call.video, isGroup: call.isGroup, durationSec,
      });
    }
  } catch (e) {
    console.error('call history:', e instanceof Error ? e.message : e);
  }
}

function finish(call: Call, reason: string) {
  if (call.timer) clearTimeout(call.timer);
  if (!calls.has(call.id)) return;
  calls.delete(call.id);
  for (const p of call.presence.values()) if (p.to === null) p.to = Date.now();
  void recordCall(call, reason);
  // комната ZEGOCLOUD исчезает сама, когда из неё выходят все; токены привязаны к roomId и скоро истекут
  const everyone = new Set([...call.joined, ...call.invited]);
  for (const uid of everyone) emitToUser(uid, 'call:ended', { callId: call.id, reason });
  notifyCallEnded(call, reason);
}

/**
 * Приложение закрыто — сокета нет, и «call:ended» не дойдёт. Поэтому тем, кому звонили пушем, шлём второй push:
 * уведомление «Входящий звонок» заменяется (тот же tag) на «Пропущенный звонок» либо просто закрывается.
 */
function notifyCallEnded(call: Call, reason: string) {
  const targets = [...call.pushed].filter((uid) => !call.presence.has(uid)); // те, кто так и не ответил
  if (!targets.length) return;
  void (async () => {
    const caller = await prisma.user.findUnique({ where: { id: call.initiatorId }, select: { name: true, username: true } }).catch(() => null);
    const who = caller ? caller.name || caller.username : '';
    for (const uid of targets) {
      const missed = reason === 'missed' && !call.answeredAt;
      sendPushToUser(uid, {
        title: missed ? 'Пропущенный звонок' : 'Звонок завершён',
        body: missed ? `${call.isGroup && call.title ? call.title + ' · ' : ''}${who}` : '',
        tag: 'call-' + call.id,
        data: { kind: 'call-end', callId: call.id, chatId: call.chatId, reason, missed },
        ttl: 120, urgency: 'high',
      }).catch(() => {});
    }
  })();
}

async function ring(call: Call, uids: string[]) {
  const caller = await prisma.user.findUniqueOrThrow({
    where: { id: call.initiatorId }, select: { id: true, username: true, name: true, avatarUrl: true },
  });
  for (const uid of uids) {
    call.invited.add(uid); call.allowed.add(uid); call.pushed.add(uid);
    emitToUser(uid, 'call:incoming', {
      callId: call.id, chatId: call.chatId, video: call.video, isGroup: call.isGroup, title: call.title, from: userBrief(caller),
    });
    sendPushToUser(uid, {
      title: call.video ? 'Входящий видеозвонок' : 'Входящий звонок', body: `${call.isGroup && call.title ? call.title + ' · ' : ''}${caller.name || caller.username}`,
      tag: 'call-' + call.id, data: { kind: 'call', chatId: call.chatId, callId: call.id, video: call.video }, ttl: 45, urgency: 'high',
    }).catch(() => {});
  }
  if (call.timer) clearTimeout(call.timer);
  // никто не ответил — прекращаем звонить
  call.timer = setTimeout(() => {
    if (!calls.has(call.id)) return;
    for (const uid of call.invited) emitToUser(uid, 'call:ended', { callId: call.id, reason: 'missed' });
    call.invited.clear();
    if (call.joined.size <= 1) finish(call, 'missed');
  }, RING_MS);
  call.timer.unref?.();
}

export async function startCall(userId: string, chatId: string, video: boolean) {
  if (!callsEnabled()) throw new HttpError(503, 'calls_disabled');
  const m = await assertMember(chatId, userId);
  if (m.chat.type === 'CHANNEL') throw new HttpError(400, 'no_calls_in_channel');
  if (m.chat.type === 'SAVED') throw new HttpError(400, 'no_calls_in_saved');
  // групповой звонок запускают только владелец и админы группы
  if (m.chat.type === 'GROUP' && m.role === 'MEMBER') throw new HttpError(403, 'group_call_admin_only');
  if (m.chat.type === 'DIRECT') {
    const acc = await directAccess(userId, chatId); // подписки и чёрный список действуют и на звонки
    if (!acc.ok) throw new HttpError(403, acc.reason ?? 'dm_follow_required');
  }
  const members = await prisma.chatMember.findMany({ where: { chatId, userId: { not: userId } }, select: { userId: true } });
  if (!members.length) throw new HttpError(400, 'nobody_to_call');
  // одновременно у человека один звонок. Старый (в том числе «зависший» после закрытой вкладки) просто покидаем.
  for (const c of [...calls.values()]) {
    if (c.joined.has(userId)) await leaveCall(userId, c.id);
  }
  const id = crypto.randomUUID();
  const call: Call = {
    id, chatId, isGroup: m.chat.type === 'GROUP', title: m.chat.title ?? '', video,
    roomId: 'call_' + id.replace(/-/g, ''),
    initiatorId: userId, joined: new Set([userId]), invited: new Set(), pushed: new Set(), allowed: new Set([userId]), timer: null,
    startedAt: Date.now(), answeredAt: null, presence: new Map([[userId, { from: Date.now(), to: null }]]),
  };
  calls.set(call.id, call);
  await ring(call, members.map((x) => x.userId));
  return { callId: call.id, ...(await tokenFor(call, userId)) };
}

export async function acceptCall(userId: string, callId: string) {
  const call = getCall(callId);
  if (!call.allowed.has(userId)) throw new HttpError(403, 'forbidden');
  call.invited.delete(userId);
  call.joined.add(userId);
  call.presence.set(userId, { from: Date.now(), to: null });
  if (!call.answeredAt && userId !== call.initiatorId) call.answeredAt = Date.now(); // разговор начался
  // остальные устройства этого пользователя перестают звонить
  emitToUser(userId, 'call:handled', { callId });
  // на остальных устройствах (в том числе закрытых) уведомление о звонке должно исчезнуть
  if (call.pushed.has(userId)) {
    sendPushToUser(userId, { title: 'Mchat', body: '', tag: 'call-' + call.id, data: { kind: 'call-end', callId, chatId: call.chatId, reason: 'handled', missed: false }, ttl: 60, urgency: 'high' }).catch(() => {});
  }
  return { callId, video: call.video, isGroup: call.isGroup, chatId: call.chatId, ...(await tokenFor(call, userId)) };
}

export async function declineCall(userId: string, callId: string) {
  const call = calls.get(callId);
  if (!call) return { ok: true };
  call.invited.delete(userId);
  emitToUser(userId, 'call:handled', { callId });
  // личный звонок отклонён — заканчиваем; в группе звонок продолжается, пока в нём кто-то есть
  if (!call.isGroup) finish(call, 'declined');
  else if (call.joined.size <= 1 && call.invited.size === 0) finish(call, 'declined');
  return { ok: true };
}

export async function leaveCall(userId: string, callId: string) {
  const call = calls.get(callId);
  if (!call) return { ok: true };
  call.joined.delete(userId);
  call.invited.delete(userId);
  const pr = call.presence.get(userId); if (pr && pr.to === null) pr.to = Date.now();
  if (!call.isGroup || call.joined.size === 0) finish(call, 'ended');
  else if (call.joined.size === 1 && call.invited.size === 0) finish(call, 'ended'); // остался один — звонок окончен
  return { ok: true };
}

/** «Добавить участника»: звоним человеку из контактов; он получает обычное входящее. */
export async function inviteToCall(userId: string, callId: string, userIds: string[]) {
  const call = getCall(callId);
  if (!call.joined.has(userId)) throw new HttpError(403, 'forbidden');
  const cm = await assertMember(call.chatId, userId);
  if (cm.chat.type === 'GROUP' && cm.role === 'MEMBER') throw new HttpError(403, 'group_call_admin_only');
  const contactIds = new Set((await listContacts(userId)).map((c) => c.id));
  const members = await prisma.chatMember.findMany({ where: { chatId: call.chatId }, select: { userId: true } });
  members.forEach((m) => contactIds.add(m.userId));
  const targets = [...new Set(userIds)].filter((id) => id !== userId && !call.joined.has(id) && contactIds.has(id));
  if (!targets.length) throw new HttpError(400, 'nobody_to_call');
  call.isGroup = true; // с третьим участником это уже групповой звонок
  await ring(call, targets);
  return { invited: targets.length };
}

/** Последнее соединение пользователя оборвалось — он выходит из всех своих звонков. */
export function dropUserFromCalls(userId: string) {
  for (const c of [...calls.values()]) {
    if (c.joined.has(userId) || c.invited.has(userId)) leaveCall(userId, c.id).catch(() => {});
  }
}

export function callStatus() {
  return { enabled: callsEnabled(), provider: 'zegocloud' };
}


// ───────────────────────── история звонков ─────────────────────────

export interface CallHistoryItem {
  id: string;
  callId: string;
  chatId: string;
  /** outgoing — я звонил; incoming — мне звонили и я ответил; missed — пропущенный; declined — я/собеседник отклонил */
  direction: 'outgoing' | 'incoming' | 'missed' | 'declined';
  status: 'ENDED' | 'MISSED' | 'DECLINED';
  video: boolean;
  isGroup: boolean;
  name: string;
  avatar: string | null;
  peerUsername: string | null;
  startedAt: string;
  durationSec: number;
}

/** Все входящие, исходящие и пропущенные вызовы пользователя — от новых к старым. */
export async function listCallHistory(userId: string, limit = 100): Promise<CallHistoryItem[]> {
  const rows = await prisma.callLogUser.findMany({
    where: { userId },
    orderBy: { callLog: { startedAt: 'desc' } },
    take: limit,
    include: { callLog: true },
  });
  if (!rows.length) return [];
  const chatIds = [...new Set(rows.map((r) => r.callLog.chatId))];
  const chats = await prisma.chat.findMany({
    where: { id: { in: chatIds } },
    select: {
      id: true, type: true, title: true, avatarMediaId: true,
      members: { where: { userId: { not: userId } }, take: 1, select: { user: { select: { username: true, name: true, avatarUrl: true } } } },
    },
  });
  const byId = new Map(chats.map((c) => [c.id, c]));
  return rows.map((r) => {
    const l = r.callLog;
    const chat = byId.get(l.chatId);
    const peer = chat && !isGroupType(chat.type) ? chat.members[0]?.user ?? null : null;
    const outgoing = l.initiatorId === userId;
    const direction: CallHistoryItem['direction'] = outgoing ? 'outgoing'
      : l.status === 'ENDED' && r.joined ? 'incoming'
      : l.status === 'DECLINED' ? 'declined' : 'missed';
    return {
      id: l.id, callId: l.callId, chatId: l.chatId, direction, status: l.status, video: l.video, isGroup: l.isGroup,
      name: peer ? peer.name || peer.username : chat?.title ?? (l.title || 'Звонок'),
      avatar: peer ? peer.avatarUrl : chat?.avatarMediaId ? `/api/media/${chat.avatarMediaId}` : null,
      peerUsername: peer ? peer.username : null,
      startedAt: l.startedAt.toISOString(), durationSec: r.durationSec || l.durationSec,
    };
  });
}