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
  roomName: string;      // комната Daily
  roomUrl: string;
  joined: Set<string>;   // кто сейчас в комнате
  invited: Set<string>;  // кого звонят и кто ещё не ответил
  allowed: Set<string>;  // кому можно получить токен
  timer: NodeJS.Timeout | null;
}
const calls = new Map<string, Call>();
const RING_MS = 45_000;

export const callsEnabled = () => !!config.DAILY_API_KEY;

const ROOM_TTL_SEC = 2 * 60 * 60;

/** Запрос к REST API Daily. Ошибки логируем (ключ и тело не пишем), наружу — общий код. */
async function daily<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(config.DAILY_API_URL + path, {
      method,
      headers: { Authorization: `Bearer ${config.DAILY_API_KEY}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error('Daily: нет связи с API:', (e as Error).message);
    throw new HttpError(502, 'calls_provider_error');
  }
  if (!r.ok) {
    console.error(`Daily: ${method} ${path} → ${r.status}`, (await r.text()).slice(0, 300));
    throw new HttpError(502, r.status === 401 || r.status === 403 ? 'calls_bad_key' : 'calls_provider_error');
  }
  return (await r.json()) as T;
}

/** Закрытая комната на время звонка (войти можно только с токеном, который выдаёт наш сервер). */
async function createRoom(callId: string): Promise<{ name: string; url: string }> {
  const name = 'call-' + callId;
  const room = await daily<{ name: string; url: string }>('POST', '/rooms', {
    name,
    privacy: 'private',
    properties: { exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SEC, max_participants: 20, eject_at_room_exp: true },
  });
  return { name: room.name, url: room.url };
}

async function tokenFor(call: Call, userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, username: true } });
  const t = await daily<{ token: string }>('POST', '/meeting-tokens', {
    properties: {
      room_name: call.roomName,
      user_id: userId,
      user_name: u.name || u.username,
      exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SEC,
    },
  });
  return { token: t.token, url: call.roomUrl };
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
  // комната больше не нужна — удаляем (не ждём результата)
  daily('DELETE', '/rooms/' + call.roomName).catch(() => {});
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
  for (const c of [...calls.values()]) {
    if (!c.joined.has(userId)) continue;
    if (c.joined.size <= 1) finish(c, 'ended');
    else throw new HttpError(409, 'already_in_call');
  }
  const id = crypto.randomUUID();
  const room = await createRoom(id);
  const call: Call = {
    id, chatId, isGroup: m.chat.type === 'GROUP', title: m.chat.title ?? '', video,
    roomName: room.name, roomUrl: room.url,
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
  return { enabled: callsEnabled(), provider: 'daily' };
}

