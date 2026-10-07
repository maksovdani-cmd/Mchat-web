import crypto from 'node:crypto';
import { prisma } from '../db';
import { config } from '../config';
import { emitToUser } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { assertMember, listContacts } from './chat';
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
  allowed: Set<string>;  // кому можно получить токен
  timer: NodeJS.Timeout | null;
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

function finish(call: Call, reason: string) {
  if (call.timer) clearTimeout(call.timer);
  calls.delete(call.id);
  // комната ZEGOCLOUD исчезает сама, когда из неё выходят все; токены привязаны к roomId и скоро истекут
  const everyone = new Set([...call.joined, ...call.invited]);
  for (const uid of everyone) emitToUser(uid, 'call:ended', { callId: call.id, reason });
}

async function ring(call: Call, uids: string[]) {
  const caller = await prisma.user.findUniqueOrThrow({
    where: { id: call.initiatorId }, select: { id: true, username: true, name: true, avatarUrl: true },
  });
  for (const uid of uids) {
    call.invited.add(uid); call.allowed.add(uid);
    emitToUser(uid, 'call:incoming', {
      callId: call.id, chatId: call.chatId, video: call.video, isGroup: call.isGroup, title: call.title, from: userBrief(caller),
    });
    sendPushToUser(uid, {
      title: 'Входящий звонок', body: `${caller.name || caller.username}${call.video ? ' · видео' : ''}`,
      tag: 'call-' + call.id, data: { chatId: call.chatId, callId: call.id },
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
  const members = await prisma.chatMember.findMany({ where: { chatId, userId: { not: userId } }, select: { userId: true } });
  if (!members.length) throw new HttpError(400, 'nobody_to_call');
  // одновременно у человека один звонок. «Зависший» звонок, где он один (никто не ответил / оборвалась связь),
  // закрываем сам — иначе после неудачной попытки нельзя было бы позвонить снова.
   // старый звонок этого пользователя (например, зависший после закрытой вкладки) просто покидаем
  for (const c of [...calls.values()]) {
    if (c.joined.has(userId)) await leaveCall(userId, c.id);
  }
  const id = crypto.randomUUID();
  const call: Call = {
    id, chatId, isGroup: m.chat.type === 'GROUP', title: m.chat.title ?? '', video,
    roomId: 'call_' + id.replace(/-/g, ''),
    initiatorId: userId, joined: new Set([userId]), invited: new Set(), allowed: new Set([userId]), timer: null,
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
  // остальные устройства этого пользователя перестают звонить
  emitToUser(userId, 'call:handled', { callId });
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
  if (!call.isGroup || call.joined.size === 0) finish(call, 'ended');
  else if (call.joined.size === 1 && call.invited.size === 0) finish(call, 'ended'); // остался один — звонок окончен
  return { ok: true };
}

/** «Добавить участника»: звоним человеку из контактов; он получает обычное входящее. */
export async function inviteToCall(userId: string, callId: string, userIds: string[]) {
  const call = getCall(callId);
  if (!call.joined.has(userId)) throw new HttpError(403, 'forbidden');
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

