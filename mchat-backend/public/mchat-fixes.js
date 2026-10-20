/* ============================================================
   Mchat: правки интерфейса и функций (подключается ПОСЛЕ остальных скриптов).
   1. Адаптивный вьюпорт (--app-h, safe-area)
   2. Камера: надёжное переключение в Chrome/Chromium и Safari (MxCamera)
   3. Видеозвонок: swap «свой кадр ↔ собеседник» + перетаскиваемый квадрат, сброс скролла (маски)
   4. Каналы: просмотр до подписки, длинная овальная кнопка «Подписаться» → «Вкл./Выкл. уведомления»
   5. Кружочки: определение мощности устройства (MxPerf) и переключение камеры ВО ВРЕМЯ записи
   6. Проверка ника «на лету» при входе
   7. Push/PWA: ответ на звонок из уведомления, подсказка для iOS
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (m) => { try { (window.showToast || window.toast || console.log)(m); } catch (e) { /* noop */ } };
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ═════════════ 1. Вьюпорт ═════════════ */
  function setViewport() {
    const vv = window.visualViewport;
    const h = Math.round(vv ? vv.height : window.innerHeight);
    document.documentElement.style.setProperty('--app-h', h + 'px');
    // iOS после закрытия клавиатуры может оставить страницу «сдвинутой» — возвращаем на место
    if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
  }
  setViewport();
  window.addEventListener('resize', setViewport, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(setViewport, 250), { passive: true });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', setViewport, { passive: true });
    visualViewport.addEventListener('scroll', () => { if (visualViewport.offsetTop) window.scrollTo(0, 0); }, { passive: true });
  }

  /* ═════════════ 2. Камера (MxCamera) ═════════════ */
  const BACK_RE = /back|rear|environment|world|задн|тыл|основн/i;
  const FRONT_RE = /front|user|face|selfie|фронт|перед|селфи/i;
  const WIDE_RE = /ultra|wide|tele|macro|depth|сверхшир|телефото/i;

  const MxCamera = {
    async cameras() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        return all.filter((d) => d.kind === 'videoinput' && d.deviceId);
      } catch (e) { return []; }
    },
    facingOf(track, label) {
      const st = (track && track.getSettings && track.getSettings()) || {};
      if (st.facingMode === 'user' || st.facingMode === 'environment') return st.facingMode;
      const l = label || (track && track.label) || '';
      if (BACK_RE.test(l)) return 'environment';
      if (FRONT_RE.test(l)) return 'user';
      return null;
    },
    /** Выбирает «следующую» камеру. Работает и на телефонах (перед/зад), и на ПК с несколькими веб-камерами. */
    async next(currentTrack, currentFacing, zegoCams) {
      let cams = (await this.cameras()).map((c) => ({ id: c.deviceId, label: c.label || '' }));
      if (zegoCams && zegoCams.length && cams.length < 2) cams = zegoCams.map((c) => ({ id: c.deviceID, label: c.deviceName || '' }));
      const curId = currentTrack && currentTrack.getSettings && currentTrack.getSettings().deviceId;
      const want = (currentFacing || this.facingOf(currentTrack)) === 'environment' ? 'user' : 'environment';
      if (cams.length < 2) {
        // одна камера (или браузер не отдаёт список): пробуем по facingMode — на телефоне это сработает
        if (isMobile()) return { facing: want, deviceId: null };
        const e = new Error('single_camera'); e.name = 'SingleCamera'; throw e;
      }
      const others = cams.filter((c) => c.id !== curId);
      let pick = others.find((c) => (want === 'environment' ? BACK_RE : FRONT_RE).test(c.label) && !WIDE_RE.test(c.label))
        || others.find((c) => (want === 'environment' ? BACK_RE : FRONT_RE).test(c.label));
      if (!pick) {
        const i = cams.findIndex((c) => c.id === curId);
        pick = cams[(i + 1) % cams.length];            // просто следующая по кругу
      }
      const facing = BACK_RE.test(pick.label) ? 'environment' : FRONT_RE.test(pick.label) ? 'user' : (isMobile() ? want : 'user');
      return { facing, deviceId: pick.id };
    },
    /** getUserMedia с каскадом запасных вариантов: deviceId → facingMode(exact) → facingMode(ideal) → любая камера. */
    async open(o) {
      const size = {};
      if (o.width) size.width = { ideal: o.width };
      if (o.height) size.height = { ideal: o.height };
      if (o.fps) size.frameRate = { ideal: o.fps, max: o.fps + 5 };
      const audio = o.audio ? { echoCancellation: true, noiseSuppression: true } : false;
      const tries = [];
      if (o.deviceId) tries.push({ deviceId: { exact: o.deviceId } });
      if (o.facing) { tries.push({ facingMode: { exact: o.facing } }); tries.push({ facingMode: { ideal: o.facing } }); }
      tries.push({});
      let lastErr;
      for (const t of tries) {
        try { return await navigator.mediaDevices.getUserMedia({ video: Object.assign({}, t, size), audio }); }
        catch (e) {
          lastErr = e;
          if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;   // дальше пробовать нет смысла
        }
      }
      throw lastErr;
    },
  };
  function isMobile() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); }
  window.MxCamera = MxCamera;

  const camErrText = (e) => {
    if (e && e.name === 'SingleCamera') return 'Другой камеры на устройстве нет';
    if (e && e.name === 'NotAllowedError') return 'Нет доступа к камере. Разрешите его в настройках браузера';
    return 'Не удалось переключить камеру' + (e && e.name ? ' (' + e.name + ')' : '');
  };

  /* ── Звонок: переключение камеры (замена «выдаёт не найдено» в Chromium) ── */
  const prevCallFlip = window.mxCallFlipCam;
  window.mxCallFlipCam = async function () {
    if (window.MxMasks && MxMasks.active) return prevCallFlip.apply(this, arguments);   // с маской камеру переключает её конвейер
    const call = window.mxCall || (typeof mxCall !== 'undefined' ? mxCall : null);
    if (!call || !call.zg || !call.localStream) return;
    if (!call.camOn) { toast('Сначала включи камеру'); return; }
    if (call.flipping) return;
    call.flipping = true;
    try {
      const track = call.localStream.getVideoTracks()[0];
      let zegoCams = [];
      try { const d = await call.zg.enumDevices(); zegoCams = d.cameras || []; } catch (e) { /* не страшно */ }
      const nx = await MxCamera.next(track, call.facing || MxCamera.facingOf(track), zegoCams);
      let deviceId = nx.deviceId;
      if (!deviceId) {                 // список камер недоступен — узнаём deviceId нужной стороны через пробный поток
        const probe = await MxCamera.open({ facing: nx.facing });
        deviceId = probe.getVideoTracks()[0].getSettings().deviceId;
        probe.getTracks().forEach((t) => t.stop());
      }
      await call.zg.useVideoDevice(call.localStream, deviceId);   // подмена камеры в идущей трансляции
      call.facing = nx.facing;
      const self = $('call-self');
      if (self) self.style.transform = nx.facing === 'user' ? 'scaleX(-1)' : 'none';   // зеркалим только фронтальную
      if (typeof mxCallSync === 'function') mxCallSync(call);
    } catch (e) { toast(camErrText(e)); }
    finally { call.flipping = false; }
  };

  /* ── Маски: тот же надёжный выбор камеры (masks.js) ── */
  if (window.MxMasks) {
    const M = window.MxMasks;
    const origFlip = M.flip && M.flip.bind(M);
    if (origFlip) {
      M.flip = async function () {
        if (!M.active) return false;
        // masks.js внутри использует facingMode; на ПК с Chrome «environment» нет → подменяем getUserMedia на каскад
        const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (c) => {
          try { return await gum(c); }
          catch (e) {
            if (c && c.video && c.video.facingMode && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
              const v = Object.assign({}, c.video); delete v.facingMode;
              return gum(Object.assign({}, c, { video: v }));
            }
            throw e;
          }
        };
        try { return await origFlip(); } finally { navigator.mediaDevices.getUserMedia = gum; }
      };
    }
  }

  /* ═════════════ 3. Видеозвонок: swap + drag ═════════════ */
  const callScreen = () => $('call-screen');
  const state = { swapped: false, selfPos: null, pipPos: null };

  let _sat = null;
  function safeTop() {      // реальный отступ под «чёлку»/статус-бар в пикселях
    if (_sat !== null) return _sat;
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
    document.body.appendChild(d); _sat = d.getBoundingClientRect().height || parseFloat(getComputedStyle(d).paddingTop) || 0; d.remove();
    return _sat;
  }
  function bounds() {
    const sc = callScreen().getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    const top = parseFloat(cs.getPropertyValue('--sat')) || 0;
    return { sc, minTop: 8 + (parseFloat(getComputedStyle(callScreen()).paddingTop) || 0) + top, pad: 8 };
  }
  function clampPos(el, x, y) {
    const { sc, pad } = bounds();
    const w = el.offsetWidth, h = el.offsetHeight;
    const sat = safeTop(), bottomReserve = 0;
    return {
      x: Math.min(Math.max(pad, x), Math.max(pad, sc.width - w - pad)),
      y: Math.min(Math.max(pad + sat, y), Math.max(pad, sc.height - h - pad - bottomReserve)),
    };
  }
  function place(el, x, y) {
    const p = clampPos(el, x, y);
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    return p;
  }

  /** Универсальное перетаскивание: короткое касание → onTap, движение >6px → drag. Квадрат свободно ездит по всему экрану. */
  function makeDraggable(el, getKey, onTap) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, id = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      const r = el.getBoundingClientRect(), s = callScreen().getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left - s.left; oy = r.top - s.top; moved = false; id = e.pointerId;
      try { el.setPointerCapture(id); } catch (err) { /* noop */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (id !== e.pointerId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      if (!moved) { moved = true; el.classList.add('mx-dragging'); }
      if (!el.classList.contains('mx-fullscreen')) {
        const p = place(el, ox + dx, oy + dy);
        state[getKey()] = p;
      }
      e.preventDefault();
    });
    const end = (e) => {
      if (id !== e.pointerId) return;
      try { el.releasePointerCapture(id); } catch (err) { /* noop */ }
      id = null; el.classList.remove('mx-dragging');
      if (!moved && onTap) onTap(e);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { id = null; el.classList.remove('mx-dragging'); });
  }

  function pipSize() { return Math.round(Math.min(170, Math.max(96, callScreen().getBoundingClientRect().width * 0.28))); }

  function resetGrid() { const g = $('call-grid'); g.style.left = g.style.top = g.style.right = g.style.bottom = ''; g.style.inset = '0'; }
  function resetSelf() { const s = $('call-self'), o = state.selfOrig || { right: '14px', top: '' }; s.style.left = ''; s.style.bottom = ''; s.style.right = o.right; s.style.top = o.top; }
  function setSwap(on) {
    const scr = callScreen(), self = $('call-self'), grid = $('call-grid');
    if (!scr || !self || !grid) return;
    state.swapped = on;
    scr.classList.toggle('mx-swapped', on);
    grid.classList.toggle('mx-pip', on);
    self.classList.toggle('mx-fullscreen', on);
    if (on) {
      const s = pipSize();
      scr.style.setProperty('--pip', s + 'px');
      // свой кадр временно «забываем» перетащенную позицию, чтобы не мешала полноэкранному режиму
      resetSelf();
      const w = scr.getBoundingClientRect().width;
      const start = state.pipPos || { x: w - s - 14, y: Math.max(112, safeTop() + 92) };
      requestAnimationFrame(() => { state.pipPos = place(grid, start.x, start.y); });
    } else {
      resetGrid();
      if (state.selfPos) requestAnimationFrame(() => place(self, state.selfPos.x, state.selfPos.y));
      else resetSelf();
    }
  }
  function toggleSwap() {
    const self = $('call-self');
    if (!state.swapped && (!self || self.style.display === 'none' || !self.srcObject)) { toast('Включи камеру, чтобы развернуть своё видео'); return; }
    setSwap(!state.swapped);
  }

  function initCallUi() {
    const scr = callScreen(), self = $('call-self'), grid = $('call-grid');
    if (!scr || !self || !grid || scr.dataset.mxInit) return;
    scr.dataset.mxInit = '1';
    state.selfOrig = { right: self.style.right, top: self.style.top };   // исходное положение «своего» окошка из разметки
    makeDraggable(self, () => 'selfPos', toggleSwap);       // тап по своему видео → оно на весь экран / обратно
    makeDraggable(grid, () => 'pipPos', () => { if (state.swapped) setSwap(false); });
    // Групповые звонки: ник в углу плитки
    new MutationObserver(() => grid.classList.toggle('mx-multi', grid.children.length > 1)).observe(grid, { childList: true });
    // Звонок закончился — всё возвращаем к исходному виду
    new MutationObserver(() => {
      if (!scr.classList.contains('active')) {
        state.swapped = false; state.selfPos = null; state.pipPos = null;
        scr.classList.remove('mx-swapped'); grid.classList.remove('mx-pip'); self.classList.remove('mx-fullscreen');
        resetGrid(); resetSelf();
        scr.scrollTop = 0;
      }
    }).observe(scr, { attributes: true, attributeFilter: ['class'] });
    // Прокрутка внутри экрана звонка запрещена: раньше при скролле «выезжала» панель масок
    const lock = (e) => { if (!e.target.closest || !e.target.closest('.mx-mask-row')) e.preventDefault(); };
    scr.addEventListener('wheel', lock, { passive: false });
    scr.addEventListener('touchmove', lock, { passive: false });
    scr.addEventListener('scroll', () => { scr.scrollTop = 0; scr.scrollLeft = 0; });
    window.addEventListener('resize', () => {
      if (state.pipPos && state.swapped) state.pipPos = place(grid, state.pipPos.x, state.pipPos.y);
      if (state.selfPos && !state.swapped) state.selfPos = place(self, state.selfPos.x, state.selfPos.y);
    });
  }
  const _showScreen = window.mxCallShowScreen;
  window.mxCallShowScreen = function () { initCallUi(); return _showScreen.apply(this, arguments); };
  document.addEventListener('DOMContentLoaded', initCallUi);
  initCallUi();

  /* ═════════════ 5. Кружочки: MxPerf + переключение камеры при записи ═════════════ */
  const PERF_KEY = 'mx_perf_v2';
  const MxPerf = {
    _r: null,
    /** Быстрый тест (≈150 мс): рисуем кадры на canvas и считаем, сколько успеваем. Результат кешируется на 7 дней. */
    bench() {
      try {
        const c = document.createElement('canvas'); c.width = 480; c.height = 480;
        const ctx = c.getContext('2d');
        const t0 = performance.now(); let n = 0;
        while (performance.now() - t0 < 120) {
          ctx.fillStyle = 'rgb(' + (n * 7 % 255) + ',90,160)'; ctx.fillRect(0, 0, 480, 480);
          ctx.drawImage(c, 8, 8, 464, 464, 0, 0, 480, 480);
          ctx.getImageData(0, 0, 32, 32);
          n++;
        }
        return n / ((performance.now() - t0) / 1000);   // «кадров в секунду» на синтетической нагрузке
      } catch (e) { return 0; }
    },
    detect(force) {
      if (this._r && !force) return this._r;
      try {
        const cached = JSON.parse(localStorage.getItem(PERF_KEY) || 'null');
        if (!force && cached && Date.now() - cached.at < 7 * 864e5) return (this._r = cached);
      } catch (e) { /* noop */ }
      const cores = navigator.hardwareConcurrency || 4;
      const mem = navigator.deviceMemory || (isIOS ? (cores >= 6 ? 4 : 3) : 4);
      const conn = navigator.connection || {};
      const fps = this.bench();
      let score = 0;
      score += Math.min(cores, 12) * 4;          // до 48
      score += Math.min(mem, 8) * 5;             // до 40
      score += Math.min(fps, 400) / 10;          // до 40
      if (conn.saveData) score -= 25;
      if (/2g|3g/.test(conn.effectiveType || '')) score -= 10;
      if (!window.MediaRecorder) score -= 40;
      const tier = score >= 75 ? 'high' : score >= 45 ? 'mid' : 'low';
      const r = { tier, score: Math.round(score), cores, mem, fps: Math.round(fps), at: Date.now() };
      try { localStorage.setItem(PERF_KEY, JSON.stringify(r)); } catch (e) { /* noop */ }
      return (this._r = r);
    },
    downgrade() {   // если запись «тормозила», в следующий раз берём уровень ниже
      const r = this.detect(); const next = r.tier === 'high' ? 'mid' : 'low';
      if (next === r.tier) return;
      r.tier = next; r.at = Date.now(); this._r = r;
      try { localStorage.setItem(PERF_KEY, JSON.stringify(r)); } catch (e) { /* noop */ }
    },
    /** Параметры записи под устройство и режим качества (SD ≤200 КБ / HD ≤2 МБ, как и раньше). */
    profile() {
      const hd = typeof mxHdPref === 'function' && mxHdPref();
      const t = this.detect().tier;
      if (!hd) return { tier: t, hd, capW: 640, capH: 480, side: 360, fps: t === 'low' ? 20 : 25, videoBps: t === 'low' ? 180000 : 250000, audioBps: 16000 };
      if (t === 'high') return { tier: t, hd, capW: 1280, capH: 720, side: 720, fps: 30, videoBps: 2500000, audioBps: 64000 };
      if (t === 'mid') return { tier: t, hd, capW: 960, capH: 540, side: 540, fps: 30, videoBps: 1600000, audioBps: 64000 };
      return { tier: t, hd, capW: 640, capH: 480, side: 420, fps: 24, videoBps: 900000, audioBps: 48000 };
    },
  };
  window.MxPerf = MxPerf;
  setTimeout(() => { try { MxPerf.detect(); } catch (e) { /* noop */ } }, 1500);   // считаем заранее, чтобы запись стартовала без задержки

  const camVideo = () => $('mx-cam-video');
  const camState = () => (typeof mxCam !== 'undefined' ? mxCam : null);

  window.mxCameraStartStream = async function () {
    const cam = camState(); if (!cam) return;
    const prof = MxPerf.profile();
    try {
      const stream = await MxCamera.open({ facing: cam.facing, deviceId: cam.deviceId, width: prof.capW, height: prof.capH, fps: prof.fps, audio: cam.mode === 'circle' });
      cam.stream = stream;
      const t = stream.getVideoTracks()[0];
      cam.facing = MxCamera.facingOf(t) || cam.facing;
      cam.deviceId = t && t.getSettings && t.getSettings().deviceId;
      const v = camVideo(); v.srcObject = stream; v.classList.toggle('mirror', cam.facing === 'user');
      v.play().catch(() => {});
    } catch (e) { toast(e && e.name === 'NotAllowedError' ? 'Нет доступа к камере' : 'Камера не найдена'); if (typeof mxCameraClose === 'function') mxCameraClose(); }
  };

  /** Переключение фронтальной/основной камеры. Работает и ВО ВРЕМЯ записи: запись идёт с canvas и не прерывается. */
  window.mxCameraFlip = async function () {
    const cam = camState(); if (!cam || cam.switching || !cam.stream) return;
    cam.switching = true;
    const btn = $('mx-cam-flip'); if (btn) btn.disabled = true;
    try {
      const prof = MxPerf.profile();
      const oldV = cam.stream.getVideoTracks()[0];
      const nx = await MxCamera.next(oldV, cam.facing);
      const vs = await MxCamera.open({ facing: nx.facing, deviceId: nx.deviceId, width: prof.capW, height: prof.capH, fps: prof.fps, audio: false });
      const newV = vs.getVideoTracks()[0];
      const ns = new MediaStream([newV].concat(cam.stream.getAudioTracks()));   // микрофон остаётся тот же — звук не рвётся
      const old = cam.stream;
      cam.stream = ns;
      cam.facing = MxCamera.facingOf(newV) || nx.facing;
      cam.deviceId = newV.getSettings && newV.getSettings().deviceId;
      const v = camVideo(); v.srcObject = ns; v.classList.toggle('mirror', cam.facing === 'user');
      v.play().catch(() => {});
      old.getVideoTracks().forEach((t) => t.stop());
    } catch (e) { toast(camErrText(e)); }
    finally { cam.switching = false; if (btn) btn.disabled = false; }
  };

  /** Запись через canvas: источник кадров (камеру) можно менять на лету, а файл остаётся цельным. */
  function createPipeline(prof) {
    const video = camVideo();
    const S = prof.side;
    const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d', { alpha: false });
    let raf = 0, stopped = false, last = 0, slow = 0, frames = 0;
    const step = 1000 / prof.fps;
    const draw = (ts) => {
      if (stopped) return;
      raf = requestAnimationFrame(draw);
      if (ts - last < step - 2) return;
      const dt = ts - last; last = ts; frames++;
      if (frames > 15 && dt > step * 1.8) slow++;          // кадры отрисовываются заметно дольше нормы → устройство не тянет
      if (video.readyState < 2 || !video.videoWidth) return;   // идёт переключение камеры — оставляем предыдущий кадр
      const vw = video.videoWidth, vh = video.videoHeight, m = Math.min(vw, vh);
      const sx = (vw - m) / 2, sy = (vh - m) / 2;
      const c = camState();
      ctx.save();
      if (c && c.facing === 'user') { ctx.translate(S, 0); ctx.scale(-1, 1); }   // как в превью: фронталка зеркально
      ctx.drawImage(video, sx, sy, m, m, 0, 0, S, S);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    const out = canvas.captureStream(prof.fps);
    const c0 = camState();
    if (c0 && c0.stream) c0.stream.getAudioTracks().forEach((t) => out.addTrack(t));
    return {
      stream: out,
      stop() {
        stopped = true; cancelAnimationFrame(raf);
        if (frames > 60 && slow / frames > 0.25) MxPerf.downgrade();   // запомним: на этом устройстве нужен уровень ниже
      },
    };
  }

  window.mxCameraStartRecording = function () {
    const cam = camState(); if (!cam || !cam.stream) return;
    if (!window.MediaRecorder) { toast('Запись видео не поддерживается'); return; }
    const prof = MxPerf.profile();
    const mime = (typeof mxPickMime === 'function' ? mxPickMime : () => '')(['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']);
    let pipe, recorder;
    try {
      pipe = createPipeline(prof);
      recorder = new MediaRecorder(pipe.stream, Object.assign(mime ? { mimeType: mime } : {}, { videoBitsPerSecond: prof.videoBps, audioBitsPerSecond: prof.audioBps }));
    } catch (e) { if (pipe) pipe.stop(); toast('Запись видео не поддерживается'); return; }
    cam.mirror = pipe;                      // штатный mxCameraStopRecording/mxCameraClose вызывают cam.mirror.stop()
    cam.recorder = recorder; cam.chunks = []; cam.recording = true; cam.elapsed = 0;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) cam.chunks.push(e.data); };
    recorder.start(1000);
    $('mx-camera').classList.add('recording');
    cam.timer = setInterval(() => {
      cam.elapsed++;
      $('mx-cam-timer').textContent = (typeof fmtDur === 'function' ? fmtDur(cam.elapsed) : cam.elapsed);
      if (cam.elapsed >= 60) mxCameraStopRecording();   // потолок кружка — 60 секунд
    }, 1000);
  };

  /* ═════════════ 4. Каналы ═════════════ */
  const origLoadHistory = window.loadChatHistory;
  window.loadChatHistory = async function (id) {
    const ch = chats.find((c) => c.id === id);
    if (ch && ch.preview) {      // канал ещё без подписки: посты читаем через /preview
      try {
        const r = await MchatAPI.channelPreview(id);
        messages[id] = r.messages.map(msgFromServer);
        if (currentChatId === id) renderMessages(id);
      } catch (e) { toast(MchatAPI.errorText(e)); }
      return;
    }
    return origLoadHistory.apply(this, arguments);
  };
  const origMarkRead = window.markCurrentChatRead;
  window.markCurrentChatRead = function () {
    const ch = chats.find((c) => c.id === currentChatId);
    if (ch && ch.preview) return;
    return origMarkRead.apply(this, arguments);
  };

  /** Открыть канал из поиска: подписанный — обычный чат, неподписанный — экран канала с кнопкой «Подписаться». */
  window.mxOpenChannelPreview = async function (id) {
    if (chats.some((c) => c.id === id && !c.preview)) return openChat(id);
    try {
      const r = await MchatAPI.channelPreview(id);
      const c = r.channel;
      if (c.joined) { await refreshChats(); return openChat(id); }
      const ch = chatFromServer({ id: c.id, type: 'CHANNEL', name: c.name, description: c.description, avatar: c.avatar, memberCount: c.memberCount, isPublic: true, muted: false, canPost: false, canModerate: false, role: null });
      ch.preview = true; ch.fresh = true;     // fresh — чтобы refreshChats() не выкинул его из списка, пока экран открыт; в списке чатов он скрыт
      chats = chats.filter((x) => x.id !== id).concat(ch);
      await openChat(id);
    } catch (e) { toast(MchatAPI.errorText(e)); }
  };

  /** Поиск каналов в строке поиска раздела «Чаты»: ищет ТОЛЬКО каналы по названию, независимо от поиска по своим чатам. */
  let chanSearchState = '';   // '' | 'loading' | 'empty' | 'error'
  window.mxSearchGlobalChannels = function (q) {
    clearTimeout(mxGlobalTimer);
    const term = (q || '').trim().replace(/^[@#]+/, '');
    if (!term) { mxGlobalResults = []; chanSearchState = ''; mxRefreshGlobalChannels(); return; }
    mxGlobalTimer = setTimeout(async () => {
      const seq = ++mxGlobalSeq;
      try {
        const r = await MchatAPI.searchChannels(term);
        if (seq !== mxGlobalSeq) return;
        mxGlobalResults = r.channels || [];
        chanSearchState = mxGlobalResults.length ? '' : 'empty';
      } catch (e) {
        if (seq !== mxGlobalSeq) return;
        mxGlobalResults = []; chanSearchState = 'error';
        console.warn('channel search failed', e);
      }
      mxRefreshGlobalChannels();
    }, 250);
  };

  /** Результаты поиска каналов: нажатие открывает канал (подписка — кнопкой внизу экрана канала). */
  window.mxRefreshGlobalChannels = function () {
    const list = $('chats-list'); if (!list) return;
    const box = mxGlobalBox();
    const head = '<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;padding:14px 16px 6px">Каналы</div>';
    const note = (t) => `<div style="padding:6px 16px 14px;font-size:13px;color:var(--text2)">${t}</div>`;
    if (!mxGlobalResults.length) {
      box.innerHTML = chanSearchState === 'empty' ? head + note('Каналов с таким названием не найдено')
        : chanSearchState === 'error' ? head + note('Не удалось выполнить поиск каналов. Проверьте соединение') : '';
      return;
    }
    // «Не найдено» относится к личным чатам и группам — когда каналы найдены, оно только путает
    const first = list.firstElementChild;
    if (first && first !== box && !first.classList.contains('chat-item')) first.remove();
    box.innerHTML = head + mxGlobalResults.map((c) => {
      const joined = c.joined || chats.some((x) => x.id === c.id && !x.preview);
      const av = c.avatar ? `<img src="${esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover">` : esc((c.name || '?').charAt(0).toUpperCase());
      return `<div class="chat-item" onclick="mxOpenChannelPreview('${esc(c.id)}')">
        <div class="chat-avatar" style="overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700">${av}</div>
        <div class="chat-info"><div class="chat-name">${esc(c.name)}</div>
        <div class="chat-last">${mxPlural(c.memberCount, ['подписчик', 'подписчика', 'подписчиков'])}${c.description ? ' · ' + esc(c.description.slice(0, 50)) : ''}</div></div>
        <div class="chat-time">${joined ? '✓' : ''}</div></div>`;
    }).join('');
  };

  /** Нижняя панель канала: длинная овальная «Подписаться» → матовая «Выкл./Вкл. уведомления». */
  window.mxAfterOpenChat = function (ch) {
    let bar = $('mx-chan-bar');
    if (!bar) {
      const row = $('mx-input-row'); if (!row) return;
      bar = document.createElement('div'); bar.id = 'mx-chan-bar'; bar.className = 'mx-chan-bar';
      row.parentNode.insertBefore(bar, row);
    }
    const staff = ch && (ch.role === 'OWNER' || ch.role === 'ADMIN');
    const show = !!ch && ch.type === 'CHANNEL' && !staff;
    bar.style.display = show ? 'flex' : 'none';
    const ro = $('mx-readonly'); if (ro && show) ro.style.display = 'none';   // вместо серой подсказки — кнопка
    if (!show) return;
    bar.dataset.chatId = ch.id;
    renderChannelBar(ch);
  };
  function renderChannelBar(ch) {
    const bar = $('mx-chan-bar'); if (!bar) return;
    const subscribed = !ch.preview;
    const label = !subscribed ? 'Подписаться' : (ch.muted ? 'Вкл. уведомления' : 'Выкл. уведомления');
    bar.innerHTML = `<button type="button" class="mx-sub-pill${subscribed ? ' mx-subscribed' : ''}" id="mx-sub-pill" onclick="mxChannelPill('${esc(ch.id)}')">${label}</button>`;
  }
  window.mxChannelPill = async function (id) {
    const idx = chats.findIndex((c) => c.id === id); if (idx < 0) return;
    const ch = chats[idx];
    const btn = $('mx-sub-pill'); if (btn) btn.disabled = true;
    try {
      if (ch.preview) {                                   // «Подписаться»
        const r = await MchatAPI.joinChannel(id);
        const real = chatFromServer(r.chat);
        chats[idx] = real;
        renderChats(($('chat-search') && $('chat-search').value || '').toLowerCase());
        if (currentChatId === id) { mxApplyChatInputState(real); renderChannelBar(real); }
        toast('Вы подписались на канал');
        return;
      }
      const next = !ch.muted;                              // «Вкл./Выкл. уведомления»
      await MchatAPI.muteChat(id, next);
      ch.muted = next;
      renderChannelBar(ch);
      toast(next ? 'Уведомления выключены' : 'Уведомления включены');
    } catch (e) { toast(MchatAPI.errorText(e)); }
    finally { const b = $('mx-sub-pill'); if (b) b.disabled = false; }
  };

  /* ═════════════ 6. Проверка ника «на лету» ═════════════ */
  function initNickCheck() {
    const inp = $('login-username'); if (!inp || inp.dataset.mxNick) return;
    inp.dataset.mxNick = '1';
    const hint = document.createElement('div'); hint.className = 'mx-nick-hint';
    inp.insertAdjacentElement('afterend', hint);
    let t = null, seq = 0;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      const v = inp.value.trim().replace(/^@/, '');
      hint.className = 'mx-nick-hint'; hint.textContent = '';
      if (v.length < 3) return;
      t = setTimeout(async () => {
        const my = ++seq;
        try {
          const r = await MchatAPI.checkUsername(v);
          if (my !== seq) return;
          if (r.ok) { hint.className = 'mx-nick-hint good'; hint.textContent = 'Ник свободен. Его нельзя будет изменить позже'; }
          else { hint.className = 'mx-nick-hint bad'; hint.textContent = MchatAPI.errorText(r.reason); }
        } catch (e) { /* подсказка необязательна */ }
      }, 350);
    });
  }
  document.addEventListener('DOMContentLoaded', initNickCheck);
  initNickCheck();

  /* ═════════════ 7. Push / PWA ═════════════ */
  /** «Ответить» на звонок из уведомления. Приложение могло быть закрыто — сокет ещё не успел принести call:incoming. */
  window.mxAnswerCallFromPush = async function (p) {
    if (!p || !p.callId) return;
    if (typeof mxCall !== 'undefined' && mxCall && mxCall.id === p.callId) return;         // уже в этом звонке
    if (typeof mxIncoming !== 'undefined' && mxIncoming && mxIncoming.callId === p.callId) return mxCallAccept();
    mxIncoming = { callId: p.callId, chatId: p.chatId, video: !!p.video, isGroup: false, title: '', from: { name: p.title || 'Звонок', username: '' } };
    try { await mxCallAccept(); }
    catch (e) { toast('Звонок уже завершён'); }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'answer-call') window.mxAnswerCallFromPush(d);
      else if (d.type === 'open-chat' && d.chatId && typeof openChatById === 'function') openChatById(d.chatId);
      else if (d.type === 'call-ended' && typeof mxIncoming !== 'undefined' && mxIncoming && mxIncoming.callId === d.callId && typeof mxHideIncoming === 'function') mxHideIncoming();
    });
    // при каждом открытии приложения убеждаемся, что подписка на push жива (браузер мог её сбросить)
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        if (!('PushManager' in window) || Notification.permission !== 'granted') return;
        const sub = await reg.pushManager.getSubscription();
        if (!sub && window.MchatAPI && MchatAPI.enablePush) await MchatAPI.enablePush();
      } catch (e) { /* noop */ }
    }).catch(() => {});
  }

  // iOS: web push работает только в приложении, добавленном на экран «Домой» (iOS 16.4+)
  function iosHint() {
    try {
      const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
      if (!isIOS || standalone || localStorage.getItem('mx_ios_hint')) return;
      const d = document.createElement('div'); d.id = 'mx-ios-install';
      d.innerHTML = '<span>Чтобы получать звонки и сообщения в фоне, нажмите <b>«Поделиться» → «На экран Домой»</b> и откройте Mchat с иконки.</span><button aria-label="Закрыть">✕</button>';
      d.querySelector('button').onclick = () => { d.remove(); try { localStorage.setItem('mx_ios_hint', '1'); } catch (e) { /* noop */ } };
      document.body.appendChild(d);
    } catch (e) { /* noop */ }
  }
  window.addEventListener('load', () => setTimeout(iosHint, 4000));
})();

