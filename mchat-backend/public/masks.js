/* Mchat · Маски и эффекты для видеозвонков
 *
 * Схема:
 *   камера → скрытый <video> → MediaPipe Face Landmarker (478 точек лица, реальное время)
 *          → <canvas>: кадр + 2D PNG-маска по координатам лица (угол наклона и масштаб — по глазам)
 *          → canvas.captureStream() → zg.replaceTrack(localStream, canvasTrack) — собеседник по WebRTC (ZEGOCLOUD)
 *            получает уже готовое видео с маской.
 * Маски переключаются и отключаются «на лету»; при выключении возвращается обычная камера.
 * Любой сбой (нет WebGL/сети для модели) не обрывает звонок — просто остаётся обычное видео.
 */
(function () {
  'use strict';

  const MP_VERSION = '0.10.14';
  const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MP_VERSION;
  const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  // anchor: eyes | forehead | mouth;  w — ширина маски в расстояниях между внешними уголками глаз;
  // px/py — какая точка картинки (0..1) ставится в опорную точку лица; dy — сдвиг вдоль «вниз по лицу» в тех же единицах.
  const MASKS = [
    { id: 'shades',   name: 'Очки',     src: '/masks/shades.png',   anchor: 'eyes',     w: 2.15, px: 0.5, py: 0.5,  dy: 0.04 },
    { id: 'glasses',  name: 'Круглые',  src: '/masks/glasses.png',  anchor: 'eyes',     w: 2.15, px: 0.5, py: 0.5,  dy: 0.04 },
    { id: 'horns',    name: 'Рожки',    src: '/masks/horns.png',    anchor: 'forehead', w: 2.0,  px: 0.5, py: 0.82, dy: 0.02 },
    { id: 'mustache', name: 'Усы',      src: '/masks/mustache.png', anchor: 'mouth',    w: 1.25, px: 0.5, py: 0.45, dy: 0.0 },
    { id: 'hero',     name: 'Маска',    src: '/masks/hero.png',     anchor: 'eyes',     w: 2.35, px: 0.5, py: 0.5,  dy: 0.03 },
    { id: 'crown',    name: 'Корона',   src: '/masks/crown.png',    anchor: 'forehead', w: 2.1,  px: 0.5, py: 0.9,  dy: -0.05 },
    // «фильтры» без привязки к лицу
    { id: 'bw',       name: 'Ч/Б',      filter: 'grayscale(1) contrast(1.1)', emoji: '◐' },
    { id: 'warm',     name: 'Тёплый',   filter: 'sepia(.55) saturate(1.35) hue-rotate(-10deg)', emoji: '☀' },
    { id: 'cool',     name: 'Холодный', filter: 'saturate(1.2) hue-rotate(25deg) brightness(1.05)', emoji: '❄' },
  ];

  const state = {
    ready: null,        // Promise загрузки MediaPipe
    landmarker: null,
    active: false,
    maskId: null,
    images: {},
    raw: null,          // MediaStream «сырой» камеры для распознавания
    video: null,        // скрытый <video>
    canvas: null, ctx: null, outTrack: null,
    raf: 0, lastTs: 0, smooth: null,
    call: null,
    facing: 'user',
    panelOpen: false,
  };

  const $ = (id) => document.getElementById(id);
  const toast = (m) => { if (window.showToast) window.showToast(m); };

  function loadImage(src) {
    return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }
  async function preloadImages() {
    await Promise.all(MASKS.filter((m) => m.src && !state.images[m.id]).map(async (m) => { state.images[m.id] = await loadImage(m.src); }));
  }

  /** Подгружаем MediaPipe только когда человек впервые открыл маски (≈ 10 МБ wasm + модель, дальше — из кэша SW). */
  function loadLandmarker() {
    if (state.ready) return state.ready;
    state.ready = (async () => {
      const vision = await import(MP_BASE + '/vision_bundle.mjs');
      const fileset = await vision.FilesetResolver.forVisionTasks(MP_BASE + '/wasm');
      const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
      });
      try { state.landmarker = await make('GPU'); } catch (e) { state.landmarker = await make('CPU'); }
      return state.landmarker;
    })().catch((e) => { state.ready = null; throw e; });
    return state.ready;
  }

  async function openRawCamera() {
    if (state.raw) state.raw.getTracks().forEach((t) => t.stop());
    const hd = window.mxHdPref && window.mxHdPref();
    state.raw = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facing, width: { ideal: hd ? 1280 : 640 }, height: { ideal: hd ? 720 : 480 } }, audio: false,
    });
    state.video.srcObject = state.raw;
    await state.video.play().catch(() => {});
  }

  const lerp = (a, b, t) => a + (b - a) * t;

  /** Положение лица в пикселях холста: опорные точки сглаживаем, чтобы маска не дрожала. */
  function faceGeometry(lm, W, H) {
    const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
    const eyeR = P(33), eyeL = P(263), nose = P(1), lip = P(0), fore = P(10);
    const g = {
      ex: (eyeR.x + eyeL.x) / 2, ey: (eyeR.y + eyeL.y) / 2,
      ang: Math.atan2(eyeL.y - eyeR.y, eyeL.x - eyeR.x),
      dist: Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y),
      fx: fore.x, fy: fore.y,
      mx: (nose.x + lip.x) / 2, my: (nose.y + lip.y) / 2 + 0.01 * H,
    };
    if (!state.smooth) { state.smooth = g; return g; }
    const s = state.smooth, k = 0.55;
    // угол сглаживаем через кратчайшую разность, чтобы не «прыгать» на ±π
    let da = g.ang - s.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    state.smooth = {
      ex: lerp(s.ex, g.ex, k), ey: lerp(s.ey, g.ey, k), ang: s.ang + da * k, dist: lerp(s.dist, g.dist, k),
      fx: lerp(s.fx, g.fx, k), fy: lerp(s.fy, g.fy, k), mx: lerp(s.mx, g.mx, k), my: lerp(s.my, g.my, k),
    };
    return state.smooth;
  }

  function drawMask(ctx, mask, geo) {
    const img = state.images[mask.id];
    if (!img) return;
    const W = geo.dist * mask.w, H = W * img.height / img.width;
    const ax = mask.anchor === 'eyes' ? geo.ex : mask.anchor === 'forehead' ? geo.fx : geo.mx;
    const ay = mask.anchor === 'eyes' ? geo.ey : mask.anchor === 'forehead' ? geo.fy : geo.my;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(geo.ang);
    ctx.translate(0, geo.dist * (mask.dy || 0));
    ctx.drawImage(img, -mask.px * W, -mask.py * H, W, H);
    ctx.restore();
  }

  function frame() {
    if (!state.active) return;
    state.raf = requestAnimationFrame(frame);
    const v = state.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    const cv = state.canvas, ctx = state.ctx;
    if (cv.width !== v.videoWidth || cv.height !== v.videoHeight) { cv.width = v.videoWidth; cv.height = v.videoHeight; }
    const mask = MASKS.find((m) => m.id === state.maskId);
    ctx.filter = mask && mask.filter ? mask.filter : 'none';
    ctx.drawImage(v, 0, 0, cv.width, cv.height);   // собеседнику кадр уходит без зеркала — как с обычной камерой
    ctx.filter = 'none';
    if (!mask || !mask.src || !state.landmarker) return;
    const now = performance.now();
    if (now <= state.lastTs) return;               // detectForVideo требует строго растущее время
    state.lastTs = now;
    let res;
    try { res = state.landmarker.detectForVideo(v, now); } catch (e) { return; }
    const lm = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!lm) { state.smooth = null; return; }      // лица нет в кадре — маску не рисуем
    drawMask(ctx, mask, faceGeometry(lm, cv.width, cv.height));
  }

  function setSelfPreview(call) {
    const self = $('call-self');
    if (!self || !call.localStream) return;
    self.srcObject = null; self.srcObject = call.localStream;
    self.play && self.play().catch(() => {});
  }

  /** Подменяем исходящее видео в уже идущей трансляции. */
  async function replaceOutgoing(call, track) {
    await call.zg.replaceTrack(call.localStream, track);
    setSelfPreview(call);
  }

  async function startPipeline(call) {
    state.call = call;
    state.facing = call.facing || 'user';
    state.video = document.createElement('video');
    state.video.muted = true; state.video.playsInline = true; state.video.setAttribute('playsinline', '');
    state.video.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(state.video);
    state.canvas = document.createElement('canvas');
    state.ctx = state.canvas.getContext('2d', { alpha: false });
    await openRawCamera();
    state.canvas.width = state.video.videoWidth || 640; state.canvas.height = state.video.videoHeight || 480;
    state.active = true;
    state.smooth = null;
    frame();
    const out = state.canvas.captureStream(30);
    state.outTrack = out.getVideoTracks()[0];
    await replaceOutgoing(call, state.outTrack);
  }

  /** Вернуть обычную камеру (когда маску выключили или звонок закончился). */
  async function stopPipeline(restore) {
    const call = state.call;
    state.active = false;
    cancelAnimationFrame(state.raf);
    if (restore && call && call.zg && call.localStream && call.camOn !== false) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facing } });
        await replaceOutgoing(call, cam.getVideoTracks()[0]);
      } catch (e) { console.warn('[masks] restore camera failed', e); }
    }
    if (state.outTrack) { try { state.outTrack.stop(); } catch (e) {} state.outTrack = null; }
    if (state.raw) { state.raw.getTracks().forEach((t) => t.stop()); state.raw = null; }
    if (state.video) { state.video.srcObject = null; state.video.remove(); state.video = null; }
    state.canvas = null; state.ctx = null; state.smooth = null; state.call = null;
  }

  function setStatus(text) { const s = $('mx-mask-status'); if (s) s.textContent = text || ''; }

  /** Выбор маски: null — снять. */
  async function select(id) {
    const call = typeof mxCall !== 'undefined' ? mxCall : null;   // let-переменная из script.js
    if (!call || !call.zg || !call.localStream) { toast('Сначала дождись соединения'); return; }
    if (id && !call.camOn) { toast('Сначала включи камеру'); return; }
    if (!id) {
      state.maskId = null;
      if (state.active) await stopPipeline(true);
      syncUi();
      return;
    }
    const mask = MASKS.find((m) => m.id === id);
    state.maskId = id;
    syncUi();
    try {
      if (mask.src) {
        setStatus('Загружаю распознавание лица…');
        await Promise.all([preloadImages(), loadLandmarker()]);
        setStatus('');
      }
      if (state.maskId !== id) return;             // пока грузилось, выбрали другую
      if (!state.active) await startPipeline(call);
    } catch (e) {
      console.error('[masks] failed', e);
      setStatus('');
      state.maskId = null;
      if (state.active) await stopPipeline(true);
      syncUi();
      toast('Не удалось включить маски. Звонок продолжается без них');
    }
  }

  /** Переключение камеры при включённой маске: перезапускаем «сырую» камеру с другой стороной. */
  async function flip() {
    if (!state.active) return false;
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    state.smooth = null;
    try { await openRawCamera(); } catch (e) { toast('Не удалось переключить камеру'); }
    if (state.call) state.call.facing = state.facing;
    return true;
  }

  function syncUi() {
    document.querySelectorAll('.mx-mask-item').forEach((el) => el.classList.toggle('on', (el.dataset.id || '') === (state.maskId || '')));
    const btn = $('call-mask');
    if (btn) btn.classList.toggle('mx-mask-on', !!state.maskId);
  }

  function togglePanel(force) {
    const p = $('mx-mask-panel');
    if (!p) return;
    state.panelOpen = force === undefined ? !state.panelOpen : !!force;
    p.classList.toggle('open', state.panelOpen);
    if (state.panelOpen && !state.landmarker) { preloadImages(); }   // картинки — сразу, модель — при выборе маски
  }

  /** Кнопка и выдвижная панель в интерфейсе видеозвонка (встроены в существующую стилистику кнопок звонка). */
  function mountUi() {
    const screen = $('call-screen');
    if (!screen || $('call-mask')) return;
    const anyBtn = screen.querySelector('.call-btn');
    const row = anyBtn && anyBtn.parentNode;
    if (!row) return;
    const btn = document.createElement('button');
    btn.className = 'call-btn'; btn.id = 'call-mask'; btn.title = 'Маски'; btn.type = 'button';
    btn.innerHTML = '<svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 007 0"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/></svg>';
    btn.onclick = () => togglePanel();
    row.insertBefore(btn, row.children[2] || null);

    const panel = document.createElement('div');
    panel.className = 'mx-mask-panel'; panel.id = 'mx-mask-panel';
    panel.innerHTML = '<div class="mx-mask-status" id="mx-mask-status"></div><div class="mx-mask-row" id="mx-mask-row"></div>';
    screen.appendChild(panel);
    const rowEl = panel.querySelector('#mx-mask-row');
    const item = (id, name, inner) => `<div class="mx-mask-item" data-id="${id}" onclick="MxMasks.select(${id ? "'" + id + "'" : 'null'})"><div class="th">${inner}</div><div>${name}</div></div>`;
    rowEl.innerHTML = item('', 'Нет', '<svg width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>')
      + MASKS.map((m) => item(m.id, m.name, m.src ? `<img src="${m.src}" alt="">` : `<span style="font-size:22px;color:#fff">${m.emoji}</span>`)).join('');
    // тап по видео вне панели — закрывает её
    $('call-grid').addEventListener('click', () => togglePanel(false));
    syncUi();
  }

  window.MxMasks = {
    MASKS, select, flip, togglePanel, mountUi,
    get active() { return state.active; },
    /** Вызывается при завершении звонка. */
    reset() {
      state.maskId = null; state.panelOpen = false;
      const p = $('mx-mask-panel'); if (p) p.classList.remove('open');
      if (state.active) stopPipeline(false);
      syncUi();
    },
  };
})();
