/* ═══════════════════════════════════════════════════════════════════════
   Mchat · серия 7
   1. Скорость и плавные анимации, рабочая настройка «Анимации»
   2. Камера: без HD и без «Фото», кружок/истории ≈ 15 МБ, переворот камеры без чёрного экрана (Android Chrome)
   3. Стикеры: тап по стикеру — коллекция (скачать/удалить), тап сбоку — меню сообщения
   4. Ссылки в сообщениях — кликабельные <a>
   5. Панель записи голосового как в Telegram; «1 раз» — только над кнопкой отправки и в предпросмотре фото/видео
   6. Звонок: интерфейс закрывается мгновенно и не «зависает»
   7. Приватный канал/группа: ссылка-приглашение сразу после создания
   9. Лимит 4000 символов с авто-разбиением; кружки не одноразовые; защита просмотра одноразовых медиа
   Подключается последним; ничего не ломает, если нужных функций нет.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__mx7) return; window.__mx7 = true;

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const toast = (m) => { try { (window.showToast || console.log)(m); } catch (e) { /* noop */ } };
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const appEl = () => $('app') || document.body;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errText = (e) => { try { return MchatAPI.errorText(e); } catch (er) { return 'Ошибка'; } };
  const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const gv = (f, d) => { try { return f(); } catch (e) { return d; } };       // безопасное чтение глобальных let-переменных старых скриптов
  const curChat = () => gv(() => currentChatId, null);
  const meta = () => gv(() => currentChatMeta, null);
  const msgsOf = (id) => gv(() => messages[id] || [], []);

  /* ═════════ 1. Анимации и скорость ═════════ */
  const AK = 'mx7_anim';
  let animOn = true; try { animOn = localStorage.getItem(AK) !== '0'; } catch (e) { /* noop */ }
  function applyAnim() {
    root.classList.toggle('mx-noanim', !animOn);
    root.classList.toggle('mx-force-anim', animOn);
    const b = $('mx-anim-toggle');
    if (b) { b.classList.toggle('on', animOn); b.setAttribute('aria-checked', animOn ? 'true' : 'false'); }
  }
  function bindAnimToggle() {
    const b = $('mx-anim-toggle'); if (!b || b._mx7) { applyAnim(); return; }
    b._mx7 = true; b.addEventListener('click', () => {
      animOn = !animOn; try { localStorage.setItem(AK, animOn ? '1' : '0'); } catch (e) { /* noop */ }
      applyAnim(); toast(animOn ? 'Анимации включены' : 'Анимации выключены');
    });
    applyAnim();
  }
  applyAnim();
  // Chrome округляет deviceMemory вниз до 0.25/0.5/1/2/4/8, поэтому телефон с 6 ГБ отдаёт «4» и раньше ошибочно считался слабым
  // (размытие стекла отключалось везде). Слабыми считаем только устройства с ≤ 2 ГБ, ≤ 4 ядрами или режимом экономии трафика.
  const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    || (navigator.connection && navigator.connection.saveData);
  if (weak) root.classList.add('mx-lite');
  document.addEventListener('visibilitychange', () => root.classList.toggle('mx7-hidden', document.hidden));

  // новые сообщения появляются мягко; картинки грузятся лениво
  let seen = new Set(), seenChat = null, nmBusy = false;
  function watchMessages() {
    const c = $('messages-container'); if (!c || c._mx7w) return !!c; c._mx7w = true;
    new MutationObserver(() => {
      if (nmBusy) return; nmBusy = true;
      requestAnimationFrame(() => {
        nmBusy = false;
        const key = curChat(), els = c.querySelectorAll('.msg[data-id]');
        if (key !== seenChat) { seenChat = key; seen = new Set(); els.forEach((el) => seen.add(el.dataset.id)); }
        else els.forEach((el) => { const id = el.dataset.id; if (seen.has(id)) return; seen.add(id); el.classList.add('mx7-new'); setTimeout(() => el.classList.remove('mx7-new'), 420); });
        if (seen.size > 3000) seen = new Set(Array.from(els).map((el) => el.dataset.id));
        c.querySelectorAll('img:not([loading])').forEach((im) => { im.loading = 'lazy'; im.decoding = 'async'; });
      });
    }).observe(c, { childList: true });
    return true;
  }

  /* ═════════ 2. Камера ═════════ */
  const camState = () => gv(() => mxCam, null);
  const camVideo = () => $('mx-cam-video');
  const camErr = (e) => {
    const n = e && e.name;
    if (n === 'SingleCamera') return 'Другой камеры на устройстве нет';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Нет доступа к камере. Разрешите её в настройках браузера';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Эта камера не найдена или не поддерживается браузером';
    if (n === 'NotReadableError') return 'Камера занята другим приложением';
    return 'Не удалось переключить камеру' + (n ? ' (' + n + ')' : '');
  };

  // ждём реального кадра: «поток открыт, но экран чёрный» — именно этот случай ловим
  function waitFrame(v, ms) {
    return new Promise((resolve) => {
      let done = false; const fin = (ok) => { if (!done) { done = true; resolve(ok); } };
      const t0 = Date.now();
      const poll = () => { if (done) return; if (v.readyState >= 2 && v.videoWidth > 0 && !v.paused) return fin(true); if (Date.now() - t0 > ms) return fin(false); setTimeout(poll, 60); };
      try { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => fin(v.videoWidth > 0)); } catch (e) { /* noop */ }
      poll();
    });
  }
  /** Перебор вариантов открытия камеры: точный deviceId → facingMode(exact) → facingMode(ideal) → любая. Каждый проверяется на живой кадр. */
  async function openVerified(o) {
    try { await navigator.mediaDevices.enumerateDevices(); } catch (e) { /* список нужен только для меток */ }
    const size = {};
    if (o.width) size.width = { ideal: o.width };
    if (o.height) size.height = { ideal: o.height };
    if (o.fps) size.frameRate = { ideal: o.fps };      // без жёсткого max: на части Android-камер он даёт OverconstrainedError
    // порядок: точный deviceId → facingMode «ideal» (мягко, с проверкой, что открылась нужная сторона) → facingMode «exact» → любая камера
    const tries = [];
    if (o.deviceId) tries.push({ c: { deviceId: { exact: o.deviceId } } });
    if (o.facing) { tries.push({ c: { facingMode: { ideal: o.facing } }, want: o.facing }); tries.push({ c: { facingMode: { exact: o.facing } } }); }
    tries.push({ c: {} });
    const cancelled = () => !!(o.cancelled && o.cancelled());
    const stopAll = (s) => { if (s) s.getTracks().forEach((x) => { try { x.stop(); } catch (er) { /* noop */ } }); };
    let lastErr = null;
    for (const t of tries) {
      let vs = null;
      try {
        if (cancelled()) { const c = new Error('cancelled'); c.name = 'Cancelled'; throw c; }
        vs = await navigator.mediaDevices.getUserMedia({ video: Object.assign({}, t.c, size), audio: false });
        if (cancelled()) { const c = new Error('cancelled'); c.name = 'Cancelled'; throw c; }
        const track = vs.getVideoTracks()[0];
        if (t.want) {   // «ideal» мог вернуть ту же камеру — проверяем сторону, иначе идём к «exact»
          const got = window.MxCamera && MxCamera.facingOf(track);
          if (got && got !== t.want) { const m = new Error('wrong_facing'); m.name = 'WrongFacing'; throw m; }
        }
        const vid = o.video;
        if (!vid) return vs;
        vid.srcObject = new MediaStream([track].concat(o.keepAudio || []));
        vid.muted = true; vid.playsInline = true;
        // play() у видео без кадров может висеть бесконечно — ждём не дольше 1.5 с, дальше решает проверка кадра
        try { await Promise.race([vid.play(), sleep(1500)]); } catch (e) { /* автозапуск */ }
        if (track.readyState === 'live' && (await waitFrame(vid, 3000))) return vs;
        throw new Error('no_frame');
      } catch (e) {
        lastErr = e;
        stopAll(vs);
        try { console.warn('[camera] вариант не подошёл:', JSON.stringify(t.c), e && e.name, e && e.message); } catch (er) { /* noop */ }
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'Cancelled')) throw e;
        await sleep(80);
      }
    }
    throw lastErr || new Error('camera_failed');
  }

  window.mx7OpenVerified = openVerified;   // используют и другие слои (запуск камеры кружков)

  window.mxCameraFlip = async function () {
    const cam = camState(); if (!cam || cam.switching || !cam.stream) return;
    cam.switching = true;
    const btn = $('mx-cam-flip'); if (btn) btn.disabled = true;
    const v = camVideo();
    const oldStream = cam.stream, oldTrack = oldStream.getVideoTracks()[0], audio = oldStream.getAudioTracks();
    const prev = { facing: cam.facing, deviceId: cam.deviceId };
    const prof = (window.MxPerf && MxPerf.profile) ? MxPerf.profile() : { capW: 1280, capH: 720, fps: 30 };
    try {
      let nx;
      try { nx = await MxCamera.next(oldTrack, cam.facing); }
      catch (e) { if (e && e.name === 'SingleCamera') { toast(camErr(e)); return; } nx = { facing: cam.facing === 'user' ? 'environment' : 'user', deviceId: null }; }
      // слабые Android-устройства не держат две камеры сразу — старую освобождаем до открытия новой
      try { oldTrack.stop(); } catch (e) { /* noop */ }
      if (v) v.srcObject = null;
      if (isMobile()) await sleep(170);
      let vs;
      try { vs = await openVerified({ facing: nx.facing, deviceId: nx.deviceId, width: prof.capW, height: prof.capH, fps: prof.fps, video: v, keepAudio: audio }); }
      catch (e) {
        // новая камера не открылась — возвращаем прежнюю, чтобы экран не остался чёрным
        vs = await openVerified({ facing: prev.facing, deviceId: prev.deviceId, width: prof.capW, height: prof.capH, fps: prof.fps, video: v, keepAudio: audio });
        toast(camErr(e));
      }
      const nt = vs.getVideoTracks()[0], st = (nt.getSettings && nt.getSettings()) || {};
      cam.stream = new MediaStream([nt].concat(audio));
      cam.facing = (window.MxCamera && MxCamera.facingOf(nt)) || st.facingMode || nx.facing;
      cam.deviceId = st.deviceId || nx.deviceId;
      if (v) { v.srcObject = cam.stream; v.classList.toggle('mirror', cam.facing === 'user'); v.play().catch(() => {}); }
      try { if (window.mxCamOnTrack) window.mxCamOnTrack(); } catch (er) { /* вспышка/подсветка подстроится под новую камеру */ }
    } catch (e) {
      console.warn('[camera] смена камеры:', e && e.name, e && e.message);
      toast(camErr(e));
      try { if (typeof mxCameraStartStream === 'function' && !cam.recording) await mxCameraStartStream(); } catch (er) { /* noop */ }
    } finally { cam.switching = false; if (btn) btn.disabled = false; }
  };
  // «Фото» в камере кружка убрано
  if (typeof window.mxCameraMode === 'function') { window.mxCameraMode = function (m) { if (m === 'photo') return; }; }

  // истории: видео в высоком качестве без выбора HD; переворот камеры без чёрного экрана
  window.mx7StoryVideo = function (facing) {
    const id = window.__mx7ScDev;
    const base = weak ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
    return Object.assign({}, id ? { deviceId: { exact: id } } : { facingMode: facing }, base);
  };
  window.scStartCamera = async function () {
    const g = (n) => $(n);
    try {
      gv(() => { if (scCameraStream) scCameraStream.getTracks().forEach((t) => t.stop()); });
      const cam = g('sc-camera'), fac = gv(() => scCameraFacing, 'user');
      let vs = null, withAudio = true;
      try { vs = await openVerified({ facing: fac, deviceId: window.__mx7ScDev, width: weak ? 1280 : 1920, height: weak ? 720 : 1080, fps: 30, video: cam }); }
      catch (e) { if (e && e.name === 'NotAllowedError') throw e; vs = await openVerified({ facing: fac, width: 1280, height: 720, fps: 30, video: cam }); }
      let au = null;
      try { au = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { withAudio = false; }
      const tracks = vs.getVideoTracks().concat(au ? au.getAudioTracks() : []);
      const stream = new MediaStream(tracks);
      gv(() => { scCameraStream = stream; });
      cam.srcObject = stream; cam.muted = true; cam.style.display = 'block';
      cam.style.transform = fac === 'user' ? 'scaleX(-1)' : 'none';
      try { await cam.play(); } catch (e) { /* noop */ }
      const st = vs.getVideoTracks()[0].getSettings ? vs.getVideoTracks()[0].getSettings() : {};
      if (st.deviceId) window.__mx7ScDev = st.deviceId;
      g('sc-preview').style.background = 'transparent'; g('sc-bg-btn').style.display = 'none';
      g('sc-cam-controls').style.display = 'flex'; g('sc-hint').style.display = 'none';
      if (!withAudio) toast('Нет доступа к микрофону — история запишется без звука');
    } catch (e) {
      g('sc-cam-controls').style.display = 'none';
      g('sc-preview').style.background = gv(() => scBgs[0], '#111');
      g('sc-bottom').style.display = 'block'; g('sc-hint').style.display = 'block';
    }
  };
  window.scFlipCamera = async function () {
    if (window.__mx7ScFlip) return; window.__mx7ScFlip = true;
    try {
      const old = gv(() => scCameraStream, null), tr = old && old.getVideoTracks()[0];
      const fac = gv(() => scCameraFacing, 'user');
      let nx; try { nx = await MxCamera.next(tr, fac); } catch (e) { toast(camErr(e)); return; }
      gv(() => { scCameraFacing = nx.facing; });
      window.__mx7ScDev = nx.deviceId || null;
      if (old) old.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* noop */ } });
      if (isMobile()) await sleep(170);
      await window.scStartCamera();
    } finally { window.__mx7ScFlip = false; }
  };

  /* ═════════ 3. Стикеры ═════════ */
  const stickerOf = (id) => msgsOf(curChat()).find((m) => m.id === id);
  const _openReactions = window.mxOpenReactions;
  if (typeof _openReactions === 'function') {
    window.mxOpenReactions = function (id, evt) {
      try {
        const t = evt && evt.target;
        if (t && t.closest && t.closest('.mx-stk-img') && !(window.mxSelActive && window.mxSelActive())) {
          const m = stickerOf(id);
          if (m && m.sticker && m.sticker.packId) { if (evt.stopPropagation) evt.stopPropagation(); window.mxOpenStickerPack(m.sticker.packId); return; }
        }
      } catch (e) { /* падаем на штатное меню */ }
      return _openReactions.apply(this, arguments);
    };
  }
  window.mxOpenStickerPack = async function (packId) {
    try { if (typeof mxCloseFloating === 'function') mxCloseFloating(); } catch (e) { /* noop */ }
    const old = $('mx6-pack'); if (old) old.remove();
    let pack; try { pack = (await MchatAPI.stickerPack(packId)).pack; } catch (e) { toast(errText(e)); return; }
    const modal = document.createElement('div'); modal.id = 'mx6-pack'; modal.className = 'modal active mx6-join'; modal.style.zIndex = '2500';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    const have = () => pack.owned || pack.saved;
    const draw = () => {
      modal.innerHTML = '<div class="mx6-join-box" style="align-items:stretch;max-height:84vh">'
        + '<div class="mx6-join-name" style="text-align:left">' + E(pack.title) + '</div>'
        + '<div class="mx6-join-sub" style="text-align:left">' + pack.count + ' стикеров · ' + E(pack.ownerName || '') + '</div>'
        + '<div class="mx7-pack-grid">' + pack.stickers.map((s) => '<div class="it"><img src="' + E(s.url) + '" alt="" draggable="false" loading="lazy"></div>').join('') + '</div>'
        + '<button type="button" class="mx6-btn pri mx7-pack-btn' + (have() ? ' danger' : '') + '" id="mx7-pk-act">' + (have() ? 'Удалить коллекцию' : 'Скачать коллекцию (' + pack.count + ')') + '</button>'
        + '<button type="button" class="mx6-btn" id="mx7-pk-x">Закрыть</button></div>';
      $('mx7-pk-x').onclick = () => modal.remove();
      $('mx7-pk-act').onclick = async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        try {
          if (pack.owned) { if (!confirm('Удалить коллекцию «' + pack.title + '» вместе со стикерами?')) { b.disabled = false; return; } await MchatAPI.deleteStickerPack(pack.id); toast('Коллекция удалена'); modal.remove(); return; }
          if (pack.saved) { await MchatAPI.unsaveStickerPack(pack.id); pack.saved = false; toast('Коллекция удалена'); }
          else { pack = (await MchatAPI.saveStickerPack(pack.id)).pack || pack; pack.saved = true; toast('Коллекция «' + pack.title + '» скачана'); }
        } catch (e) { toast(errText(e)); }
        draw();
      };
    };
    appEl().appendChild(modal); draw();
  };

  /* ═════════ 4. Ссылки ═════════ */
  const TLD = 'com|ru|org|net|io|app|me|kg|info|dev|co|su|ua|by|kz|uz|tj|xyz|online|site|tv|gg|ly|to';
  const URL_RE = new RegExp('(^|[\\s(])((?:https?:\\/\\/|www\\.)[^\\s<]+|[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:' + TLD + ')(?:\\/[^\\s<]*)?)', 'gi');
  function linkify(escaped) {
    return escaped.replace(URL_RE, (all, pre, raw) => {
      let url = raw, tail = '';
      const m = /(?:[.,;:!?)\]]|&quot;|&#39;|&gt;)+$/.exec(url);
      if (m) { tail = m[0]; url = url.slice(0, url.length - tail.length); }
      if (!url || /^(https?:\/\/)?$/i.test(url)) return all;
      const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
      return pre + '<a class="mx-link" href="' + href + '" target="_blank" rel="noopener noreferrer nofollow" onclick="event.stopPropagation()">' + url + '</a>' + tail;
    });
  }
  window.mxLinkify = linkify;
  const _bubble = window.bubbleBodyHtml;
  if (typeof _bubble === 'function') {
    window.bubbleBodyHtml = function () {
      const html = _bubble.apply(this, arguments);
      if (typeof html !== 'string' || html.indexOf('class="mx-txt') < 0 || html.indexOf('<a class="mx-link"') >= 0) return html;
      return html.replace(/(<div class="mx-txt[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/g, (a, o, txt, c) => o + linkify(txt) + c);
    };
  }

  /* ═════════ 5. Запись голосового + «1 раз» ═════════ */
  const CHEV = '<svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L3 7l5 5"/></svg>';
  function onceAllowed() { const m = meta(); return !!m && (m.type === 'DIRECT' || m.type === 'GROUP'); }
  function ensureRecDom() {
    const rec = $('mx-rec'), main = $('mx-rec-main'); if (!rec || !main) return;
    let col = $('mx7-sendcol');
    if (!col) { col = document.createElement('div'); col.id = 'mx7-sendcol'; main.parentNode.insertBefore(col, main); col.appendChild(main); }
    const once = $('mx-once-rec'); if (once && once.parentNode !== col) col.appendChild(once);
    if (!$('mx7-cancel')) { const c = document.createElement('div'); c.id = 'mx7-cancel'; c.innerHTML = CHEV + '<span>Отмена</span>'; rec.appendChild(c); }
    rec.classList.toggle('mx7-once-ok', onceAllowed());
  }
  const _vStart7 = window.mxVoiceStart;
  if (typeof _vStart7 === 'function') window.mxVoiceStart = async function () { const r = await _vStart7.apply(this, arguments); try { ensureRecDom(); } catch (e) { /* noop */ } return r; };

  let micDown = null;
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('#mx-mic-btn')) micDown = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('pointermove', (e) => {
    const lab = $('mx7-cancel'); if (!lab || !micDown || !$('mx-hold')) return;
    const dx = Math.min(0, e.clientX - micDown.x);
    lab.style.transform = 'translate(calc(-50% + ' + (dx * 0.55).toFixed(1) + 'px),-50%)';
    lab.style.opacity = String(1 - Math.min(1, -dx / 150) * 0.7);
  }, true);
  function onHold(ui) {
    ensureRecDom();
    const rec = $('mx-rec'); if (!ui.closest('#mx-camera')) {
      if (rec) rec.classList.add('mx7-holding');
      const main = $('mx-rec-main'), ar = appEl().getBoundingClientRect();
      if (main) { const r = main.getBoundingClientRect(); ui.style.right = Math.max(0, ar.right - r.right + (r.width - 44) / 2) + 'px'; ui.style.bottom = Math.max(70, ar.bottom - r.top + 12) + 'px'; }
    }
  }
  function offHold() {
    const rec = $('mx-rec'), lab = $('mx7-cancel');
    if (rec) rec.classList.remove('mx7-holding');
    if (lab) { lab.style.transform = ''; lab.style.opacity = ''; }
    micDown = null;
  }
  new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => { if (n.id === 'mx-hold') onHold(n); });
      m.removedNodes.forEach((n) => { if (n.id === 'mx-hold') offHold(); });
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* ═════════ 6. Звонок ═════════ */
  const callAlive = () => gv(() => !!mxCall || !!mxIncoming, false);
  function stopMedia(el) {
    try { const s = el.srcObject; if (s && s.getTracks) s.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* noop */ } }); el.pause && el.pause(); el.srcObject = null; } catch (e) { /* noop */ }
  }
  function closeCallUi(which) {
    const ids = which === 'incoming' ? ['call-incoming'] : ['call-screen', 'call-incoming'];
    ids.forEach((id) => { const el = $(id); if (el) { el.classList.remove('active', 'mx-swapped'); el.classList.add('mx7-closed'); } });
    document.querySelectorAll('#call-screen video,#call-screen audio,#call-incoming video').forEach(stopMedia);
    gv(() => {
      const c = mxCall; if (!c) return;
      if (c.timer) { clearInterval(c.timer); c.timer = null; }
      [c.localStream, c.screenStream, c.stream].forEach((s) => { try { if (s && s.getTracks) s.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ } });
    });
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null; if (!t) return;
    if (t.closest('#call-end')) closeCallUi('screen');                          // состояние скрытия — в самый первый момент нажатия
    else if (t.closest('#call-incoming [onclick*="mxCallDecline"]')) closeCallUi('incoming');
  }, true);
  ['mxCallEnd', 'mxCallDecline', 'mxCallCleanup'].forEach((n) => {
    const o = window[n]; if (typeof o !== 'function') return;
    window[n] = function () { try { closeCallUi(n === 'mxCallDecline' ? 'incoming' : 'screen'); } catch (e) { /* noop */ } return o.apply(this, arguments); };
  });
  function guardCall(el) {
    if (!el) return;
    new MutationObserver(() => {
      if (el.classList.contains('active')) {
        if (callAlive()) { if (el.classList.contains('mx7-closed')) el.classList.remove('mx7-closed'); }   // меняем class только при реальной необходимости: иначе наблюдатель сам себя запускает в бесконечном цикле
        else setTimeout(() => { if (el.classList.contains('active') && !callAlive()) { el.classList.remove('active'); el.classList.add('mx7-closed'); document.querySelectorAll('#call-screen video,#call-screen audio').forEach(stopMedia); } }, 700);
      }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  guardCall($('call-screen')); guardCall($('call-incoming'));

  /* ═════════ 7. Приватный канал/группа: ссылка-приглашение после создания ═════════ */
  function showInvite(chat) {
    if (!chat || !chat.inviteCode) return;
    const link = location.origin + '/join/' + chat.inviteCode;
    const m = document.createElement('div'); m.className = 'modal active mx6-join'; m.style.zIndex = '2600';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML = '<div class="mx6-join-box" style="align-items:stretch"><div class="mx6-join-name" style="text-align:left">Ссылка-приглашение</div>'
      + '<div class="mx6-join-note" style="text-align:left">Вступить можно только по заявке — вы получите уведомление и сможете принять или отклонить её.</div>'
      + '<div class="mx7-invite"><code>' + E(link) + '</code><button type="button" id="mx7-inv-copy">Копировать</button></div>'
      + '<button type="button" class="mx6-btn" id="mx7-inv-x">Готово</button></div>';
    appEl().appendChild(m);
    $('mx7-inv-x').onclick = () => m.remove();
    $('mx7-inv-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); } catch (e) { const t = document.createElement('textarea'); t.value = link; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (er) { /* noop */ } t.remove(); }
      toast('Ссылка скопирована');
    };
  }
  function hookCreate() {
    if (!window.MchatAPI || !MchatAPI.createGroup || MchatAPI.createGroup.__mx7) return !!(window.MchatAPI && MchatAPI.createGroup && MchatAPI.createGroup.__mx7);
    const o = MchatAPI.createGroup;
    const w = async function (b) { const r = await o.apply(this, arguments); try { if (b && b.isPrivate && r && r.chat) setTimeout(() => showInvite(r.chat), 450); } catch (e) { /* noop */ } return r; };
    w.__mx7 = true; MchatAPI.createGroup = w; return true;
  }

  /* ═════════ 9. Лимит 4000 символов: авто-разбиение ═════════ */
  const LIMIT = 4000;
  function splitText(t) {
    const out = [];
    while (t.length > LIMIT) {
      let cut = LIMIT, win = t.slice(0, LIMIT), i = Math.max(win.lastIndexOf('\n'), win.lastIndexOf(' '));
      if (i > LIMIT * 0.6) cut = i + 1;
      else { const c = t.charCodeAt(cut - 1); if (c >= 0xD800 && c <= 0xDBFF) cut--; }
      out.push(t.slice(0, cut).trim()); t = t.slice(cut);
    }
    if (t.trim()) out.push(t.trim());
    return out.filter(Boolean);
  }
  window.mxSplitText = splitText;
  const _send = window.sendMessage;
  if (typeof _send === 'function') {
    let sending = false;
    window.sendMessage = async function () {
      const inp = $('message-input');
      if (!inp || window._mxEditingId || sending) return _send.apply(this, arguments);
      const text = inp.value.trim();
      if (text.length <= LIMIT) return _send.apply(this, arguments);
      sending = true;
      try { for (const part of splitText(text)) { inp.value = part; await _send.call(this); } }
      finally { sending = false; }
    };
  }

  /* ═════════ 10. Защита одноразовых медиа ═════════ */
  const onceOpen = () => !!$('mx-once-viewer');
  function syncSecure() {
    const on = onceOpen();
    root.classList.toggle('mx7-secure', on);
    if (!on) root.classList.remove('mx7-blank');
    try { if (on !== syncSecure.last) { syncSecure.last = on; if (window.MchatNative && MchatNative.setSecure) MchatNative.setSecure(on || gv(() => !!(window.mxIsProtectedChat && window.mxIsProtectedChat()), false)); } } catch (e) { /* noop */ }
  }
  new MutationObserver(syncSecure).observe(document.body, { childList: true, subtree: true });
  const blank = () => { if (onceOpen()) root.classList.add('mx7-blank'); };
  const unblank = () => { if (!document.hidden && document.hasFocus()) root.classList.remove('mx7-blank'); };
  window.addEventListener('blur', blank); window.addEventListener('pagehide', blank);
  window.addEventListener('focus', () => setTimeout(unblank, 120));
  document.addEventListener('visibilitychange', () => { if (document.hidden) { blank(); if (onceOpen() && typeof window.mxCloseOnce === 'function') window.mxCloseOnce(); } else unblank(); });
  document.addEventListener('keydown', (e) => {
    if (!onceOpen()) return;
    if (e.key === 'PrintScreen' || e.key === 'Snapshot' || ((e.metaKey || e.ctrlKey) && e.shiftKey && /^[3-5sS]$/.test(e.key)) || ((e.ctrlKey || e.metaKey) && /^[pPsS]$/.test(e.key))) {
      e.preventDefault(); root.classList.add('mx7-blank'); try { navigator.clipboard && navigator.clipboard.writeText(''); } catch (er) { /* noop */ }
      setTimeout(unblank, 2000);
    }
  }, true);
  ['contextmenu', 'dragstart', 'copy'].forEach((t) => document.addEventListener(t, (e) => { if (onceOpen() && e.target.closest && e.target.closest('#mx-once-viewer')) e.preventDefault(); }, true));

  /* ═════════ запуск ═════════ */
  setInterval(() => { bindAnimToggle(); watchMessages(); hookCreate(); ensureRecDom(); }, 800);
  bindAnimToggle(); watchMessages(); hookCreate();
  if (document.readyState !== 'loading') ensureRecDom(); else document.addEventListener('DOMContentLoaded', ensureRecDom);
})();