/* ============================================================
   Титул «Генерал Mchat»: градиент звезды, праздничный экран, настройки, раздел админа
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (m) => { try { window.showToast(m); } catch (e) { /* noop */ } };
  const STAR = 'M12 1.8l2.9 6.5 7.1.7-5.3 4.8 1.5 7-6.2-3.6-6.2 3.6 1.5-7L2 9l7.1-.7z';

  // общий градиент пурпурной звезды (используется всеми значками через url(#gsGrad))
  function injectDefs() {
    if ($('gs-defs')) return;
    const d = document.createElement('div');
    d.id = 'gs-defs'; d.setAttribute('aria-hidden', 'true'); d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = '<svg width="0" height="0"><defs><linearGradient id="gsGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0abfc"/><stop offset=".45" stop-color="#c026d3"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs></svg>';
    document.body.appendChild(d);
  }
  injectDefs();
  document.addEventListener('DOMContentLoaded', injectDefs);

  /* ── Праздничный экран: конфетти + салюты + письмо ── */
  let celebrating = false;
  window.mxShowGeneralCelebration = function () {
    if (celebrating || $('mx-general-celebration')) return;
    celebrating = true;
    const host = $('app') || document.querySelector('.phone') || document.body;
    const el = document.createElement('div');
    el.id = 'mx-general-celebration';
    el.innerHTML = `<canvas></canvas>
      <div class="gc-card" role="dialog" aria-modal="true">
        <span class="gc-star"><svg viewBox="0 0 24 24"><path d="${STAR}" fill="url(#gsGrad)"/></svg></span>
        <div class="gc-title">🌌 ПОЗДРАВЛЯЕМ! ТЕБЕ ПРИСВОЕН ТИТУЛ «ГЕНЕРАЛ Mchat»!</div>
        <p class="gc-p">Твои усилия, активность и вклад в развитие сообщества не остались незамеченными.</p>
        <p class="gc-p">За верность, инициативу и службу Mchat тебе присвоен особый титул — Генерал Mchat.</p>
        <p class="gc-p">Этот титул — знак признания твоих заслуг и доверия со стороны создателя Mchat.</p>
        <p class="gc-p">Носи его с честью. Твоё имя теперь часть истории Mchat. 🫡</p>
        <p class="gc-p">Спасибо, что помогаешь Mchat развиваться! 💜</p>
        <button class="gc-btn" type="button">Принять с честью</button>
      </div>`;
    host.appendChild(el);
    const stop = startFx(el.querySelector('canvas'));
    el.querySelector('.gc-btn').onclick = async () => {
      stop(); el.remove(); celebrating = false;
      if (typeof currentUser !== 'undefined' && currentUser) currentUser.generalPending = false;
      try { await MchatAPI.generalSeen(); } catch (e) { /* покажем ещё раз при следующем входе */ }
    };
  };

  /** Конфетти и салюты на canvas. Пока открыт экран — частицы рождаются и падают; на слабых устройствах их меньше. */
  function startFx(canvas) {
    const ctx = canvas.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const low = window.MxPerf && MxPerf.detect().tier === 'low';
    const dpr = Math.min(window.devicePixelRatio || 1, low ? 1 : 2);
    let W = 0, H = 0, raf = 0, running = true, last = performance.now();
    const resize = () => { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener('resize', resize);
    const COLORS = ['#e879f9', '#c026d3', '#a855f7', '#7c3aed', '#f0abfc', '#fde68a', '#ffffff', '#60a5fa'];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const confetti = [], sparks = [], rockets = [];
    const maxConf = reduce ? 40 : low ? 90 : 190;

    const spawnConfetti = (n) => { for (let i = 0; i < n && confetti.length < maxConf; i++) confetti.push({
      x: rnd(0, W), y: rnd(-40, -5), vx: rnd(-30, 30), vy: rnd(70, 190), w: rnd(5, 10), h: rnd(8, 16), rot: rnd(0, 6.28), vr: rnd(-6, 6),
      c: COLORS[(Math.random() * COLORS.length) | 0], sway: rnd(0, 6.28) }); };
    const burst = (x, y) => {
      const n = reduce ? 18 : low ? 34 : 70, col = COLORS[(Math.random() * COLORS.length) | 0], col2 = COLORS[(Math.random() * COLORS.length) | 0];
      for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + rnd(-.05, .05), sp = rnd(60, 230);
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: rnd(.55, 1.1), c: i % 3 ? col : col2, r: rnd(1.4, 2.8) }); }
    };
    const launch = () => rockets.push({ x: rnd(W * .15, W * .85), y: H + 10, vy: -rnd(380, 560), ty: rnd(H * .12, H * .45) });

    let tConf = 0, tRocket = 0;
    spawnConfetti(60); setTimeout(() => { launch(); }, 250);
    const frame = (now) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);

      tConf += dt; if (tConf > .06) { tConf = 0; spawnConfetti(reduce ? 1 : 3); }
      tRocket += dt; if (tRocket > (reduce ? 2.2 : 1.1)) { tRocket = 0; launch(); if (!reduce && Math.random() < .5) launch(); }

      for (let i = confetti.length - 1; i >= 0; i--) {
        const p = confetti[i]; p.sway += dt * 3; p.x += (p.vx + Math.sin(p.sway) * 40) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > H + 20) { confetti.splice(i, 1); continue; }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = .9;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.3)) + 1); ctx.restore();
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.y += r.vy * dt; r.vy *= .992;
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r.x, r.y, 2, 0, 6.283); ctx.fill();
        if (r.y <= r.ty) { burst(r.x, r.y); rockets.splice(i, 1); }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.vy += 140 * dt; s.vx *= .985; s.vy *= .985; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= s.decay * dt;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    if (navigator.vibrate) try { navigator.vibrate([60, 40, 60, 40, 140]); } catch (e) { /* noop */ }
    return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }

  /* ── Синхронизация интерфейса с титулом ── */
  function syncUi() {
    const u = typeof currentUser !== 'undefined' ? currentUser : null; if (!u) return;
    // пункт настроек «Звезда Генерала» — только у обладателя титула, рядом с «Админ панелью»
    let item = $('general-star-item');
    if (!item) {
      const admin = $('admin-panel-item');
      if (admin) {
        item = document.createElement('div');
        item.id = 'general-star-item'; item.className = 'sitem'; item.style.display = 'none';
        item.onclick = () => window.mxOpenGeneralSettings();
        item.innerHTML = `<div class="sico" style="background:#c026d318"><svg fill="url(#gsGrad)" stroke="none" viewBox="0 0 24 24"><path d="${STAR}"/></svg></div>
          <div class="stxt">Звезда «Генерал Mchat»</div>
          <svg class="chev" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>`;
        admin.parentNode.insertBefore(item, admin.nextSibling);
      }
    }
    if (item) item.style.display = u.general ? 'flex' : 'none';
    if (u.generalPending && u.general) window.mxShowGeneralCelebration();
  }
  const prevUpdate = window.updateProfileUI;
  window.updateProfileUI = function () { const r = prevUpdate.apply(this, arguments); try { syncUi(); } catch (e) { console.warn(e); } return r; };

  async function reloadMe() {
    try {
      const me = await MchatAPI.me();
      currentUser.general = me.general || null; currentUser.generalPending = !!me.generalPending;
      if (typeof saveUser === 'function') saveUser();
      if (typeof cacheUser === 'function') cacheUser(currentUser.username, { general: currentUser.general });
      updateProfileUI();
    } catch (e) { /* noop */ }
  }
  if (window.MchatAPI && MchatAPI.on) {
    MchatAPI.on('title:granted', reloadMe);        // человек в сети — праздничный экран появится сразу
    MchatAPI.on('title:revoked', async () => { await reloadMe(); toast('Титул «Генерал Mchat» снят'); });
  }

  /* ── Раздел настроек: только яркость и анимация. Цвет менять и убирать звезду нельзя. ── */
  const GLOWS = [['soft', 'Мягкое'], ['normal', 'Обычное'], ['bright', 'Яркое']];
  const ANIMS = [['pulse', 'Пульс'], ['shimmer', 'Блик'], ['sparkle', 'Искры'], ['calm', 'Спокойно']];
  window.mxOpenGeneralSettings = function () {
    const u = typeof currentUser !== 'undefined' ? currentUser : null; if (!u || !u.general) return;
    let [glow, anim] = String(u.general).split('.');
    document.querySelectorAll('.modal.mx-gs').forEach((x) => x.remove());
    const m = document.createElement('div');
    m.className = 'modal active mx-gs'; m.style.zIndex = '900';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    const draw = () => {
      const style = glow + '.' + anim;
      const opts = (list, cur, kind) => list.map(([v, l]) => `<button type="button" class="gs-opt${cur === v ? ' on' : ''}" data-k="${kind}" data-v="${v}">${l}</button>`).join('');
      m.innerHTML = `<div class="modal-box" style="max-width:380px">
        <h3>Звезда «Генерал Mchat»</h3>
        <div class="gs-preview"><span>${window.esc(u.name || u.username)}</span>${window.mxStarHtml(style)}</div>
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px">Свечение</div>
        <div class="gs-opt-row">${opts(GLOWS, glow, 'glow')}</div>
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px">Анимация</div>
        <div class="gs-opt-row">${opts(ANIMS, anim, 'anim')}</div>
        <div class="gs-note">Цвет звезды фиксированный — пурпурный. Убрать звезду нельзя: титул выдан навсегда, снять его может только создатель Mchat.</div>
        <button type="button" id="gs-save" style="width:100%;padding:12px;border-radius:14px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-family:var(--font);font-size:14px">Сохранить</button>
        <button type="button" onclick="this.closest('.modal').remove()" style="width:100%;padding:12px;border-radius:14px;border:none;background:var(--surf);color:var(--text);margin-top:8px;cursor:pointer">Закрыть</button>
      </div>`;
      m.querySelectorAll('.gs-opt').forEach((b) => { b.onclick = () => { if (b.dataset.k === 'glow') glow = b.dataset.v; else anim = b.dataset.v; draw(); }; });
      m.querySelector('#gs-save').onclick = async () => {
        try {
          const r = await MchatAPI.generalSetStyle(glow, anim);
          currentUser.general = r.style; if (typeof saveUser === 'function') saveUser();
          updateProfileUI(); m.remove(); toast('Оформление звезды сохранено');
        } catch (e) { toast(MchatAPI.errorText(e)); }
      };
    };
    draw();
    ($('app') || document.body).appendChild(m);
  };

  /* ── Админ-панель: раздел «Титулы» (только создатель/админ) ── */
  const prevAdmin = window.openAdminPanel;
  window.openAdminPanel = async function () {
    const r = await prevAdmin.apply(this, arguments);
    mountAdminTitles();
    return r;
  };
  function mountAdminTitles() {
    const modal = document.querySelector('.modal.mx-admin'); if (!modal || modal.querySelector('#adm-titles')) return;
    const scroller = modal.querySelector('.modal-box > div'); if (!scroller) return;
    const sec = document.createElement('div');
    sec.id = 'adm-titles'; sec.style.cssText = 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)';
    sec.innerHTML = `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Титулы · Генерал Mchat ${window.mxStarHtml('normal.pulse')}</div>
      <input id="adm-gen-find" placeholder="@username — выдать/забрать титул" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:none;background:var(--surf);color:var(--text);font-family:var(--font);margin-bottom:8px">
      <div id="adm-gen-res"></div>
      <div style="font-size:11px;color:var(--text2);margin:8px 0 6px">Сейчас носят титул:</div>
      <div id="adm-gen-list"><div style="color:var(--text2);padding:6px">Загрузка…</div></div>`;
    scroller.insertBefore(sec, scroller.firstChild);
    const btn = 'padding:8px 12px;border-radius:8px;border:none;color:#fff;cursor:pointer;font-size:12px;';
    const row = (u, withActions) => `<div style="background:var(--surf);border-radius:12px;padding:10px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
        ${u.avatar ? `<img src="${window.esc(u.avatar)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer">` : ''}
        <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis">${window.esc(u.name)} (@${window.esc(u.username)})${u.general ? window.mxStarHtml('normal.calm') : ''}</div>
        ${u.grantedAt ? `<div style="font-size:11px;color:var(--text2)">выдан ${window.fmtDate(u.grantedAt)} · навсегда</div>` : ''}</div>
        ${withActions ? (u.general
          ? `<button data-revoke="${window.esc(u.id)}" style="${btn}background:#dc2626">Забрать</button>`
          : `<button data-grant="${window.esc(u.username)}" style="${btn}background:#a21caf">Выдать</button>`) : ''}</div>`;
    const bind = (box) => {
      box.querySelectorAll('[data-grant]').forEach((b) => b.onclick = async () => {
        try { await MchatAPI.adminGeneralGrant(b.dataset.grant); toast('Титул «Генерал Mchat» выдан навсегда'); refresh(); $('adm-gen-find').dispatchEvent(new Event('input')); }
        catch (e) { toast(MchatAPI.errorText(e)); }
      });
      box.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = () => window.showConfirm('Забрать титул «Генерал Mchat»?', async () => {
        try { await MchatAPI.adminGeneralRevoke(b.dataset.revoke); toast('Титул снят'); refresh(); $('adm-gen-find').dispatchEvent(new Event('input')); }
        catch (e) { toast(MchatAPI.errorText(e)); }
      }));
    };
    async function refresh() {
      const box = $('adm-gen-list'); if (!box) return;
      try { const r = await MchatAPI.adminGenerals(); box.innerHTML = r.users.length ? r.users.map((u) => row(u, true)).join('') : '<div style="color:var(--text2);padding:6px">Пока никому не выдан</div>'; bind(box); }
      catch (e) { box.innerHTML = ''; toast(MchatAPI.errorText(e)); }
    }
    let t = null;
    $('adm-gen-find').addEventListener('input', (e) => {
      clearTimeout(t); const q = e.target.value.trim(), box = $('adm-gen-res');
      if (!q) { box.innerHTML = ''; return; }
      t = setTimeout(async () => {
        try { const r = await MchatAPI.adminGeneralFind(q); box.innerHTML = r.users.length ? r.users.map((u) => row(u, true)).join('') : '<div style="color:var(--text2);padding:6px">Ничего не найдено</div>'; bind(box); }
        catch (err) { toast(MchatAPI.errorText(err)); }
      }, 250);
    });
    refresh();
  }
})();

