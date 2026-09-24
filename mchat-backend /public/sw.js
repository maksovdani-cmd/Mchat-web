/* Mchat Service Worker: получает Web Push, даже когда приложение закрыто. */
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Mchat', body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Если приложение уже открыто и на экране — уведомление лишнее (сообщение придёт по сокету)
    const visible = list.some((c) => c.visibilityState === 'visible' && c.focused);
    if (visible && d.data && d.data.kind === 'message') return;

    await self.registration.showNotification(d.title || 'Mchat', {
      body: d.body || '',
      tag: d.tag || 'mchat', // новые сообщения одного чата заменяют предыдущее уведомление
      renotify: true,
      icon: '/img/icon-192.png',
      badge: '/img/icon-192.png',
      data: d.data || {},
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = list[0];
    if (client) {
      await client.focus();
      if (data.chatId) client.postMessage({ type: 'open-chat', chatId: data.chatId });
      return;
    }
    await self.clients.openWindow(data.chatId ? '/?chat=' + encodeURIComponent(data.chatId) : '/');
  })());
});
