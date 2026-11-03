/*
 * Серверные тесты официальных аккаунтов и подтверждения входа. БД не нужна: prisma подменяется небольшим хранилищем
 * в памяти, которое повторяет ровно те операции, что использует services/security.ts (включая атомарность транзакций).
 * Это проверка ЛОГИКИ автомата состояний; реальную БД Postgres и сеть эти тесты не проверяют.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// заглушки обязательных переменных окружения (config.ts проверяет их при загрузке); это НЕ настоящие секреты
process.env.JWT_SECRET = 'test-secret-'.repeat(4);
for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) process.env[k] = 'test';

// ───────── хранилище в памяти ─────────
type Row = Record<string, any>;
const db: Record<'loginAlert' | 'session' | 'message', Row[]> = { loginAlert: [], session: [], message: [] };
const revoked: string[] = [];   // deviceId, для которых вызван revokeDevice

const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, cond]) => {
  const v = row[k];
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('gt' in cond) return v > cond.gt;
    if ('lte' in cond) return v <= cond.lte;
    if ('in' in cond) return cond.in.includes(v);
    return true;
  }
  return v === cond;
});
const model = (name: keyof typeof db) => ({
  findUnique: async ({ where }: Row) => db[name].find((r) => match(r, where)) ?? null,
  findMany: async ({ where }: Row = {}) => db[name].filter((r) => match(r, where)),
  update: async ({ where, data }: Row) => { const r = db[name].find((x) => match(x, where))!; Object.assign(r, data); return r; },
  updateMany: async ({ where, data }: Row) => { const rows = db[name].filter((r) => match(r, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
});
let lock: Promise<unknown> = Promise.resolve();
const fakePrisma: Row = {
  loginAlert: model('loginAlert'), session: model('session'), message: model('message'),
  // транзакция: выполняется строго по очереди; при исключении изменения откатываются
  $transaction: (fn: (tx: Row) => Promise<unknown>) => {
    const run = lock.then(async () => {
      const snap = JSON.stringify(db, (_k, v) => (v instanceof Date ? { __d: v.toISOString() } : v));
      try { return await fn(fakePrisma); } catch (e) {
        const restored = JSON.parse(snap, (_k, v) => (v && v.__d ? new Date(v.__d) : v));
        (Object.keys(db) as (keyof typeof db)[]).forEach((k) => { db[k].length = 0; db[k].push(...restored[k]); });
        throw e;
      }
    });
    lock = run.catch(() => undefined);
    return run;
  },
};

// подменяем модули, которым нужны БД/сокеты (до импорта сервиса)
const cache = (Module as any)._cache as Record<string, any>;
const stub = (rel: string, exports: Row) => { const p = require.resolve(rel); cache[p] = { id: p, filename: p, loaded: true, exports, children: [], paths: [] }; };
stub('../src/db', { prisma: fakePrisma });
stub('../src/realtime/hub', { emitToChat: () => {}, emitToUser: () => {}, joinUserToChat: () => {} });
stub('../src/services/session', { revokeDevice: async (_u: string, deviceId: string) => { revoked.push(deviceId); } });
stub('../src/services/system', { sendSystemMessage: async () => ({}) });
stub('../src/services/chat', { messageInclude: {}, toMessageDTO: (m: Row) => m });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sec = require('../src/services/security') as typeof import('../src/services/security');

const T0 = Date.now();
const seed = () => {
  db.loginAlert.length = 0; db.session.length = 0; db.message.length = 0; revoked.length = 0;
  // давно вошедшая сессия A (устройство dA) и ожидающая сессия N (устройство dN) нового входа
  db.session.push({ id: 'A', userId: 'u1', deviceId: 'dA', createdAt: new Date(T0 - 86_400_000), approval: 'ACTIVE', revokedAt: null });
  db.session.push({ id: 'B', userId: 'u1', deviceId: 'dB', createdAt: new Date(T0 - 3_600_000), approval: 'ACTIVE', revokedAt: null }); // третье устройство
  db.session.push({ id: 'N', userId: 'u1', deviceId: 'dN', createdAt: new Date(T0), approval: 'PENDING', revokedAt: null });
  db.loginAlert.push({ id: 'al1', userId: 'u1', sessionId: 'N', deviceId: 'dN', state: 'PENDING', createdAt: new Date(T0), expiresAt: new Date(T0 + 600_000), messageId: null });
};
const A = { sessionId: 'A', deviceId: 'dA' };
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e.code ?? e.message; } };
const sess = (id: string) => db.session.find((s) => s.id === id)!;
const alert = () => db.loginAlert[0];

test('«Это я»: сессия нового устройства становится ACTIVE, алерт CONFIRMED', async () => {
  seed();
  const r = await sec.resolveLoginAlert('u1', A, 'al1', 'CONFIRM');
  assert.equal(r.state, 'CONFIRMED');
  assert.equal(sess('N').approval, 'ACTIVE');
  assert.equal(alert().state, 'CONFIRMED');
  assert.equal(alert().resolvedVia, 'DEVICE');
  assert.deepEqual(revoked, []);
});

test('«Это не я»: отзывается ИМЕННО эта сессия и устройство, остальные не затронуты', async () => {
  seed();
  const r = await sec.resolveLoginAlert('u1', A, 'al1', 'DENY');
  assert.equal(r.state, 'DENIED');
  assert.equal(sess('N').approval, 'DENIED');
  assert.ok(sess('N').revokedAt, 'сессия N отозвана');
  assert.deepEqual(revoked, ['dN'], 'revokeDevice вызван только для устройства нового входа');
  assert.equal(sess('A').revokedAt, null);
  assert.equal(sess('B').revokedAt, null);
});

test('само проверяемое устройство подтвердить себя не может', async () => {
  seed();
  assert.equal(await code(sec.resolveLoginAlert('u1', { sessionId: 'N', deviceId: 'dN' }, 'al1', 'CONFIRM')), 'cannot_confirm_own_login');
  assert.equal(sess('N').approval, 'PENDING');
});

test('сессия, созданная ПОСЛЕ запроса, подтверждать не может', async () => {
  seed();
  db.session.push({ id: 'Z', userId: 'u1', deviceId: 'dZ', createdAt: new Date(T0 + 5_000), approval: 'ACTIVE', revokedAt: null });
  assert.equal(await code(sec.resolveLoginAlert('u1', { sessionId: 'Z', deviceId: 'dZ' }, 'al1', 'CONFIRM')), 'session_too_new');
});

test('чужой запрос и несуществующий → 404', async () => {
  seed();
  assert.equal(await code(sec.resolveLoginAlert('other', A, 'al1', 'CONFIRM')), 'alert_not_found');
  assert.equal(await code(sec.resolveLoginAlert('u1', A, 'nope', 'DENY')), 'alert_not_found');
});

test('повторное нажатие после решения → 409, состояние не меняется', async () => {
  seed();
  await sec.resolveLoginAlert('u1', A, 'al1', 'DENY');
  assert.equal(await code(sec.resolveLoginAlert('u1', A, 'al1', 'CONFIRM')), 'alert_already_resolved');
  assert.equal(alert().state, 'DENIED');
  assert.equal(sess('N').approval, 'DENIED', 'отклонённую сессию нельзя «оживить» повторным подтверждением');
});

test('одновременные «Это я» и «Это не я»: выигрывает ровно одно решение', async () => {
  seed();
  const res = await Promise.all([
    code(sec.resolveLoginAlert('u1', A, 'al1', 'CONFIRM')),
    code(sec.resolveLoginAlert('u1', { sessionId: 'B', deviceId: 'dB' }, 'al1', 'DENY')),
  ]);
  assert.equal(res.filter((x) => x === 'OK').length, 1);
  assert.equal(res.filter((x) => x === 'alert_already_resolved').length, 1);
});

test('просроченный запрос подтвердить нельзя: вход отменяется, сессия отзывается', async () => {
  seed();
  alert().expiresAt = new Date(Date.now() - 1000);
  assert.equal(await code(sec.resolveLoginAlert('u1', A, 'al1', 'CONFIRM')), 'alert_expired');
  assert.equal(alert().state, 'EXPIRED');
  assert.equal(sess('N').approval, 'EXPIRED');
  assert.ok(sess('N').revokedAt);
  assert.deepEqual(revoked, ['dN']);
});

test('таймер: expireStaleAlerts отменяет только просроченные', async () => {
  seed();
  alert().expiresAt = new Date(Date.now() - 1000);
  db.loginAlert.push({ id: 'al2', userId: 'u1', sessionId: 'Q', deviceId: 'dQ', state: 'PENDING', createdAt: new Date(T0), expiresAt: new Date(Date.now() + 600_000), messageId: null });
  await sec.expireStaleAlerts();
  assert.equal(db.loginAlert[0].state, 'EXPIRED');
  assert.equal(db.loginAlert[1].state, 'PENDING');
});

test('подтверждение кодом из письма: один раз, тем же автоматом состояний', async () => {
  seed();
  assert.equal(await sec.confirmAlertByEmail('N'), true);
  assert.equal(sess('N').approval, 'ACTIVE');
  assert.equal(alert().resolvedVia, 'EMAIL');
  assert.equal(await sec.confirmAlertByEmail('N'), false, 'повторно нельзя');
});

test('кодом из письма нельзя подтвердить уже отклонённый вход', async () => {
  seed();
  await sec.resolveLoginAlert('u1', A, 'al1', 'DENY');
  assert.equal(await sec.confirmAlertByEmail('N'), false);
  assert.equal(sess('N').approval, 'DENIED');
});

// ───────── резерв имени Mchat ─────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const v = require('../src/utils/validate') as typeof import('../src/utils/validate');

test('имя и ник «Mchat» зарезервированы, обходы через двойники/цифры/пробелы тоже', () => {
  for (const bad of ['Mchat', 'mchat', 'MCHAT', 'M chat', 'M-c-h-a-t', 'Мchat', 'мчат', 'mch4t', 'rnchat', 'Mchat Security', 'mchat_news', 'the_mchat', 'm_c_h_a_t']) {
    assert.equal(v.isReservedBrandName(bad), true, `${bad} должно блокироваться`);
  }
  for (const ok of ['Анна', 'chat', 'machine', 'Max Chat', 'match', 'alex_99']) {
    assert.equal(v.isReservedBrandName(ok), false, `${ok} блокироваться не должно`);
  }
});
test('validateUsername/displayNameAllowed: обычному пользователю нельзя, администратору владельца можно', () => {
  assert.equal(v.validateUsername('mchat_news').ok, false);
  assert.equal(v.validateUsername('mchat').ok, false);
  assert.equal(v.validateUsername('security').ok, false);
  assert.equal(v.validateUsername('anna_k').ok, true);
  assert.equal(v.displayNameAllowed('Mchat'), false);
  assert.equal(v.displayNameAllowed('Анна'), true);
  assert.equal(v.displayNameAllowed('Mchat', { privileged: true }), true);
  assert.equal(v.validateUsername('mchat', { privileged: true }).ok, true);
});

// ───────── описание устройства и местоположение ─────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dev = require('../src/utils/device') as typeof import('../src/utils/device');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geo = require('../src/utils/geo') as typeof import('../src/utils/geo');
const req = (ua: string, extra: Row = {}, ip = '8.8.8.8') => ({ get: (h: string) => (h.toLowerCase() === 'user-agent' ? ua : extra[h.toLowerCase()]), ip, headers: {} }) as any;

test('describeClient: тип устройства, ОС и браузер/приложение', () => {
  const phone = dev.describeClient(req('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'));
  assert.equal(phone.type, 'phone'); assert.equal(phone.os, 'Android 14'); assert.match(phone.client, /Chrome/);
  const app = dev.describeClient(req('Mozilla/5.0 (Linux; Android 13; SM-S901B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36'));
  assert.equal(app.client, 'Приложение Mchat (Android)');
  const desk = dev.describeClient(req('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'));
  assert.equal(desk.type, 'desktop'); assert.equal(desk.os, 'Windows');
  const ipad = dev.describeClient(req('Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'));
  assert.equal(ipad.type, 'tablet'); assert.equal(ipad.os, 'iOS 17');
  assert.equal(dev.describeClient(req('curl/8')).type, 'unknown');
});
test('approxLocation: ничего не выдумывает — без достоверного источника null', () => {
  assert.equal(geo.approxLocation(req('x', {}, '8.8.8.8')), null);
  assert.equal(geo.approxLocation(req('x', { 'cf-ipcountry': 'KG' }, '192.168.1.5')), null, 'локальный адрес не определяем');
  assert.equal(geo.approxLocation(req('x', { 'cf-ipcountry': 'XX' }, '8.8.8.8')), null);
  assert.ok(geo.approxLocation(req('x', { 'cf-ipcountry': 'KG', 'cf-ipcity': 'Bishkek' }, '8.8.8.8'))!.startsWith('Bishkek'));
});