/* ============================================================
   Тексты постов: «[Имя] текст…» + аккуратная обрезка и кнопка «еще...»
   ============================================================ */
(function () {
  'use strict';
  function render(el, t, more) {
    const name = el.dataset.name || '';
    el.textContent = '';
    if (name) { const b = document.createElement('b'); b.className = 'mx-cap-name'; b.textContent = name; el.appendChild(b); el.appendChild(document.createTextNode(' ')); }
    const sp = document.createElement('span'); sp.className = 'mx-cap-text'; sp.textContent = t; el.appendChild(sp);
    if (more) {
      sp.appendChild(document.createTextNode('… '));
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mx-more'; btn.textContent = 'еще...';
      btn.onclick = (e) => { e.stopPropagation(); el.dataset.expanded = '1'; render(el, el.dataset.text || '', false); };   // клик — полный текст
      el.appendChild(btn);
    }
  }
  /** Подбирает самую длинную начальную часть текста, которая вместе с «… еще...» помещается в N строк. */
  function fit(el) {
    const full = el.dataset.text || '', lines = Math.max(1, +el.dataset.lines || 3);
    if (el.dataset.expanded === '1') return render(el, full, false);
    render(el, full, false);
    const lh = parseFloat(getComputedStyle(el).lineHeight) || (parseFloat(getComputedStyle(el).fontSize) || 13) * 1.5;
    const max = lh * lines + 2;
    if (!el.clientWidth || el.offsetHeight <= max) return;        // помещается целиком (или элемент скрыт — подгоним, когда появится)
    let lo = 0, hi = full.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      render(el, full.slice(0, mid).trimEnd(), true);
      if (el.offsetHeight <= max) lo = mid; else hi = mid - 1;
    }
    render(el, full.slice(0, lo).trimEnd(), true);
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
    for (const en of entries) {
      const el = en.target, w = Math.round(en.contentRect.width);
      if (w && w !== el._mxW) { el._mxW = w; fit(el); }          // показали экран / повернули телефон — пересчитываем
    }
  }) : null;
  function init(el) { if (el._mxInit) return; el._mxInit = true; fit(el); if (ro) ro.observe(el); else window.addEventListener('resize', () => fit(el)); }
  window.mxInitCaptions = function (root) { (root || document).querySelectorAll('.mx-cap[data-text]').forEach(init); };
  /** Для одиночных подписей (просмотр поста, Reels). */
  window.mxSetCaption = function (el, name, text, lines) {
    if (!el) return;
    el.classList.add('mx-cap'); el.dataset.name = name || ''; el.dataset.text = text || ''; el.dataset.lines = String(lines || 3); delete el.dataset.expanded;
    if (!el._mxInit) { el._mxInit = true; if (ro) ro.observe(el); }
    fit(el);
  };
  document.addEventListener('DOMContentLoaded', () => window.mxInitCaptions());
})();

