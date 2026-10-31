/* ═══════════════════════════════════════════════════════════════════════
   Mchat · серия 8 (подключается последним)
   1. Шапка чата: компактная, «острова» из стекла (без прямоугольных подложек)
   2. Оформление пузырей сообщений: несколько вариантов, выбор сохраняется
   3. Черновики: автосохранение по чатам, надпись «Черновик» в списке, синхронизация с сервером
   4. Длинный текст: разбиение на части ≤ 4000 без потерь (клиентская проверка; серверная — в createMessage)
   5. Панель записи голосового: кнопка «ОТМЕНА» по центру, корзина слева, «Одноразовое медиа» над отправкой
   6. Звонки: интерфейс всегда показывается, таймаут подключения, потеря сети, идемпотентное завершение
   7. Мост к нативному Android (Capacitor): защита экрана для одноразовых фото
   8. Лёгкий режим на слабых устройствах
   Ничего не удаляет и не ломает, если нужных функций нет.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__mx8) return; window.__mx8 = true;

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const gv = (f, d) => { try { return f(); } catch (e) { return d; } };      // чтение глобальных let-переменных старых скриптов
  const toast = (m) => { try { (window.showToast || console.log)(m); } catch (e) { /* noop */ } };
  const uid = () => gv(() => currentUser && (currentUser.id || currentUser.username), null);
  const curChat = () => gv(() => currentChatId, null);
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* noop */ } } };

  /* ═════════ 8. Лёгкий режим (слабые телефоны): меньше размытия, без тяжёлых эффектов ═════════ */
  try {
    const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 3);
    if (weak) root.classList.add('mx8-lite');
  } catch (e) { /* noop */ }

  /* ═════════ 1. Шапка чата: острова ═════════ */
  function buildHeaderIslands() {
    const coh = document.querySelector('#s-chat-open .coh');
    if (!coh || coh.dataset.mx8) return;
    const back = coh.querySelector(':scope > .ib');
    const av = $('chat-open-av'), nameBox = $('chat-name') && $('chat-name').parentElement;
    const call = $('mx-call-btn'), vcall = $('mx-vcall-btn'), menu = $('mx-chat-menu-btn');
    if (!back || !av || !nameBox || !call || !vcall || !menu) return;
    coh.dataset.mx8 = '1';
    const mk = (cls) => { const d = document.createElement('div'); d.className = 'mx8-isl ' + cls; return d; };
    const iBack = mk('mx8-isl-back'), iMain = mk('mx8-isl-main'), iAct = mk('mx8-isl-act');
    coh.insertBefore(iBack, back); iBack.appendChild(back);
    coh.insertBefore(iMain, av); iMain.appendChild(av); iMain.appendChild(nameBox);
    coh.insertBefore(iAct, call); iAct.appendChild(call); iAct.appendChild(vcall); iAct.appendChild(menu);
    // скрытие кнопок звонка (mxApplyChatInputState) не должно оставлять пустой остров
    new MutationObserver(syncActIsland).observe(iAct, { attributes: true, subtree: true, attributeFilter: ['style'] });
    syncActIsland();
    function syncActIsland() { iAct.classList.toggle('mx8-nocall', call.style.display === 'none' && vcall.style.display === 'none'); }
  }

  /* ═════════ 2. Оформление пузырей ═════════ */
  const BUBBLES = [
    { id: 'classic', name: 'Классика' },
    { id: 'soft', name: 'Мягкие' },
    { id: 'sharp', name: 'Строгие' },
    { id: 'glass', name: 'Стекло' },
    { id: 'gradient', name: 'Градиент' },
    { id: 'outline', name: 'Контур' },
  ];
  const bubbleKey = () => 'mx8_bubble_' + (uid() || 'guest');
  let bubbleApplied = null;
  function applyBubble(id) {
    if (!BUBBLES.some((b) => b.id === id)) id = 'classic';
    if (id === 'classic') root.removeAttribute('data-mx-bubble'); else root.setAttribute('data-mx-bubble', id);
    bubbleApplied = id;
  }
  function loadBubbleForUser() { const want = ls.get(bubbleKey()) || 'classic'; if (want !== bubbleApplied) applyBubble(want); }
  window.mxSetBubbleStyle = function (id) {
    applyBubble(id); ls.set(bubbleKey(), id);
    document.querySelectorAll('#mx8-bubbles .mx8-bb').forEach((b) => b.classList.toggle('on', b.dataset.id === (bubbleApplied || 'classic')));
  };
  function bubbleSectionHtml() {
    const cur = bubbleApplied || 'classic';
    return '<div style="font-weight:700;font-size:17px">Оформление сообщений</div><div id="mx8-bubbles" class="mx8-bubbles">'
      + BUBBLES.map((b) => '<button type="button" class="mx8-bb' + (b.id === cur ? ' on' : '') + '" data-id="' + b.id + '" onclick="mxSetBubbleStyle(\'' + b.id + '\')">'
        + '<span class="mx8-bb-prev" data-mx-prev="' + b.id + '"><i class="mi"></i><i class="mo"></i></span><span class="mx8-bb-name">' + b.name + '</span></button>').join('')
      + '</div>';
  }
  const _custom = window.mxOpenChatCustomize;
  if (typeof _custom === 'function') {
    window.mxOpenChatCustomize = function () {
      const r = _custom.apply(this, arguments);
      try {
        const box = document.querySelector('#mx-customize > div');
        if (box && !$('mx8-bubbles')) { const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px'; wrap.innerHTML = bubbleSectionHtml(); box.insertBefore(wrap, box.children[1] ? box.children[1].nextSibling : null); }
      } catch (e) { console.warn('[mx8] bubbles ui', e); }
      return r;
    };
  }

  /* ═════════ 3. Черновики ═════════ */
  let store = null, storeUid = null, pushTimers = {}, synced = false;
  function drafts() {
    const u = uid(); if (!u) return null;
    if (!store || storeUid !== u) { store = window.MxDrafts.create({ storage: window.localStorage, key: 'mx8_drafts_' + u }); storeUid = u; synced = false; }
    return store;
  }
  function pushDraft(chatId) {
    clearTimeout(pushTimers[chatId]);
    pushTimers[chatId] = setTimeout(() => {
      const d = drafts(); if (!d || !window.MchatAPI) return;
      MchatAPI.saveDraft(chatId, d.get(chatId)).then(() => { if (!d.has(chatId)) d.prune(); }).catch(() => { /* офлайн: останется локально, уйдёт при следующей синхронизации */ });
    }, 700);
  }
  function saveCurrent(immediate) {
    const d = drafts(), chatId = curChat(), inp = $('message-input');
    if (!d || !chatId || !inp || window._mxEditingId) return;
    const before = d.get(chatId);
    d.set(chatId, inp.value);
    if (d.get(chatId) !== before) { immediate ? (clearTimeout(pushTimers[chatId]), flush(chatId)) : pushDraft(chatId); markLabels(); }
  }
  function flush(chatId) { const d = drafts(); if (d && window.MchatAPI) MchatAPI.saveDraft(chatId, d.get(chatId)).catch(() => {}); }
  async function syncFromServer() {
    const d = drafts(); if (!d || synced || !window.MchatAPI) return;
    synced = true;
    try {
      const r = await MchatAPI.listDrafts();
      const push = d.merge(r.drafts || []);
      push.forEach(pushDraft);
      markLabels();
      const chatId = curChat(), inp = $('message-input');
      if (chatId && inp && !inp.value && d.get(chatId)) { inp.value = d.get(chatId); gv(() => mxOnComposeInput()); }
    } catch (e) { synced = false; }
  }
  // красная надпись «Черновик» в списке чатов
  function markLabels() {
    const d = drafts(), list = $('chats-list'); if (!d || !list) return;
    list.querySelectorAll('.chat-item').forEach((item) => {
      const m = /openChat\('([^']+)'\)/.exec(item.getAttribute('onclick') || ''); if (!m) return;
      const last = item.querySelector('.chat-last'); if (!last) return;
      const open = m[1] === curChat() && gv(() => $('s-chat-open').classList.contains('active'), false);
      const has = d.has(m[1]) && !open;
      let tag = last.querySelector('.mx8-draft');
      if (has) {
        if (!last.dataset.mx8orig) last.dataset.mx8orig = last.textContent;
        const txt = d.get(m[1]).replace(/\s+/g, ' ').trim().slice(0, 80);
        last.textContent = '';
        tag = document.createElement('span'); tag.className = 'mx8-draft'; tag.textContent = 'Черновик:';
        last.appendChild(tag); last.appendChild(document.createTextNode(' ' + txt));
      } else if (tag) { last.textContent = last.dataset.mx8orig || ''; }
      if (!has) delete last.dataset.mx8orig;
    });
  }
  const _renderChats = window.renderChats;
  if (typeof _renderChats === 'function') window.renderChats = function () { const r = _renderChats.apply(this, arguments); try { markLabels(); } catch (e) { /* noop */ } return r; };

  const _onInput = window.mxOnComposeInput;
  if (typeof _onInput === 'function') window.mxOnComposeInput = function () { const r = _onInput.apply(this, arguments); try { saveCurrent(false); } catch (e) { /* noop */ } return r; };

  const _open = window.openChat;
  if (typeof _open === 'function') {
    window.openChat = function (id) {
      try { saveCurrent(true); } catch (e) { /* noop */ }              // сохраняем текст чата, из которого уходим
      const p = _open.apply(this, arguments);
      try {                                                             // синхронная часть openChat уже выполнена → поле ввода можно заполнять
        const d = drafts(), inp = $('message-input');
        if (d && inp && !window._mxEditingId) { inp.value = d.get(id) || ''; gv(() => mxOnComposeInput()); gv(() => { inp.style.height = 'auto'; inp.dispatchEvent(new Event('input', { bubbles: true })); }); }
        markLabels();
      } catch (e) { console.warn('[mx8] draft restore', e); }
      return p;
    };
  }
  // выход из чата кнопкой «назад», закрытие вкладки, сворачивание — текст не теряется
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#s-chat-open .coh .mx8-isl-back button, #s-chat-open .coh > .ib')) { try { saveCurrent(true); } catch (er) { /* noop */ } setTimeout(markLabels, 60); } }, true);
  window.addEventListener('pagehide', () => { try { saveCurrent(true); } catch (e) { /* noop */ } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { try { saveCurrent(true); } catch (e) { /* noop */ } } });
  window.addEventListener('beforeunload', () => { try { saveCurrent(true); } catch (e) { /* noop */ } });

  /* ═════════ 4. Длинный текст → части ═════════ */
  const _send = window.sendMessage;
  if (typeof _send === 'function' && window.MxTextSplit) {
    let sending = false;
    window.sendMessage = async function () {
      const inp = $('message-input');
      if (!inp || window._mxEditingId || sending) return _send.apply(this, arguments);
      const text = inp.value;
      if (text.trim().length <= MxTextSplit.LIMIT) {
        const chatId = curChat(), r = await _send.apply(this, arguments);
        try { const d = drafts(); if (d && chatId && !inp.value.trim()) { d.clear(chatId); pushDraft(chatId); markLabels(); } } catch (e) { /* noop */ }   // отправили — черновик очищен
        return r;
      }
      const parts = MxTextSplit.split(text);
      sending = true;
      try {
        for (let i = 0; i < parts.length; i++) {
          inp.value = parts[i];
          await _send.call(this);
          if (inp.value.trim()) {                                       // часть не ушла (ошибка сети/лимит) — возвращаем в поле ВЕСЬ остаток, ничего не теряем
            inp.value = parts.slice(i).join('');
            toast('Не удалось отправить часть сообщения. Остаток оставлен в поле ввода');
            gv(() => mxOnComposeInput());
            return;
          }
        }
        const d = drafts(), chatId = curChat(); if (d && chatId) { d.clear(chatId); pushDraft(chatId); markLabels(); }
      } finally { sending = false; }
    };
  }

  /* ═════════ 5. Панель записи голосового ═════════ */
  function tuneRecPanel() {
    const cancel = $('mx7-cancel');
    if (cancel && !cancel.dataset.mx8) {
      cancel.dataset.mx8 = '1';
      cancel.setAttribute('role', 'button'); cancel.setAttribute('aria-label', 'Отмена записи'); cancel.tabIndex = 0;
      cancel.innerHTML = '<span>ОТМЕНА</span>';
      const doCancel = (e) => { e.preventDefault(); e.stopPropagation(); gv(() => { if (mxRec) mxVoiceCancel(); }); };   // только отмена: ничего не отправляется
      cancel.addEventListener('click', doCancel);
      cancel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') doCancel(e); });
    }
    const trash = document.querySelector('#mx-rec > .ib.ghost');
    if (trash && !trash.dataset.mx8) { trash.dataset.mx8 = '1'; trash.setAttribute('aria-label', 'Удалить запись'); trash.title = 'Удалить запись'; }
    const once = $('mx-once-rec');
    if (once && !once.dataset.mx8) {
      once.dataset.mx8 = '1'; once.title = 'Одноразовое медиа'; once.setAttribute('aria-label', 'Одноразовое медиа');
      const sp = once.querySelector('span'); if (sp) sp.textContent = 'Одноразовое медиа';
    }
  }
  // страховка: отменённая запись не отправляется никогда
  const _vsend = window.mxVoiceSend;
  if (typeof _vsend === 'function') window.mxVoiceSend = function () { if (!gv(() => mxRec && mxRec.blob, null)) return; return _vsend.apply(this, arguments); };

  /* ═════════ 6. Звонки ═════════ */
  const unclose = (...ids) => ids.forEach((id) => { const el = $(id); if (el) el.classList.remove('mx7-closed'); });
  ['mxCallShowScreen'].forEach((n) => { const o = window[n]; if (typeof o === 'function') window[n] = function () { unclose('call-screen'); return o.apply(this, arguments); }; });
  const _inc = window.mxOnCallIncoming;
  if (typeof _inc === 'function') window.mxOnCallIncoming = function () { unclose('call-incoming'); const r = _inc.apply(this, arguments); try { const el = $('call-incoming'); if (el && gv(() => !!mxIncoming, false)) el.classList.add('active'); } catch (e) { /* noop */ } return r; };

  // таймаут подключения: зависший loginRoom/createStream не блокирует интерфейс — через 25 с звонок закрывается с понятным сообщением
  const _connect = window.mxCallConnect;
  if (typeof _connect === 'function') {
    window.mxCallConnect = function (call) {
      let t; const args = arguments, self = this;
      const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('таймаут подключения')), 25000); });
      return Promise.race([_connect.apply(self, args), timeout]).finally(() => clearTimeout(t));
    };
  }
  // потеря сети во время звонка: предупреждаем сразу, если не вернулась за 20 с — завершаем и освобождаем камеру/микрофон
  let offTimer = null;
  window.addEventListener('offline', () => {
    if (!gv(() => !!mxCall, false)) return;
    toast('Нет сети. Пробуем восстановить соединение…');
    clearTimeout(offTimer);
    offTimer = setTimeout(() => { if (!navigator.onLine && gv(() => !!mxCall, false)) window.mxCallCleanup('Связь прервалась'); }, 20000);
  });
  window.addEventListener('online', () => { clearTimeout(offTimer); if (gv(() => !!mxCall, false)) toast('Связь восстановлена'); });
  // сторож: экран звонка не может «висеть», если самого звонка нет
  setInterval(() => {
    const alive = gv(() => !!mxCall || !!mxIncoming, false);
    if (alive) return;
    ['call-screen', 'call-incoming'].forEach((id) => { const el = $(id); if (el && el.classList.contains('active')) el.classList.remove('active'); });
    root.classList.remove('mx-in-call');
  }, 1500);

  /* ═════════ 7. Нативный мост (Android APK, Capacitor): FLAG_SECURE для одноразовых фото ═════════ */
  function bridgeNative() {
    const cap = window.Capacitor; if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
    let plug = null; try { plug = cap.registerPlugin ? cap.registerPlugin('ScreenGuard') : (cap.Plugins && cap.Plugins.ScreenGuard); } catch (e) { plug = cap.Plugins && cap.Plugins.ScreenGuard; }
    if (!plug) return;
    window.MchatNative = Object.assign(window.MchatNative || {}, {
      native: true,
      setSecure: (on) => { try { plug.setSecure({ enabled: !!on }); } catch (e) { /* noop */ } },
    });
    root.classList.add('mx-native');
  }
  bridgeNative();

  /* ═════════ 3.1 Видеокружки: запуск камеры без чёрного экрана ═════════
     Что исправлено относительно прежней версии:
       • не было отмены: если окно закрыли, пока камера открывалась (короткое нажатие, отмена), поток оставался включённым
         и следующий запуск получал чёрный экран → теперь каждый запуск проверяет, что он ещё актуален, и освобождает треки;
       • флаг camStarting мог «залипнуть» навсегда (play() без кадров не завершается) и блокировал все следующие открытия →
         теперь новый запуск просто вытесняет старый (токен), а play() ограничен по времени;
       • микрофон запрашивался ДО камеры и при отказе закрывал камеру → теперь сначала камера, микрофон — потом, без него кружок пишется без звука;
       • ошибки показываются с понятным текстом и именем (для диагностики на устройстве). */
  let camToken = 0;
  const stopTracks = (arr) => arr.forEach((t) => { try { t.onended = null; t.stop(); } catch (e) { /* noop */ } });
  const sleep8 = (ms) => new Promise((r) => setTimeout(r, ms));
  const camErrText = (e) => {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Нет доступа к камере. Разрешите её в настройках браузера';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Камера не найдена или не поддерживается этим браузером';
    if (n === 'NotReadableError') return 'Камера занята другим приложением';
    return 'Камера не дала изображение. Попробуйте ещё раз' + (n ? ' (' + n + ')' : '');
  };
  window.mxCameraStartStream = async function () {
    const cam = gv(() => mxCam, null), v = $('mx-cam-video');
    if (!cam || !v) return;
    const token = ++camToken;
    const dead = () => token !== camToken || gv(() => mxCam, null) !== cam;   // запуск вытеснен новым или окно закрыто
    let vs = null, audioTracks = [];
    try {
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.autoplay = true;
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Камера недоступна в этом браузере (нужен https)'); return gv(() => mxCameraClose()); }
      if (cam.stream) { stopTracks(cam.stream.getTracks()); cam.stream = null; }
      v.srcObject = null;
      const prof = (window.MxPerf && MxPerf.profile) ? MxPerf.profile() : { capW: 1280, capH: 720, fps: 30 };
      let err = null;
      for (let attempt = 0; attempt < 2 && !vs; attempt++) {
        try { vs = await window.mx7OpenVerified({ facing: cam.facing, deviceId: cam.deviceId, width: prof.capW, height: prof.capH, fps: prof.fps, video: v, cancelled: dead }); }
        catch (e) {
          err = e;
          if (dead() || (e && (e.name === 'Cancelled' || e.name === 'NotAllowedError' || e.name === 'SecurityError'))) break;
          await sleep8(350);   // Android: камере нужно время, чтобы освободиться
        }
      }
      if (dead()) { if (vs) stopTracks(vs.getTracks()); return; }
      if (!vs) { console.warn('[camera] запуск не удался:', err && err.name, err && err.message); toast(camErrText(err)); return gv(() => mxCameraClose()); }
      if (cam.mode === 'circle') {
        try { const as = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); audioTracks = as.getAudioTracks(); }
        catch (e) { if (!dead()) toast('Нет доступа к микрофону — кружок запишется без звука'); }
      }
      if (dead()) { stopTracks(vs.getTracks().concat(audioTracks)); return; }
      const track = vs.getVideoTracks()[0];
      cam.stream = new MediaStream([track].concat(audioTracks));
      const st = (track.getSettings && track.getSettings()) || {};
      cam.facing = (window.MxCamera && MxCamera.facingOf(track)) || st.facingMode || cam.facing;
      cam.deviceId = st.deviceId || cam.deviceId;
      v.srcObject = cam.stream; v.classList.toggle('mirror', cam.facing === 'user');
      try { await Promise.race([v.play(), sleep8(1500)]); } catch (e) { /* автозапуск уже идёт */ }
      // камеру отняли (звонок, другое приложение) — не оставляем чёрный экран, а пробуем перезапустить один раз
      track.onended = () => { if (gv(() => mxCam === cam && !cam.recording && !!cam.stream, false)) { toast('Камера отключилась, перезапускаем…'); setTimeout(() => window.mxCameraStartStream(), 400); } };
      try { if (window.mxCamOnTrack) window.mxCamOnTrack(); } catch (e) { /* noop */ }
    } catch (e) {
      console.warn('[camera] ошибка запуска:', e && e.name, e && e.message);
      if (vs) stopTracks(vs.getTracks());
      stopTracks(audioTracks);
      if (!dead()) { toast(camErrText(e)); gv(() => mxCameraClose()); }
    }
  };
  // вернулись во вкладку/приложение — если превью замерло, оживляем
  document.addEventListener('visibilitychange', () => { const v = $('mx-cam-video'); if (!document.hidden && v && v.srcObject && v.paused) v.play().catch(() => {}); });

  /* ═════════ 3.2 Вспышка / подсветка в камере кружка ═════════
     Реальные возможности браузера проверяются, а не предполагаются:
       • задняя камера + track.getCapabilities().torch (Chrome на Android) → аппаратная вспышка (applyConstraints {torch});
       • фронтальная камера, iOS Safari и всё, где torch нет или он отклонён → экранная подсветка:
         верхняя часть экрана становится белой (#mx-cam-light), превью камеры остаётся видимым. В запись подсветка не попадает. */
  const camNow = () => gv(() => mxCam, null);
  const camTrackNow = () => { const c = camNow(); return (c && c.stream && c.stream.getVideoTracks()[0]) || null; };
  const torchCapable = (t) => { try { const c = t && t.getCapabilities && t.getCapabilities(); return !!(c && 'torch' in c); } catch (e) { return false; } };
  function setScreenLight(on) {
    const el = $('mx-camera'); if (!el) return;
    if (el.classList.contains('mx-light') !== !!on) el.classList.toggle('mx-light', !!on);   // меняем class только при изменении
  }
  function paintFlashBtn(on) {
    const b = $('mx-cam-flash'); if (!b) return;
    if (b.classList.contains('on') !== !!on) b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  async function applyFlash(announce) {
    const cam = camNow(); if (!cam) { setScreenLight(false); paintFlashBtn(false); return; }
    const on = !!cam.flashOn, t = camTrackNow();
    let torch = false;
    if (t && torchCapable(t)) {
      if (on && cam.facing === 'environment') { try { await t.applyConstraints({ advanced: [{ torch: true }] }); torch = true; } catch (e) { console.warn('[camera] torch отклонён:', e && e.name); } }
      else if (cam.torchOn) { try { await t.applyConstraints({ advanced: [{ torch: false }] }); } catch (e) { /* трек уже остановлен */ } }
    }
    cam.torchOn = torch;
    setScreenLight(on && !torch);
    paintFlashBtn(on);
    if (announce && on && !torch && cam.facing === 'environment') toast('Аппаратная вспышка недоступна — включена подсветка экраном');
  }
  window.mxCameraFlash = function () {
    const cam = camNow(); if (!cam) return;
    cam.flashOn = !cam.flashOn;
    return applyFlash(true);
  };
  window.mxCamOnTrack = function () { const cam = camNow(); if (cam && cam.flashOn) applyFlash(false); };
  // закрыли камеру — подсветка и кнопка сбрасываются (аппаратная вспышка гаснет вместе с остановкой трека)
  const _camClose = window.mxCameraClose;
  if (typeof _camClose === 'function') {
    window.mxCameraClose = function () {
      const r = _camClose.apply(this, arguments);
      setScreenLight(false); paintFlashBtn(false);
      return r;
    };
  }

  /* ═════════ 10.3 Блок установки на экране входа: APK-кнопка появляется ТОЛЬКО когда в app-config.json задан реальный apkUrl ═════════ */
  (function installBlock() {
    const standalone = window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone || (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform())) return;   // уже установлено — блок не нужен
    const box = $('mx8-install'); if (!box) return;
    box.hidden = false;
    fetch('/app-config.json', { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null).then((c) => {
      const a = $('mx8-apk');
      if (c && typeof c.apkUrl === 'string' && /^https?:\/\//.test(c.apkUrl) && a) { a.href = c.apkUrl; a.hidden = false; }
    }).catch(() => { /* конфиг недоступен — кнопки APK просто нет */ });
  })();

  /* ═════════ запуск ═════════ */
  function tick() {
    try { buildHeaderIslands(); } catch (e) { console.warn('[mx8] header', e); }
    try { loadBubbleForUser(); } catch (e) { /* noop */ }
    try { tuneRecPanel(); } catch (e) { /* noop */ }
    try { if (uid()) { drafts(); syncFromServer(); } } catch (e) { /* noop */ }
  }
  window.__mx8tick = tick;
  setInterval(tick, 800);
  if (document.readyState !== 'loading') tick(); else document.addEventListener('DOMContentLoaded', tick);
})();
