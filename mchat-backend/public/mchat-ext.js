/* Mchat · клиентские расширения (подключается ПОСЛЕ script.js).
 * Переопределяет/дополняет функции приложения, не меняя дизайн:
 *   1. Поле ввода — textarea с автовысотой
 *   2. HD-режим камеры, сжатие фото/видео, значок HD в чате
 *   3. Истории других пользователей
 *   4. Входящие звонки: рингтон, push «Ответить»
 *   5. Вход в админ-аккаунт Mchat
 *   6. Закреплённые чаты, кнопки уведомлений канала
 *   7. Реакции: панель + «+» (любой эмодзи)
 *   8. Техподдержка → чат с админом Mchat
 *   9. Маски в видеозвонках (см. masks.js)
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (m) => showToast(m);

  /* ════════════════════════ 1. ПОЛЕ ВВОДА (autosize textarea) ════════════════════════ */
  const ENTER_KEY = 'mchat_enter_send';
  const enterSends = () => { try { return localStorage.getItem(ENTER_KEY) === '1'; } catch (e) { return false; } };

  function autosize() {
    const ta = $('message-input');
    if (!ta) return;
    ta.style.height = 'auto';
    const max = parseFloat(getComputedStyle(ta).maxHeight) || 124;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';   // скроллбар только когда достигли максимума
  }
  window.mxAutosize = autosize;

  /** Enter — перенос строки; отправка — кнопкой или Shift+Enter (в настройках можно поменять местами). */
  window.mxComposeKey = function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    const send = enterSends() ? !e.shiftKey : e.shiftKey;
    if (send) { e.preventDefault(); sendMessage(); setTimeout(autosize, 0); }
  };

  const _onCompose = window.mxOnComposeInput;
  window.mxOnComposeInput = function () { _onCompose(); autosize(); };

  const _send = window.sendMessage;
  window.sendMessage = async function () { const r = _send.apply(this, arguments); setTimeout(autosize, 0); return r; };

  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'message-input') autosize(); });
  window.addEventListener('resize', autosize);

  /* ════════════════════════ 2. HD, сжатие, значок HD ════════════════════════ */
  window.mxHdPref = () => { try { return localStorage.getItem('mchat_hd') === '1'; } catch (e) { return false; } };
  window.mxSetHdPref = (v) => { try { localStorage.setItem('mchat_hd', v ? '1' : '0'); } catch (e) {} syncHdButtons(); };

  const KB = 1024, MB = 1024 * 1024;
  // Без HD: фото/видео ужимаются до ~100–200 КБ. С HD: высокое качество, до ~1–2 МБ.
  // 'best' — не выбор пользователя, а автоматический режим для кружков (лучшее качество камеры, потолок ≈ 15 МБ).
  const LIMITS = {
    photo: { sd: { max: 200 * KB, side: 1280, q: 0.6 }, hd: { max: 2 * MB, side: 2560, q: 0.9 }, best: { max: 15 * MB, side: 3072, q: 0.92 } },
    video: { sd: { max: 200 * KB, side: 360, audio: 16000 }, hd: { max: 2 * MB, side: 1080, audio: 64000 }, best: { max: 15 * MB, side: 1080, audio: 96000 } },
  };
  const tier = (kind, hd) => LIMITS[kind][hd === 'best' ? 'best' : hd ? 'hd' : 'sd'];

  /** Битрейты MediaRecorder на «живой» записи (чтобы потом не пережимать лишний раз). */
  window.mxRecorderBitrates = function (hd, maxSec) {
    if (!hd) return { videoBitsPerSecond: 250000, audioBitsPerSecond: 16000 };
    if (hd === true) return { videoBitsPerSecond: 2500000, audioBitsPerSecond: 64000 };   // выбор пользователя «HD»
    // 'best' (кружок): подбираем битрейт так, чтобы запись максимальной длины весила ≈ 15 МБ (с запасом на контейнер)
    const sec = Math.max(5, maxSec || 60), audio = 96000;
    const total = (15 * 1024 * 1024 * 8 * 0.86) / sec;
    return { videoBitsPerSecond: Math.round(Math.min(8000000, Math.max(700000, total - audio))), audioBitsPerSecond: audio };
  };

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { try { return await createImageBitmap(file); } catch (e2) { /* ниже */ } }
    }
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
  }

  /** Фото: подбираем качество и размер, пока файл не уложится в лимит режима. */
  window.mxCompressImage = async function (file, hd) {
    const t = (file.type || '').toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(t)) return file;
    const L = tier('photo', hd);
    try {
      const src = await loadBitmap(file);
      const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      let k = Math.min(1, L.side / Math.max(w, h));
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const encode = (q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
      let blob = null;
      for (let pass = 0; pass < 8; pass++) {
        canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // прозрачный PNG → белый фон
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
        let q = L.q;
        blob = await encode(q);
        while (blob && blob.size > L.max && q > 0.42) { q -= 0.08; blob = await encode(q); }
        if (!blob || blob.size <= L.max) break;
        k *= 0.82;                                         // всё ещё тяжёлый — уменьшаем разрешение
      }
      if (src.close) src.close();
      if (!blob) return file;
      if (blob.size >= file.size && file.size <= L.max) return file;   // оригинал уже достаточно лёгкий
      const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (e) { return file; }
  };

  function pickVideoMime() {
    for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  /** Видео: перекодируем через canvas + MediaRecorder с битрейтом под целевой размер (по длительности). */
  async function transcodeVideo(blob, hd, knownDur) {
    const L = tier('video', hd);
    if (!window.MediaRecorder) return blob;
    const mime = pickVideoMime();
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.src = url; v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0';
    document.body.appendChild(v);
    try {
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
      if (!isFinite(v.duration) || v.duration > 1e6) {   // у webm из MediaRecorder длительность бывает Infinity
        v.currentTime = 1e7; await new Promise((res) => { v.ontimeupdate = () => { v.ontimeupdate = null; res(); }; setTimeout(res, 1500); }); v.currentTime = 0;
      }
      const dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : (knownDur || 10);
      if (dur > 120) return blob;                       // длинные ролики не пережимаем в реальном времени
      const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
      const k = Math.min(1, L.side / Math.min(vw, vh));
      const cw = Math.max(2, Math.round(vw * k / 2) * 2), ch = Math.max(2, Math.round(vh * k / 2) * 2);
      const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d', { alpha: false });
      const out = canvas.captureStream(hd ? 30 : 15);
      let withAudio = false;
      try {
        const cap = v.captureStream ? v.captureStream() : v.mozCaptureStream ? v.mozCaptureStream() : null;
        if (cap) cap.getAudioTracks().forEach((t) => { out.addTrack(t); withAudio = true; });
      } catch (e) { /* без звука */ }
      const totalBits = L.max * 8 * 0.82 / dur;           // 82 % лимита — запас на контейнер
      const audioBps = withAudio ? L.audio : 0;
      const videoBps = Math.max(30000, Math.round(totalBits - audioBps));
      const rec = new MediaRecorder(out, Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: videoBps, audioBitsPerSecond: audioBps || undefined }));
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      v.muted = false; v.volume = 0.0001;                 // чтобы captureStream отдавал звук, но без эха
      let raf = 0;
      const draw = () => { ctx.drawImage(v, 0, 0, cw, ch); raf = requestAnimationFrame(draw); };
      rec.start(250);
      await v.play();
      draw();
      await new Promise((res) => { v.onended = res; setTimeout(res, (dur + 3) * 1000); });
      cancelAnimationFrame(raf);
      if (rec.state !== 'inactive') rec.stop();
      await done;
      const res = new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
      return res.size > 0 && res.size < blob.size ? res : blob;
    } catch (e) {
      console.warn('[video] transcode failed', e);
      return blob;
    } finally {
      v.pause(); v.remove(); URL.revokeObjectURL(url);
    }
  }

  window.mxCompressVideoBlob = async function (blob, hd, dur) {
    const L = tier('video', hd);
    if (blob.size <= L.max * 1.05) return blob;
    return transcodeVideo(blob, hd, dur);
  };
  window.mxCompressVideoFile = async function (file, hd) {
    const type = (file.type || '').toLowerCase();
    if (!/^video\//.test(type)) return file;
    const out = await window.mxCompressVideoBlob(file, hd);
    if (out === file) return file;
    return new File([out], (file.name || 'video').replace(/\.[^.]+$/, '') + '.webm', { type: out.type || 'video/webm', lastModified: Date.now() });
  };

  /* Кнопка «HD» в интерфейсе съёмки: чат (кружок/фото) и создание истории */
  function syncHdButtons() {
    document.querySelectorAll('.mx-hd-btn[data-hd-toggle]').forEach((b) => b.classList.toggle('on', window.mxHdPref()));
  }
  function mountHdButtons() {
    // В кружке/фото из чата выбор HD убран: качество подбирается автоматически под камеру и устройство
    const oldHd = $('mx-cam-hd'); if (oldHd) oldHd.remove();
    const sc = $('sc-preview');
    if (sc && !$('sc-hd')) {
      const b = document.createElement('button');
      b.id = 'sc-hd'; b.type = 'button'; b.className = 'mx-hd-btn sc'; b.dataset.hdToggle = '1'; b.textContent = 'HD'; b.title = 'HD';
      b.onclick = () => { mxSetHdPref(!mxHdPref()); toast(mxHdPref() ? 'HD: высокое качество, до 2 МБ' : 'Обычное качество: до 200 КБ'); };
      sc.appendChild(b);
    }
    syncHdButtons();
  }
  // Предпросмотр фото из галереи уже имеет свою кнопку HD — синхронизируем её с общим выбором
  const _pvSync = window.mxPreviewSyncUi;
  window.mxPreviewSyncUi = function () {
    if (mxPv && !mxPv._hdInit) { mxPv._hdInit = true; mxPv.hd = mxHdPref(); }   // старт — с общего выбора HD
    _pvSync();
  };
  window.mxPreviewToggleHD = function () {
    if (!mxPv) return;
    mxPv.hd = !mxPv.hd; mxSetHdPref(mxPv.hd); mxPreviewSyncUi();
    toast(mxPv.hd ? 'HD: высокое качество, до 2 МБ' : 'Обычное качество: до 200 КБ');
  };

  // Значок HD на отправленном фото/видео: правый нижний угол, полупрозрачный, с «бликом»
  const _msgFromServer = window.msgFromServer;
  window.msgFromServer = function (m) { const r = _msgFromServer(m); r.hd = !!m.hd; return r; };
  const _bubble = window.bubbleBodyHtml;
  window.bubbleBodyHtml = function (m) {
    const html = _bubble(m);
    if (!m.hd || !['IMAGE', 'VIDEO', 'VIDEO_NOTE'].includes(m.kind)) return html;
    const badge = '<span class="mx-hdbadge">HD</span>';
    if (m.kind === 'IMAGE') return html.replace(/<img\b[^>]*>/, (t) => '<span class="mx-hdwrap">' + t + badge + '</span>');
    if (m.kind === 'VIDEO') return html.replace(/<video\b[\s\S]*?<\/video>/, (t) => '<span class="mx-hdwrap">' + t + badge + '</span>');
    return html.replace(/(<div class="mx-vn-dur">)/, badge + '$1');   // кружок: значок рядом с длительностью
  };

  /* ════════════════════════ 3. ИСТОРИИ ДРУГИХ ПОЛЬЗОВАТЕЛЕЙ ════════════════════════ */
  let feedGroups = [];
  const SEEN_KEY = 'mchat_story_seen';
  const seenMap = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; } };
  const markSeen = (id) => {
    try {
      const m = seenMap(); m[id] = Date.now();
      const cut = Date.now() - 36 * 3600 * 1000;
      Object.keys(m).forEach((k) => { if (m[k] < cut) delete m[k]; });
      localStorage.setItem(SEEN_KEY, JSON.stringify(m));
    } catch (e) { /* не критично */ }
  };

  async function refreshFeedStories() {
    if (!currentUser) return;
    try { feedGroups = (await MchatAPI.storiesFeed()).groups || []; } catch (e) { return; }
    renderStories();
  }
  window.mxStoriesViewed = () => { renderStories(); };

  const _renderStories = window.renderStories;
  window.renderStories = function () {
    _renderStories();
    const row = $('stories-row');
    if (!row || !currentUser) return;
    const seen = seenMap();
    row.insertAdjacentHTML('beforeend', feedGroups.map((g, i) => {
      const allSeen = g.stories.every((s) => seen[s.id]);
      const av = g.avatar
        ? `<img src="${esc(g.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" referrerpolicy="no-referrer">`
        : `<span style="color:var(--text);font-weight:700;font-size:20px">${esc((g.name || g.username).charAt(0).toUpperCase())}</span>`;
      return `<div class="si" onclick="mxViewUserStories(${i})">
        <div class="sring has-story${allSeen ? ' seen' : ''}" style="position:relative"><div class="sinner" style="display:flex;align-items:center;justify-content:center">${av}</div></div>
        <div class="sname">${esc(g.username)}</div></div>`;
    }).join(''));
  };

  window.mxViewUserStories = function (i) {
    const g = feedGroups[i];
    if (!g || !g.stories.length) return;
    svList = g.stories.map(storyFromServer);
    svAuthor = { username: g.username, avatar: g.avatar };
    const seen = seenMap();
    const firstNew = svList.findIndex((s) => !seen[s.id]);
    svCurrentIdx = firstNew >= 0 ? firstNew : 0;
    _openStoryViewer();
  };
  const _openSV = window._openStoryViewer;
  window._openStoryViewer = function () {
    _openSV();
    if (svList && svList[svCurrentIdx]) markSeen(svList[svCurrentIdx].id);
  };

  const _refreshMine = window.refreshMyStories;
  window.refreshMyStories = async function () { await _refreshMine(); refreshFeedStories(); };
  setInterval(() => {
    const feed = $('s-feed');
    if (currentUser && !document.hidden && feed && feed.classList.contains('active')) refreshFeedStories();
  }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFeedStories(); });

  /* ════════════════════════ 4. ВХОДЯЩИЕ ЗВОНКИ: РИНГТОН ════════════════════════ */
  let ringAudio = null, ringUnlock = null, ringVibe = null;

  function clearCallNotifications() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      reg.getNotifications().then((list) => list.filter((n) => n.data && n.data.kind === 'call').forEach((n) => n.close()));
    }).catch(() => {});
  }

  /** Мелодия звонка из /sounds/ringtone.wav по кругу — до ответа, отклонения или отмены вызова. */
  window.mxRingStart = function () {
    mxRingStop();
    try {
      ringAudio = new Audio('/sounds/ringtone.wav');
      ringAudio.loop = true; ringAudio.volume = 1;
      const p = ringAudio.play();
      if (p && p.catch) p.catch(() => {
        // браузер не разрешает звук без касания страницы — зазвоним при первом же касании
        ringUnlock = () => { if (ringAudio) ringAudio.play().catch(() => {}); cleanupUnlock(); };
        ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, ringUnlock, { once: true, passive: true }));
      });
    } catch (e) { ringAudio = null; }
    if (navigator.vibrate) {
      navigator.vibrate([600, 300, 600, 300, 600]);
      ringVibe = setInterval(() => navigator.vibrate([600, 300, 600, 300, 600]), 3000);
    }
  };
  function cleanupUnlock() {
    if (!ringUnlock) return;
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.removeEventListener(ev, ringUnlock));
    ringUnlock = null;
  }
  window.mxRingStop = function () {
    cleanupUnlock();
    if (ringAudio) { try { ringAudio.pause(); ringAudio.currentTime = 0; } catch (e) {} ringAudio = null; }
    if (ringVibe) { clearInterval(ringVibe); ringVibe = null; if (navigator.vibrate) navigator.vibrate(0); }
    clearCallNotifications();
  };

  /** «Ответить» в push-уведомлении (приложение было закрыто/свёрнуто). */
  window.mxAcceptCallFromPush = function (d) {
    if (!d || !d.callId || !currentUser) return;
    if (mxCall) return;
    mxIncoming = { callId: d.callId, chatId: d.chatId, video: !!d.video, isGroup: false, title: '', from: { name: d.title || '', username: '' } };
    mxCallAccept();
  };

  /* ════════════════════════ 5. ВХОД В АДМИН-АККАУНТ «Mchat» ════════════════════════ */
  window.authAction = function () {
    const raw = $('login-username').value.trim().replace(/^@/, '');
    const errEl = $('auth-err');
    errEl.textContent = '';
    if (raw.toLowerCase() === 'mchat') { mxAskAdminLogin(); return; }   // служебный ник: подтверждение выбора аккаунта
    if (raw && !/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
      errEl.textContent = raw.length < 3 ? 'Ник: минимум 3 символа' : 'Ник: 3–20 символов, латиница, цифры и _';
      return;
    }
    const btn = $('auth-btn'); btn.disabled = true;
    $('auth-btn-text').textContent = 'Переходим в Google…';
    MchatAPI.startGoogle(raw);
  };
  function mxAskAdminLogin() {
    const m = document.createElement('div');
    m.className = 'modal active'; m.id = 'mx-admin-login'; m.style.zIndex = '990';
    m.innerHTML = `<div class="modal-box" style="text-align:center">
      <h3>Аккаунт Mchat</h3>
      <div style="font-size:14px;color:var(--text2);line-height:1.5;margin:8px 0 18px">Войти в административный аккаунт Mchat? Подтвердите вход Google-аккаунтом владельца.</div>
      <div class="mx-row-btns">
        <button class="mx-btn" onclick="document.getElementById('mx-admin-login').remove()">Отмена</button>
        <button class="mx-btn primary" onclick="mxConfirmAdminLogin()">Подтвердить</button>
      </div></div>`;
    $('app').appendChild(m);
  }
  window.mxConfirmAdminLogin = function () {
    const b = $('mx-admin-login'); if (b) b.remove();
    $('auth-btn').disabled = true;
    $('auth-btn-text').textContent = 'Переходим в Google…';
    MchatAPI.startGoogle('mchat', true);
  };

  /* Звонок из push: ?call=ID&chat=...&video=1 — после входа сразу отвечаем */
  const bootQs = new URLSearchParams(window.__mxBootSearch || '');
  const _onLoggedIn = window.onLoggedIn;
  window.onLoggedIn = async function (me) {
    await _onLoggedIn(me);
    const callId = bootQs.get('call');
    if (callId) {
      bootQs.delete('call');
      setTimeout(() => window.mxAcceptCallFromPush({ callId, chatId: bootQs.get('chat') || '', video: bootQs.get('video') === '1', title: '' }), 600);
    }
  };

  /* ════════════════════════ 6. ЗАКРЕПЛЁННЫЕ ЧАТЫ + КНОПКИ КАНАЛА ════════════════════════ */
  const PIN_SVG = '<svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><path d="M16 3l5 5-3 1-3 4 1 4-2 2-4-4-6 6-1-1 6-6-4-4 2-2 4 1 4-3z"/></svg>';

  window._renderChatsInner = function (q) {
    q = (q || '').replace(/^[@#]/, '');
    const c = $('chats-list');
    if (!c) return;
    let list = chats.filter((ch) => (ch.name || '').toLowerCase().includes(q));
    if (list.length === 0) { c.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text2)">${q ? 'Не найдено' : 'Нет чатов'}</div>`; return; }
    // закреплённые — сверху (в порядке закрепления), остальные — как были (по свежести)
    const pinned = list.filter((ch) => ch.pinnedChat).sort((a, b) => String(a.pinnedChatAt).localeCompare(String(b.pinnedChatAt)));
    list = pinned.concat(list.filter((ch) => !ch.pinnedChat));
    // «Избранное» всегда первым в списке (если нет поиска, который его не находит)
    list = list.filter((ch) => ch.type === 'SAVED').concat(list.filter((ch) => ch.type !== 'SAVED'));
    c.innerHTML = list.map((ch) => `
      <div class="chat-item${ch.pinnedChat ? ' mx-pinned-chat' : ''}" data-chat-id="${esc(ch.id)}" onclick="openChat('${esc(ch.id)}')">
        <div class="chat-avatar">${chatAvatarHtml(ch)}</div>
        <div class="chat-info"><div class="chat-name">${esc(ch.name)}${ch.pinnedChat ? `<span class="mx-pin-ico">${PIN_SVG}</span>` : ''}</div><div class="chat-last">${esc(ch.lastMessage || '')}</div></div>
        <div class="chat-time">${esc(ch.time || '')}</div>
        ${ch.unread > 0 ? '<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-left:8px"></div>' : ''}
      </div>`).join('');
    updateNavBadge();
  };

  // Закрепить/открепить: ПКМ на компьютере, долгое нажатие на телефоне
  function openChatPinMenu(chatId, evt) {
    mxCloseFloating();
    const ch = chats.find((c) => c.id === chatId);
    if (!ch) return;
    const scrim = document.createElement('div');
    scrim.className = 'mx-ctx-scrim'; scrim.onclick = mxCloseFloating;
    const panel = document.createElement('div');
    panel.className = 'mx-ctx';
    panel.innerHTML = mxCtxItem(MX_ICO.pin, ch.pinnedChat ? 'Открепить' : 'Закрепить', `mxTogglePinChat('${esc(chatId)}')`)
      + (window.mxChatMenuExtra ? window.mxChatMenuExtra(ch) : ''); // «Удалить чат» / «Выйти» / «Удалить из контактов»
    $('app').appendChild(scrim); $('app').appendChild(panel);
    mxPositionNear(evt.currentTarget || evt.target.closest('.chat-item') || evt.target, panel);
  }
  window.mxTogglePinChat = async function (id) {
    mxCloseFloating();
    const ch = chats.find((c) => c.id === id);
    if (!ch) return;
    try {
      const r = await MchatAPI.pinChat(id, !ch.pinnedChat);
      ch.pinnedChat = !!r.pinned; ch.pinnedChatAt = r.chat && r.chat.pinnedChatAt || null;
      renderChats($('chat-search') ? $('chat-search').value.toLowerCase() : '');
    } catch (e) { toast(MchatAPI.errorText(e)); }
  };
  (function bindChatListGestures() {
    const list = $('chats-list');
    if (!list) return;
    let timer = null, fired = false;
    list.addEventListener('contextmenu', (e) => { const it = e.target.closest('.chat-item'); if (!it) return; e.preventDefault(); openChatPinMenu(it.dataset.chatId, e); });
    list.addEventListener('touchstart', (e) => {
      const it = e.target.closest('.chat-item'); if (!it) return;
      fired = false;
      timer = setTimeout(() => { fired = true; if (navigator.vibrate) navigator.vibrate(15); openChatPinMenu(it.dataset.chatId, { currentTarget: it, target: it }); }, 500);
    }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach((t) => list.addEventListener(t, () => clearTimeout(timer), { passive: true }));
    list.addEventListener('click', (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  })();

  /** Публичный канал: внизу — овальные полупрозрачные серые кнопки «Включить/Выключить уведомления». */
  window.mxAfterOpenChat = function (ch) {
    let bar = $('mx-chan-bar');
    if (!bar) {
      const row = $('mx-input-row');
      if (!row) return;
      bar = document.createElement('div');
      bar.id = 'mx-chan-bar'; bar.className = 'mx-chan-bar';
      row.parentNode.insertBefore(bar, row);
    }
    const show = ch && ch.type === 'CHANNEL' && ch.isPublic;
    bar.style.display = show ? 'flex' : 'none';
    if (!show) return;
    bar.dataset.chatId = ch.id;
    renderChanBar(ch);
  };
  function renderChanBar(ch) {
    const bar = $('mx-chan-bar'); if (!bar) return;
    bar.innerHTML = `<button class="mx-chan-pill" id="mx-chan-pill" type="button" onclick="mxChanToggle('${esc(ch.id)}')">${ch.muted ? 'Включить уведомления' : 'Выключить уведомления'}</button>`;
  }
  window.mxChanToggle = async function (id) {
    const ch = chats.find((c) => c.id === id);
    if (!ch) return;
    const next = !ch.muted;
    try {
      await MchatAPI.muteChat(id, next);
      ch.muted = next;
      renderChanBar(ch);
      toast(next ? 'Уведомления выключены' : 'Уведомления включены');
    } catch (e) { toast(MchatAPI.errorText(e)); }
  };

  /* ════════════════════════ 7. РЕАКЦИИ: панель + «+» ════════════════════════ */
  const EMOJI_SETS = [
    ['😀', '😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳😎🤓🧐😕😟🙁☹️😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👻👽🤖'],
    ['👍', '👍👎👌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤝🙏✍️💪🦾👏🙌👐🤲🤜🤛✊👊🫶🫰🫡🫠🫢🫣🫥'],
    ['❤️', '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟♥️💋💯💢💥💫💦💨🕳️💬💭💤'],
    ['🔥', '🔥✨⭐🌟💫⚡☄️💥🌈☀️🌤️⛅☁️🌧️⛈️❄️☃️🌊🌸🌹🌺🌻🌼🌷🌱🌿🍀🍁🍂🍃🌍🌙🌚🌝'],
    ['🎉', '🎉🎊🎈🎁🎀🎂🍰🍕🍔🍟🌭🍿🍩🍪🍫🍬🍭🍎🍌🍉🍓🍒🥑🍺🍻🥂🍷☕🍵⚽🏀🏈⚾🎾🏐🎮🎯🎲🎵🎶🎤🎧🎸🎹🥁🏆🥇🥈🥉'],
    ['🐶', '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐢🐍🦖🐙🦑🐠🐬🐳🦈'],
    ['🚗', '🚗🚕🚙🚌🏎️🚓🚑🚒🚜🏍️🚲✈️🚀🛸🚁⛵🚢🏠🏰🗼🗽🌋🗻🏖️🏝️⏰⌚📱💻🖥️📷🔋💡🔑🔒📌📎✏️📚'],
  ];
  window.MX_EMOJI_SETS = EMOJI_SETS;   // та же панель эмодзи используется и в поле ввода
  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
  const split = (s) => seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s);

  const _openReactions = window.mxOpenReactions;
  window.mxOpenReactions = function (id, evt) {
    _openReactions(id, evt);
    const panel = document.querySelector('.mx-react');
    if (!panel || panel.querySelector('.mx-react-plus')) return;
    const plus = document.createElement('button');
    plus.className = 'mx-react-plus'; plus.type = 'button'; plus.textContent = '+'; plus.title = 'Ещё';
    plus.onclick = (e) => { e.stopPropagation(); openEmojiSheet(id); };
    panel.appendChild(plus);
  };

  function openEmojiSheet(msgId) {
    mxCloseFloating();
    const scrim = document.createElement('div');
    scrim.className = 'mx-ctx-scrim'; scrim.onclick = mxCloseFloating;
    const sheet = document.createElement('div');
    sheet.className = 'mx-emoji-sheet';
    sheet.innerHTML = `<div class="hd"><input id="mx-emoji-in" placeholder="Написать реакцию..." autocomplete="off"><button class="ib" type="button" onclick="mxCloseFloating()"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>
      <div class="tabs">${EMOJI_SETS.map((s, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'on' : ''}">${s[0]}</button>`).join('')}</div>
      <div class="mx-emoji-grid" id="mx-emoji-grid"></div>`;
    $('app').appendChild(scrim); $('app').appendChild(sheet);
    const grid = sheet.querySelector('#mx-emoji-grid');
    const fill = (i) => {
      grid.innerHTML = split(EMOJI_SETS[i][1]).map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('');
      sheet.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
    };
    fill(0);
    sheet.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) fill(+b.dataset.i); };
    grid.onclick = (e) => { const b = e.target.closest('button'); if (b) mxPickReaction(msgId, b.dataset.e); };
    // любой эмодзи с клавиатуры устройства: вставили/набрали — берём первый эмодзи из ввода
    const inp = sheet.querySelector('#mx-emoji-in');
    const EM = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*/u;
    inp.addEventListener('input', () => { const m = inp.value.match(EM); if (m) mxPickReaction(msgId, m[0]); });
  }

  /* ════════════════════════ 8. ТЕХПОДДЕРЖКА → чат с админом Mchat ════════════════════════ */
  window.openSupport = function () {
    const m = document.createElement('div');
    m.className = 'modal active';
    m.innerHTML = `<div class="modal-box" style="text-align:center">
      <h3>Техническая поддержка</h3>
      <div style="font-size:13px;color:var(--text2);text-align:left;margin:10px 0 8px">Опиши проблему — сообщение придёт в чат с администратором Mchat, ответ будет там же.</div>
      <textarea class="mx-support-ta" id="mx-support-text" maxlength="3000" placeholder="Введи текст..."></textarea>
      <div class="mx-row-btns">
        <button class="mx-btn" type="button" onclick="this.closest('.modal').remove()">Отмена</button>
        <button class="mx-btn primary" type="button" id="mx-support-send" onclick="mxSupportSend(this)">Отправить</button>
      </div></div>`;
    $('app').appendChild(m);
    setTimeout(() => { const t = $('mx-support-text'); if (t) t.focus(); }, 60);
  };
  window.mxSupportSend = async function (btn) {
    const t = $('mx-support-text');
    const text = t ? t.value.trim() : '';
    if (text.length < 3) { toast('Введи текст...'); return; }
    btn.disabled = true;
    try {
      const r = await MchatAPI.sendSupport(text);
      btn.closest('.modal').remove();
      await refreshChats();
      toast('Сообщение отправлено');
      openChat(r.chatId);
    } catch (e) { toast(MchatAPI.errorText(e)); btn.disabled = false; }
  };

  /* ════════════════════════ 9. МАСКИ В ЗВОНКАХ: подключение к звонку ════════════════════════ */
  const _showScreen = window.mxCallShowScreen;
  window.mxCallShowScreen = function () { const r = _showScreen.apply(this, arguments); if (window.MxMasks) MxMasks.mountUi(); return r; };
  const _cleanup = window.mxCallCleanup;
  window.mxCallCleanup = function () { if (window.MxMasks) MxMasks.reset(); return _cleanup.apply(this, arguments); };
  const _flip = window.mxCallFlipCam;
  window.mxCallFlipCam = async function () {
    if (window.MxMasks && MxMasks.active) {          // с маской камеру переключаем в нашем конвейере
      await MxMasks.flip();
      const self = $('call-self'); if (self && mxCall) self.style.transform = mxCall.facing === 'user' ? 'scaleX(-1)' : 'none';
      return;
    }
    return _flip.apply(this, arguments);
  };

  /* ─── Панель звонка: «Динамик» и «Показать экран» ─── */
  let speakerOn = true, sharing = null;

  function applySpeaker() {
    document.querySelectorAll('#call-grid video').forEach((v) => { v.muted = !speakerOn; });
    const b = $('call-speaker');
    if (!b) return;
    b.classList.toggle('off', !speakerOn);
    b.querySelector('.on-ico').style.display = speakerOn ? '' : 'none';
    b.querySelector('.off-ico').style.display = speakerOn ? 'none' : '';
  }
  /** Динамик: звук собеседников включён/выключен (звук играет через плитки с видео). */
  window.mxCallToggleSpeaker = function () { speakerOn = !speakerOn; applySpeaker(); };
  const _sync = window.mxCallSync;
  window.mxCallSync = function () { const r = _sync.apply(this, arguments); applySpeaker(); return r; };

  async function stopShare(restoreCamera) {
    const s = sharing;
    if (!s) return;
    sharing = null;
    s.track.onended = null;
    try { s.track.stop(); } catch (e) {}
    const b = $('call-share'); if (b) b.classList.remove('mx-active');
    const call = typeof mxCall !== 'undefined' ? mxCall : null;
    if (restoreCamera && call && call.zg && call.localStream) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: call.facing || 'user' } });
        await call.zg.replaceTrack(call.localStream, cam.getVideoTracks()[0]);
        const self = $('call-self');
        if (self) { self.srcObject = null; self.srcObject = call.localStream; self.style.transform = (call.facing || 'user') === 'user' ? 'scaleX(-1)' : 'none'; }
      } catch (e) { toast('Не удалось вернуть камеру'); }
    }
  }
  /** Показ экрана собеседникам: захват экрана подменяет исходящее видео, по окончании возвращается камера. */
  window.mxCallToggleShare = async function () {
    const call = typeof mxCall !== 'undefined' ? mxCall : null;
    if (sharing) { await stopShare(true); return; }
    if (!call || !call.zg || !call.localStream) { toast('Сначала дождись соединения'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast('Показ экрана не поддерживается на этом устройстве'); return; }
    if (!call.camOn) { toast('Сначала включи камеру'); return; }
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = ds.getVideoTracks()[0];
      if (window.MxMasks && MxMasks.active) await MxMasks.select(null);   // маски и показ экрана вместе не работают
      await call.zg.replaceTrack(call.localStream, track);
      sharing = { track };
      track.onended = () => stopShare(true);                                 // нажали «Остановить показ» в браузере
      const b = $('call-share'); if (b) b.classList.add('mx-active');
      const self = $('call-self');
      if (self) { self.srcObject = null; self.srcObject = call.localStream; self.style.transform = 'none'; }
    } catch (e) {
      if (!e || e.name !== 'NotAllowedError') toast('Не удалось показать экран');
    }
  };
  const _cleanup2 = window.mxCallCleanup;
  window.mxCallCleanup = function () { stopShare(false); speakerOn = true; applySpeaker(); return _cleanup2.apply(this, arguments); };

  /* ════════════════════════ 10. Настройка «Enter отправляет» ════════════════════════ */
  function mountEnterSetting() {
    const anchor = $('animations-item');
    const row = anchor && anchor.closest('.sitem');
    if (!row || $('mx-enter-item')) return;
    const item = document.createElement('div');
    item.className = 'sitem'; item.id = 'mx-enter-item';
    item.onclick = () => { try { localStorage.setItem(ENTER_KEY, enterSends() ? '0' : '1'); } catch (e) {} renderEnterItem(); };
    row.parentNode.insertBefore(item, row.nextSibling);
    renderEnterItem();
  }
  function renderEnterItem() {
    const it = $('mx-enter-item'); if (!it) return;
    it.innerHTML = `<span>Enter отправляет сообщение</span><span style="color:var(--text2);font-size:13px">${enterSends() ? 'Вкл' : 'Выкл'}</span>`;
    it.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer';
  }

  /* ════════════════════════ запуск ════════════════════════ */
  /* PWA: Service Worker регистрируем всегда (офлайн-кэш и push), а не только при включении уведомлений */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
  }

  function boot() {
    if (window.I18N) I18N.install();                 // перевод тостов/ошибок + переключатель RU/EN
    mountHdButtons();
    mountEnterSetting();
    autosize();
    renderStories();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();