/* ============================================================
   Жест/кнопка «Назад» (History API): шаг назад ВНУТРИ приложения, выход — только с главного экрана
   Пример: чат → список чатов → главная → (ещё раз) выход.
   Схема: пока есть куда возвращаться, в истории стоит «страж» (state {mx:'app'}). Жест «Назад» съедает его —
   срабатывает popstate, мы закрываем верхний слой интерфейса / возвращаем прошлый экран и снова ставим стража.
   На главном экране стража нет, поэтому следующий «Назад» штатно закрывает приложение.
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AUTH = ['s-login', 's-code'];
  const stack = [];            // предыдущие экраны
  let armed = false;           // стоит ли сейчас страж
  let navByBack = false;

  const screenId = () => { const s = document.querySelector('.screen.active'); return s ? s.id : null; };
  const loggedIn = () => typeof currentUser !== 'undefined' && !!currentUser && !AUTH.includes(screenId());

  /* ── стек экранов ── */
  const origGoTo = window.goTo;
  window.goTo = function (id) {
    const prev = screenId();
    if (AUTH.includes(id)) stack.length = 0;                       // выход из аккаунта / экран входа — истории нет
    else if (!navByBack && prev && prev !== id && !AUTH.includes(prev)) {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.length = i;                                // вернулись на уже посещённый экран — «хвост» обрезаем
      else { stack.push(prev); if (stack.length > 40) stack.shift(); }
    }
    const r = origGoTo.apply(this, arguments);
    schedule();
    return r;
  };

  /* ── слои интерфейса поверх экрана ── */
  const CLOSERS = {
    'story-viewer': () => closeStoryViewer(), 'story-creator': () => closeStoryCreator(), 'post-viewer': () => closePostViewer(),
    'foreign-post-viewer': () => closeForeignPostViewer(), 'user-profile-viewer': () => closeUserProfile(), 'avatar-fullscreen': () => closeAvatarFull(),
    'mx-preview': () => mxPreviewClose(), 'mx-camera': () => { if (typeof mxCam !== 'undefined' && mxCam && mxCam.recording) return; mxCameraClose(); },
    'chat-sheet': () => closeChatSheet(), 'post-media-sheet': () => closePostMediaSheet(), 'reels-comments-sheet': () => closeReelsComments(),
    'edit-modal': () => closeModal(), 'post-creator-modal': () => closePostCreator(), 'audio-modal': () => closeAudioModal(),
  };
  const IGNORE = new Set(['call-screen', 'call-incoming']);
  const z = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
  const visible = (el) => getComputedStyle(el).display !== 'none';

  function topLayer() {
    const cands = [];
    document.querySelectorAll('.mx-f-scrim, .modal.active, .sheet.active, .overlay.active, .modal.mx-admin, .modal.mx-gs').forEach((el) => {
      if (!visible(el) || IGNORE.has(el.id)) return;
      cands.push(el);
    });
    if (!cands.length) return null;
    // самый верхний: по z-index, при равенстве — тот, что позже в DOM
    return cands.map((el, i) => ({ el, z: z(el), i })).sort((a, b) => b.z - a.z || b.i - a.i)[0].el;
  }
  function closeLayer(el) {
    const fn = CLOSERS[el.id];
    try {
      if (fn) fn();
      else if (el.classList.contains('mx-f-scrim')) { if (window.mxFClose && el.id) window.mxFClose(el.id); else el.remove(); }
      else if (el.id && /^(modal|sheet|overlay)$/.test(el.className.split(' ')[0]) && document.getElementById(el.id) === el && el.dataset.mxStatic !== '0') {
        // статичная панель из index.html: закрываем снятием active; динамическую (создана скриптом) — удаляем
        if (el.hasAttribute('data-dynamic')) el.remove(); else el.classList.remove('active');
      } else el.remove();
    } catch (e) { try { el.classList.remove('active'); } catch (e2) { /* noop */ } if (visible(el) && !el.id) el.remove(); }
    // если после закрытия слой всё ещё виден (закрыватель не сработал) — убираем принудительно, чтобы не зациклиться
    if (document.body.contains(el) && visible(el) && !CLOSERS[el.id]) el.classList.remove('active');
  }

  /** Один шаг «назад». true — что-то сделали (или сознательно проглотили), false — мы на главном экране. */
  function backStep() {
    if (!loggedIn()) return false;
    const call = $('call-screen'), inc = $('call-incoming');
    if ((call && call.classList.contains('active')) || (inc && inc.classList.contains('active'))) return true;   // из звонка жестом не выходим
    const layer = topLayer();
    if (layer) { closeLayer(layer); return true; }
    const cur = screenId();
    if (cur === 's-video-reels' && typeof closeVideoReels === 'function') { closeVideoReels(); return true; }
    navByBack = true;
    try {
      if (stack.length) { origGoTo(stack.pop()); return true; }
      if (cur && cur !== 's-feed') {
        origGoTo(cur === 's-chat-open' ? 's-chats' : 's-feed');       // запасной путь, если стек пуст (например, чат открыли из push)
        return true;
      }
    } finally { navByBack = false; schedule(); }
    return false;
  }
  window.mxBackStep = backStep;

  function canGoBack() {
    if (!loggedIn()) return false;
    return !!topLayer() || stack.length > 0 || screenId() !== 's-feed' ||
      !!($('call-screen') && $('call-screen').classList.contains('active'));
  }
  function arm() {
    if (!armed && canGoBack()) { history.pushState({ mx: 'app' }, ''); armed = true; }
  }
  let raf = 0;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(arm); }

  window.addEventListener('popstate', () => {
    armed = false;                                    // страж «съеден» жестом/кнопкой «Назад»
    const handled = backStep();
    if (handled) arm();                               // есть куда идти дальше — снова ставим стража
    // handled=false: мы на главном экране, стража не ставим — следующий «Назад» закроет приложение
  });

  function init() {
    if (history.state && history.state.mx === 'app') armed = true;       // страница перезагружена, страж уже в истории
    else history.replaceState({ mx: 'root' }, '');
    const app = $('app') || document.body;
    new MutationObserver(schedule).observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
