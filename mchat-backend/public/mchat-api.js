/* ============================================================
   Mchat — слой интеграции с бэкендом.
   Подключается в index.html ПЕРЕД script.js.
   Здесь ВСЕ fetch() и socket.emit(); script.js вызывает только MchatAPI.*
   ============================================================ */
(function () {
  'use strict';

  // ---------- HTTP ----------
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin', // cookie с JWT (httpOnly) уходит автоматически
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'http_' + res.status);
      err.status = res.status;
      err.code = data && data.error;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- тексты ошибок ----------
  const ERR = {
    unauthorized: 'Сессия истекла. Войди снова',
    calls_disabled: 'Звонки не настроены на сервере: добавь ключи LiveKit в .env',
    no_calls_in_channel: 'В канале нельзя звонить',
    nobody_to_call: 'Некому звонить',
    already_in_call: 'Ты уже в другом звонке',
    call_not_found: 'Звонок уже завершён',
    not_a_contact: 'Добавлять можно только людей из твоих контактов',
    already_verified: 'У тебя уже есть галочка',
    request_pending: 'Твой запрос уже на рассмотрении',
    request_decided: 'По этому запросу уже принято решение',
    bad_days: 'Неверный срок',
    post_not_found: 'Пост не найден или удалён',
    story_not_found: 'История не найдена или истекла',
    empty_post: 'Добавь описание или медиа',
    bad_media: 'Не удалось прикрепить файл, попробуй ещё раз',
    story_limit: 'Максимум 6 историй в день',
    own_post: 'Нельзя репостить свой пост',
    rate_limited: 'Слишком часто. Подожди немного',
    chat_not_found: 'Чат не найден',
    user_not_found: 'Пользователь не найден',
    cannot_chat_with_self: 'Нельзя писать самому себе',
    empty_message: 'Пустое сообщение',
    message_too_long: 'Сообщение слишком длинное (максимум 4000 символов)',
    invalid_code: 'Неверный код',
    code_expired: 'Код истёк. Войди через Google заново',
    already_sent: 'Код уже отправлен на почту',
    email_failed: 'Не удалось отправить письмо',
    email_disabled: 'Отправка на почту отключена',
    bad_origin: 'Запрос отклонён (неверный источник)',
    bad_request: 'Некорректные данные',
    channel_read_only: 'В канале публикует только владелец',
    forbidden: 'Недостаточно прав',
    not_author: 'Можно менять только свои сообщения',
    not_editable: 'Это сообщение нельзя изменить',
    message_not_found: 'Сообщение не найдено',
    bad_emoji: 'Недопустимая реакция',
    too_many_reactions: 'Слишком много разных реакций',
    already_friends: 'Вы уже друзья',
    forbidden: 'Недостаточно прав',
    not_a_friend: 'Добавлять можно только друзей',
    not_a_group: 'Это личный чат',
    owner_cannot_leave: 'Владелец не может выйти из группы',
    cannot_change_owner: 'Роль владельца изменить нельзя',
    group_full: 'В группе уже максимум участников',
    bad_avatar: 'Не удалось поставить эту аватарку',
    member_not_found: 'Участник не найден',
    cannot_friend_self: 'Нельзя добавить в друзья самого себя',
    request_not_found: 'Заявка не найдена',
    invite_not_found: 'Ссылка-приглашение недействительна',
    unsupported_type: 'Этот формат файла не поддерживается',
    too_large: 'Файл слишком большой',
    empty_file: 'Файл пустой',
    too_many_tracks: 'Максимум 20 треков в профиле',
    media_not_found: 'Файл не найден',
    forbidden_media: 'Нельзя использовать чужой файл',
    push_unsupported: 'Этот браузер не поддерживает push-уведомления',
    push_denied: 'Разреши уведомления в настройках браузера',
    // ошибки, которые сервер возвращает после входа через Google (?auth_error=...)
    nick_required: 'Введи ник для регистрации',
    nick_taken: 'Этот ник уже занят — выбери другой',
    nick_too_short: 'Ник: минимум 3 символа',
    nick_too_long: 'Ник: максимум 20 символов',
    nick_invalid_chars: 'Ник: только латиница, цифры и _',
    nick_reserved: 'Этот ник зарезервирован',
    google_denied: 'Вход через Google отменён',
    google_failed: 'Не удалось войти через Google. Попробуй ещё раз',
    bad_state: 'Ошибка безопасности входа. Попробуй ещё раз',
    too_many_codes: 'Слишком много попыток. Подожди 15 минут',
    account_conflict: 'Этот Google-аккаунт уже связан с другим профилем',
  };
  const errorText = (e) => {
    const code = typeof e === 'string' ? e : e && e.code;
    if (ERR[code]) return ERR[code];
    if (e && e.status === 0) return 'Нет связи с сервером';
    // неизвестная ошибка: показываем технический код, чтобы можно было понять причину
    const detail = e && (e.code || e.message) ? ' (' + String(e.code || e.message).slice(0, 60) + ')' : '';
    return 'Что-то пошло не так. Попробуй ещё раз' + detail;
  };

  // ---------- realtime ----------
  // script.js подставляет свои обработчики: MchatAPI.handlers.onMessage = ...
  const handlers = {
    onMessage: null, onRead: null, onTyping: null, onPresence: null,
    onLoginCode: null, onNewDevice: null, onUnauthorized: null,
    onReconnect: null, onOpenChat: null,
    onEdited: null, onDeleted: null, onReactions: null, onPinned: null, onFriendUpdate: null, onChatChanged: null, onChatRemoved: null,
    onCallIncoming: null, onCallEnded: null, onCallHandled: null,
  };
  let socket = null;
  let everConnected = false;

  function connect() {
    if (socket) return;
    socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      socket.emit('app:visibility', document.visibilityState === 'visible');
      if (everConnected && handlers.onReconnect) handlers.onReconnect(); // догнать пропущенное
      everConnected = true;
    });
    socket.on('connect_error', (err) => {
      if (err && err.message === 'unauthorized') { // сессия отозвана/истекла — переподключаться бессмысленно
        socket.disconnect(); socket = null;
        if (handlers.onUnauthorized) handlers.onUnauthorized();
      }
    });
    socket.on('disconnect', (reason) => {
      // сервер закрыл соединение сам (например, отозвали устройство) → проверим сессию
      if (reason === 'io server disconnect') {
        api('/me').catch((e) => { if (e.status === 401 && handlers.onUnauthorized) handlers.onUnauthorized(); });
        socket.connect();
      }
    });
    socket.on('message:new', (m) => handlers.onMessage && handlers.onMessage(m));
    socket.on('chat:read', (p) => handlers.onRead && handlers.onRead(p));
    socket.on('typing', (p) => handlers.onTyping && handlers.onTyping(p));
    socket.on('presence', (p) => handlers.onPresence && handlers.onPresence(p));
    socket.on('message:edited', (m) => handlers.onEdited && handlers.onEdited(m));
    socket.on('message:deleted', (p) => handlers.onDeleted && handlers.onDeleted(p));
    socket.on('message:reactions', (p) => handlers.onReactions && handlers.onReactions(p));
    socket.on('chat:pinned', (p) => handlers.onPinned && handlers.onPinned(p));
    socket.on('chat:changed', (p) => handlers.onChatChanged && handlers.onChatChanged(p));
    socket.on('call:incoming', (p) => handlers.onCallIncoming && handlers.onCallIncoming(p));
    socket.on('call:ended', (p) => handlers.onCallEnded && handlers.onCallEnded(p));
    socket.on('call:handled', (p) => handlers.onCallHandled && handlers.onCallHandled(p));
    socket.on('chat:removed', (p) => handlers.onChatRemoved && handlers.onChatRemoved(p));
    socket.on('friend:update', (p) => handlers.onFriendUpdate && handlers.onFriendUpdate(p));
    socket.on('auth:login-code', (d) => handlers.onLoginCode && handlers.onLoginCode(d));
    socket.on('auth:new-device', (d) => handlers.onNewDevice && handlers.onNewDevice(d));
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
    everConnected = false;
  }

  document.addEventListener('visibilitychange', () => {
    // сервер не шлёт пуш, пока приложение на экране, и шлёт, когда свёрнуто
    if (socket && socket.connected) socket.emit('app:visibility', document.visibilityState === 'visible');
  });

  const newClientId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  /**
   * Отправка: сначала сокет с подтверждением; если сокет недоступен — REST (тот же clientId → без дублей).
   * extra: { kind: 'VOICE'|'VIDEO_NOTE'|'IMAGE', mediaId, durationSec, replyToId }
   */
  function sendMessage(chatId, text, clientId, extra) {
    clientId = clientId || newClientId();
    const payload = Object.assign({ text: text || '', clientId: clientId }, extra || {});
    return new Promise((resolve, reject) => {
      const viaRest = () =>
        api('/chats/' + encodeURIComponent(chatId) + '/messages', { method: 'POST', body: payload })
          .then((r) => resolve(r.message), reject);
      if (!socket || !socket.connected) return viaRest();
      socket.timeout(8000).emit('message:send', Object.assign({ chatId: chatId }, payload), (err, res) => {
        if (err) return viaRest(); // таймаут → повтор по REST, дубль исключён идемпотентностью
        if (res && res.ok) return resolve(res.message);
        const e = new Error((res && res.error) || 'server_error');
        e.code = res && res.error;
        reject(e);
      });
    });
  }

  /** Загрузка файла: тело запроса — сам файл. kind: voice | videonote | image | track */
  /** Загрузка файла. opts.onProgress(0..100) — для полосы загрузки. Документы уходят как octet-stream. */
  function uploadMedia(kind, blob, opts) {
    opts = opts || {};
    const qs = new URLSearchParams({ kind: kind });
    if (opts.duration) qs.set('duration', String(Math.round(opts.duration)));
    if (opts.name) qs.set('name', opts.name);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media?' + qs.toString());
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', kind === 'file' ? 'application/octet-stream' : (blob.type || 'application/octet-stream'));
      if (opts.onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress(Math.round((e.loaded / e.total) * 100)); };
      }
      xhr.onload = () => {
        let data = null; try { data = JSON.parse(xhr.responseText); } catch (e) { /* пусто */ }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.media) return resolve(data.media);
        const err = new Error((data && data.error) || 'http_' + xhr.status);
        err.status = xhr.status;
        err.code = (data && data.error) || (xhr.status === 413 ? 'too_large' : xhr.status === 415 ? 'unsupported_type' : undefined);
        reject(err);
      };
      xhr.onerror = () => { const err = new Error('network'); err.status = 0; reject(err); };
      xhr.send(blob);
    });
  }

  let typingOn = false, typingTimer = null;
  function sendTyping(chatId) {
    if (!socket || !socket.connected) return;
    if (!typingOn) { typingOn = true; socket.emit('typing', { chatId: chatId, isTyping: true }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingOn = false; socket && socket.emit('typing', { chatId: chatId, isTyping: false }); }, 2500);
  }

  // ---------- Web Push ----------
  const b64ToU8 = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) { return null; }
  }

  /** Включить пуши. Вызывать по нажатию пользователя (iOS/Safari требуют жест). */
  async function enablePush() {
    if (!pushSupported()) throw Object.assign(new Error('push_unsupported'), { code: 'push_unsupported' });
    const reg = await navigator.serviceWorker.ready;
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') throw Object.assign(new Error('push_denied'), { code: 'push_denied' });
    const key = (await api('/push/key')).publicKey;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }); }
      catch (e) { // подписка со старым ключом — пересоздаём
        const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      }
    }
    await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  }

  async function disablePush() {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
  }

  /** Тихо привязать подписку к текущему пользователю, если разрешение уже выдано. */
  async function syncPush() {
    if (pushSupported() && Notification.permission === 'granted') { try { await enablePush(); } catch (e) { /* не критично */ } }
  }

  // Service Worker → страница (клик по уведомлению)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-chat' && handlers.onOpenChat) handlers.onOpenChat(e.data.chatId);
    });
    registerSW();
  }

  // ---------- публичный интерфейс ----------
  window.MchatAPI = {
    handlers: handlers,
    errorText: errorText,
    newClientId: newClientId,

    // auth
    startGoogle: (username) => { window.location.href = '/api/auth/google/start?username=' + encodeURIComponent(username || ''); },
    pending: () => api('/auth/pending'),
    verifyCode: (code) => api('/auth/verify-code', { method: 'POST', body: { code: code } }),
    sendEmailCode: () => api('/auth/send-email-code', { method: 'POST', body: {} }),
    logout: () => api('/auth/logout', { method: 'POST', body: {} }),

    // профиль
    me: () => api('/me'),
    updateMe: (patch) => api('/me', { method: 'PATCH', body: patch }),
    deleteMe: () => api('/me', { method: 'DELETE' }),
    getUser: (username) => api('/users/' + encodeURIComponent(username)),
    searchUsers: (q) => api('/users/search?q=' + encodeURIComponent(q)),
    devices: () => api('/me/devices'),
    revokeDevice: (id) => api('/me/devices/' + encodeURIComponent(id), { method: 'DELETE' }),

    // чаты
    listChats: () => api('/chats'),
    startDirectChat: (username) => api('/chats/direct', { method: 'POST', body: { username: username } }),
    listMessages: (chatId, before) => api('/chats/' + encodeURIComponent(chatId) + '/messages?limit=50' + (before ? '&before=' + encodeURIComponent(before) : '')),
    markRead: (chatId) => api('/chats/' + encodeURIComponent(chatId) + '/read', { method: 'POST', body: {} }).catch(() => {}),
    sendMessage: sendMessage,
    sendTyping: sendTyping,
    editMessage: (id, text) => api('/messages/' + encodeURIComponent(id), { method: 'PATCH', body: { text: text } }).then((r) => r.message),
    deleteMessage: (id, scope) => api('/messages/' + encodeURIComponent(id) + '?scope=' + (scope || 'all'), { method: 'DELETE' }),
    react: (id, emoji) => api('/messages/' + encodeURIComponent(id) + '/reaction', { method: 'PUT', body: { emoji: emoji } }),
    forward: (id, chatId) => api('/messages/' + encodeURIComponent(id) + '/forward', { method: 'POST', body: { chatId: chatId, clientId: newClientId() } }).then((r) => r.message),
    pin: (chatId, messageId) => api('/chats/' + encodeURIComponent(chatId) + '/pin', { method: 'PUT', body: { messageId: messageId } }),
    // ── звонки (LiveKit) ──
    callStatus: () => api('/calls/status'),
    startCall: (chatId, video) => api('/calls', { method: 'POST', body: { chatId: chatId, video: !!video } }),
    acceptCall: (id) => api('/calls/' + encodeURIComponent(id) + '/accept', { method: 'POST', body: {} }),
    declineCall: (id) => api('/calls/' + encodeURIComponent(id) + '/decline', { method: 'POST', body: {} }),
    leaveCall: (id) => api('/calls/' + encodeURIComponent(id) + '/leave', { method: 'POST', body: {} }),
    inviteToCall: (id, userIds) => api('/calls/' + encodeURIComponent(id) + '/invite', { method: 'POST', body: { userIds: userIds } }),
    chatContacts: () => api('/chats/contacts'),
    searchChannels: (q) => api('/chats/search?q=' + encodeURIComponent(q)),
    joinChannel: (id) => api('/chats/' + encodeURIComponent(id) + '/join', { method: 'POST', body: {} }),
    muteChat: (id, muted) => api('/chats/' + encodeURIComponent(id) + '/mute', { method: 'PUT', body: { muted: !!muted } }),
    createGroup: (b) => api('/chats/group', { method: 'POST', body: b }),
    joinChat: (code) => api('/chats/join', { method: 'POST', body: { code: code } }),

    // друзья
    setChatBackground: (id, background) => api('/chats/' + encodeURIComponent(id) + '/background', { method: 'PUT', body: { background: background } }),
    // ── посты, истории, профиль ──
    listPosts: (username) => api('/posts' + (username ? '?username=' + encodeURIComponent(username) : '')),
    getPost: (id) => api('/posts/' + id),
    searchPosts: (q) => api('/posts/search?q=' + encodeURIComponent(q)),
    listReposts: (username) => api('/posts/reposts?username=' + encodeURIComponent(username)),
    createPost: (body) => api('/posts', { method: 'POST', body: body }),
    deletePost: (id) => api('/posts/' + id, { method: 'DELETE' }),
    likePost: (id, liked) => api('/posts/' + id + '/like', { method: 'PUT', body: { liked: !!liked } }),
    commentPost: (id, text) => api('/posts/' + id + '/comments', { method: 'POST', body: { text: text } }),
    repostPost: (id) => api('/posts/' + id + '/repost', { method: 'POST', body: {} }),
    listStories: (username) => api('/stories?username=' + encodeURIComponent(username)),
    createStory: (body) => api('/stories', { method: 'POST', body: body }),
    deleteStory: (id) => api('/stories/' + id, { method: 'DELETE' }),
    likeStory: (id, liked) => api('/stories/' + id + '/like', { method: 'PUT', body: { liked: !!liked } }),
    commentStory: (id, text) => api('/stories/' + id + '/comments', { method: 'POST', body: { text: text } }),
    // ── верификация (галочка со сроком) ──
    myVerification: () => api('/verification/mine'),
    requestVerification: (reason) => api('/verification/requests', { method: 'POST', body: { reason: reason } }),
    verifyAdmin: () => api('/verification/admin'),
    verifyApprove: (id, days) => api('/verification/requests/' + id + '/approve', { method: 'POST', body: { days: days } }),
    verifyReject: (id) => api('/verification/requests/' + id + '/reject', { method: 'POST', body: {} }),
    verifyRevoke: (userId) => api('/verification/users/' + encodeURIComponent(userId) + '/revoke', { method: 'POST', body: {} }),
    updateChat: (id, patch) => api('/chats/' + encodeURIComponent(id), { method: 'PATCH', body: patch }),
    chatMembers: (id) => api('/chats/' + encodeURIComponent(id) + '/members'),
    addMembers: (id, userIds) => api('/chats/' + encodeURIComponent(id) + '/members', { method: 'POST', body: { userIds: userIds } }),
    removeMember: (id, userId) => api('/chats/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(userId), { method: 'DELETE' }),
    setMemberRole: (id, userId, role) => api('/chats/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(userId) + '/role', { method: 'PUT', body: { role: role } }),
    friends: () => api('/friends'),
    friendRequest: (username) => api('/friends/request', { method: 'POST', body: { username: username } }),
    friendAccept: (id) => api('/friends/' + encodeURIComponent(id) + '/accept', { method: 'POST', body: {} }),
    friendRemove: (id) => api('/friends/' + encodeURIComponent(id), { method: 'DELETE' }),

    // файлы и треки («нота»)
    uploadMedia: uploadMedia,
    deleteMedia: (id) => api('/media/' + encodeURIComponent(id), { method: 'DELETE' }),
    myTracks: () => api('/me/tracks'),
    userTracks: (username) => api('/users/' + encodeURIComponent(username) + '/tracks'),

    // realtime
    connect: connect,
    disconnect: disconnect,

    // push
    enablePush: enablePush,
    disablePush: disablePush,
    syncPush: syncPush,
    pushSupported: pushSupported,
  };
})();
