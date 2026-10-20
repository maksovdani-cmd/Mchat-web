/* Mchat Service Worker
 *  1) PWA / офлайн: статика кэшируется, приложение открывается без сети (данные подтянутся, когда сеть вернётся);
 *  2) Web Push: сообщения и ВХОДЯЩИЕ ЗВОНКИ (долгая вибрация, кнопки «Ответить/Отклонить», уведомление не исчезает само). */
'use strict';

const VERSION = 'v5';
const STATIC_CACHE = 'mchat-static-' + VERSION;
const RUNTIME_CACHE = 'mchat-runtime-' + VERSION;
const MP_CACHE = 'mchat-mediapipe-1'; // wasm и модель масок — тяжёлые, меняются редко

const PRECACHE = [
  '/', '/style.css', '/script.js', '/mchat-api.js', '/i18n.js', '/mchat-ext.js', '/mchat-features.js', '/mchat-features.css', '/mchat-fixes.js', '/mchat-fixes.css', '/masks.js',
  '/manifest.webmanifest',
  '/img/mchat.jpg', '/img/icon-96.png', '/img/icon-192.png', '/img/icon-512.png', '/img/apple-touch-icon.png',
  '/sounds/ringtone.wav',
  '/masks/shades.png', '/masks/glasses.png', '/masks/horns.png', '/masks/mustache.png', '/masks/hero.png', '/masks/crown.png',
];

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Mchat</title><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#18181f;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h2>Mchat</h2><p style="opacity:.7">Нет соединения / No connection</p><button onclick="location.reload()" style="padding:12px 22px;border:0;border-radius:12px;background:#4a4af0;color:#fff;font-size:15px">OK</button></div>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // addAll падает целиком, если один файл недоступен, — кладём по одному
    await Promise.all(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, RUNTIME_CACHE, MP_CACHE]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

const isApi = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname === '/ping' || url.pathname === '/healthz';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // MediaPipe (маски в звонках): cache-first, чтобы модель качалась один раз
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com') {
    event.respondWith((async () => {
      const cache = await caches.open(MP_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return; // ZEGOCLOUD, Google Fonts и т. п. — как есть
  if (isApi(url)) return;                           // API и сокеты никогда не кэшируем

  // Открытие приложения (в том числе /profile/x, /join/code): сеть → кэш → офлайн-страница
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const pre = await event.preloadResponse;
        const res = pre || await fetch(req);
        if (res && res.ok && url.pathname === '/') (await caches.open(STATIC_CACHE)).put('/', res.clone()).catch(() => {});
        return res;
      } catch (e) {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match('/')) || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Остальная статика: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  })());
});

/* ───────────── Push ───────────── */

// Apple (iOS/iPadOS PWA, Safari): КАЖДЫЙ push обязан закончиться видимым уведомлением, иначе подписку отзывают
// после нескольких «тихих» пушей. Chrome/Android разрешает не показывать уведомление, если приложение на экране.
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent || '') && !/Chrome|Chromium|Edg|Android/.test(self.navigator.userAgent || '');

const closeByTag = async (tag) => {
  const list = await self.registration.getNotifications({ tag });
  list.forEach((n) => n.close());
  return list.length;
};

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Mchat', body: event.data ? event.data.text() : '' }; }
  const data = d.data || {};

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = list.some((c) => c.visibilityState === 'visible' && c.focused);

    // ── звонок завершён / принят на другом устройстве: уведомление «Входящий звонок» убираем ──
    if (data.kind === 'call-end') {
      const tag = d.tag || ('call-' + data.callId);
      const had = await closeByTag(tag);
      list.forEach((c) => c.postMessage({ type: 'call-ended', callId: data.callId, reason: data.reason || '' }));
      if (data.missed) {
        // пропущенный звонок — оставляем видимое уведомление (оно заменяет «Входящий звонок» с тем же tag)
        await self.registration.showNotification(d.title || 'Пропущенный звонок', {
          body: d.body || '', tag: 'missed-' + data.callId, icon: '/img/icon-192.png', badge: '/img/icon-96.png',
          data: { kind: 'message', chatId: data.chatId },
        });
        return;
      }
      if (IS_APPLE && !had) {
        // правило Apple: на каждый push — уведомление. Показываем и сразу убираем.
        await self.registration.showNotification('Mchat', { body: '', tag, silent: true, icon: '/img/icon-192.png', data: {} });
        await new Promise((r) => setTimeout(r, 600));
        await closeByTag(tag);
      }
      return;
    }

    // Приложение открыто и на экране: сообщение придёт по сокету, звонок приложение само зазвонит рингтоном.
    // На Apple уведомление всё равно нужно показать — делаем это «вспышкой» и сразу закрываем.
    if (visible && (data.kind === 'message' || data.kind === 'call')) {
      if (IS_APPLE) {
        const tag = 'flash-' + (d.tag || 'mchat');
        await self.registration.showNotification(d.title || 'Mchat', { body: d.body || '', tag, silent: true, icon: '/img/icon-192.png', data });
        await new Promise((r) => setTimeout(r, 400));
        await closeByTag(tag);
      }
      return;
    }

    if (data.kind === 'call') {
      // Входящий звонок: уведомление висит, пока не ответят/отклонят, телефон вибрирует «как при звонке»
      await self.registration.showNotification(d.title || 'Mchat', {
        body: d.body || '',
        tag: d.tag || 'mchat-call',
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [600, 300, 600, 300, 600, 300, 600, 300, 600],
        icon: '/img/icon-192.png',
        badge: '/img/icon-96.png',
        timestamp: Date.now(),
        data: Object.assign({}, data, { title: d.title }),
        actions: [{ action: 'answer', title: 'Ответить' }, { action: 'decline', title: 'Отклонить' }],
      });
      // Подстраховка: если второй push «звонок окончен» не дошёл, убираем уведомление через 45 с
      // (setTimeout в SW может быть прерван, поэтому основной механизм — push kind=call-end с сервера)
      setTimeout(() => { closeByTag(d.tag || 'mchat-call').catch(() => {}); }, 45000);
      return;
    }

    await self.registration.showNotification(d.title || 'Mchat', {
      body: d.body || '',
      tag: d.tag || 'mchat', // новые сообщения одного чата заменяют предыдущее уведомление
      renotify: true,
      icon: '/img/icon-192.png',
      badge: '/img/icon-96.png',
      timestamp: Date.now(),
      data,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (data.kind === 'call' && event.action === 'decline') {
    event.waitUntil(fetch('/api/calls/' + encodeURIComponent(data.callId) + '/decline', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {}));
    return;
  }

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list.find((c) => c.visibilityState === 'visible') || list[0];
    const answering = data.kind === 'call'; // «Ответить» или тап по уведомлению о звонке
    if (client) {
      try { await client.focus(); } catch (e) { /* iOS иногда не даёт focus() — сообщение всё равно дойдёт */ }
      if (answering) client.postMessage({ type: 'answer-call', callId: data.callId, chatId: data.chatId, video: !!data.video, title: data.title || '' });
      else if (data.chatId) client.postMessage({ type: 'open-chat', chatId: data.chatId });
      return;
    }
    let target = '/';
    if (answering) target = '/?call=' + encodeURIComponent(data.callId) + '&chat=' + encodeURIComponent(data.chatId || '') + '&video=' + (data.video ? '1' : '0') + '&title=' + encodeURIComponent(data.title || '');
    else if (data.chatId) target = '/?chat=' + encodeURIComponent(data.chatId);
    await self.clients.openWindow(target);
  })());
});

// Браузер сам поменял/обновил подписку (истёк срок, сброс разрешений, обновление iOS): подписываемся заново и отправляем на сервер.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription;
      const keyRes = await fetch('/api/push/key', { credentials: 'include' });
      const { publicKey } = await keyRes.json();
      const pad = '='.repeat((4 - (publicKey.length % 4)) % 4);
      const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = event.newSubscription || (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await fetch('/api/push/subscribe', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()),
      });
      if (old && old.endpoint && old.endpoint !== sub.endpoint) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: old.endpoint }),
        }).catch(() => {});
      }
    } catch (e) { /* при следующем открытии приложения syncPush() подпишет заново */ }
  })());
});
  