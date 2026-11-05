/*
 * Mchat — единый контроллер воспроизведения (голосовые сообщения и видеокружки).
 *
 * Зачем: раньше у голосовых был свой глобальный Audio, у кружков — свой <video>, у треков — ещё несколько движков,
 * которые ничего не знали друг о друге. Здесь ОДИН контроллер MxPlayer: в каждый момент играет не более одного источника,
 * скорость (0.5x / 1x / 1.5x / 2x) общая, а состояние живёт в контроллере, а не в DOM-узле сообщения
 * (чат перерисовывается — кнопки просто синхронизируются с контроллером).
 *
 * Источник воспроизведения описывается как { kind: 'voice' | 'video', id, chatId, el (HTMLMediaElement), title }.
 * Сквозное воспроизведение между чатами сейчас включено для голосовых (верхний мини-плеер «остров»).
 * Для кружков оно выключено флагом SURVIVES_CHAT_SWITCH.video — архитектура готова: остров умеет показывать любой
 * источник, надо лишь не закрывать просмотр кружка при уходе из чата и переносить его <video> в остров.
 *
 * Загружается сразу после script.js и до остальных файлов: их обёртки (например, волна голосового в mchat-series4.js)
 * оборачивают уже эти функции.
 */
(function () {
  'use strict';

  var RATES = [0.5, 1, 1.5, 2];
  var SURVIVES_CHAT_SWITCH = { voice: true, video: false };
  var PLAY_ICO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  var PAUSE_ICO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var curChatId = function () { try { return typeof currentChatId !== 'undefined' ? currentChatId : null; } catch (e) { return null; } };
  var chatList = function () { try { return typeof chats !== 'undefined' ? chats : []; } catch (e) { return []; } };
  var toast = function (m) { try { (window.showToast || window.alert)(m); } catch (e) { /* ничего */ } };
  var rateLabel = function (r) { return (r === 1 ? '1' : String(r)) + 'x'; };

  // ── состояние ──
  var rate = 1;                 // общая скорость (держится в памяти, пока открыта страница)
  var circleRates = [2, 0.5, 1];
  var cur = null;               // текущий источник
  var voiceEl = new Audio();    // единственный аудио-элемент голосовых
  voiceEl.preload = 'auto';
  try { voiceEl.preservesPitch = true; voiceEl.webkitPreservesPitch = true; } catch (e) { /* ничего */ }

  // Совместимость со старым кодом (mchat-series4.js рисует волну по этим глобальным значениям)
  Object.defineProperty(window, '_mxVoiceAudio', { configurable: true, get: function () { return voiceEl; }, set: function () { /* единственный элемент */ } });
  Object.defineProperty(window, '_mxVoicePlayingId', { configurable: true, get: function () { return cur && cur.kind === 'voice' ? cur.id : null; }, set: function () { /* состояние только в контроллере */ } });

  // ── остановка прочего звука ──
  function pauseForeign() {
    ['_mxTrackAudio', '_mxTrackRowAudio', '_mxProfileAudio'].forEach(function (k) {
      try { if (window[k] && !window[k].paused) window[k].pause(); } catch (e) { /* ничего */ }
    });
    document.querySelectorAll('audio').forEach(function (a) { if (a !== voiceEl && !a.paused) a.pause(); });
  }
  // Любой «содержательный» звук (трек, видео со звуком) ставит на паузу наш голосовой: никаких двух звуков одновременно.
  // Короткие системные звуки и звук звонков (без src /api/media/) голосовые не прерывают.
  var _play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      if (this !== voiceEl && !(this.closest && this.closest('#mx-vn-zoom'))) {
        var content = (this instanceof HTMLVideoElement && !this.muted && this.volume > 0) || String(this.currentSrc || this.src || '').indexOf('/api/media/') !== -1;
        if (content) { if (!voiceEl.paused) voiceEl.pause(); if (cur && cur.kind === 'video' && cur.el !== this) closeCircle(); }
      }
    } catch (e) { /* не мешаем воспроизведению */ }
    return _play.apply(this, arguments);
  };

  // ── подписи / поиск сообщения ──
  function findMsg(id) {
    try {
      for (var k in messages) { var m = (messages[k] || []).find(function (x) { return String(x.id) === String(id); }); if (m) return m; }
    } catch (e) { /* ничего */ }
    return null;
  }
  function voiceTitle(id, chatId) {
    var m = findMsg(id), name = '';
    if (m) name = m.outgoing ? 'Вы' : (m.senderName || '');
    if (!name) { var ch = chatList().find(function (c) { return c.id === chatId; }); name = ch ? ch.name : ''; }
    return 'Голосовое' + (name ? ' · ' + name : '');
  }

  // ── общий API ──
  function setRate(r) {
    if (RATES.indexOf(r) === -1) return;
    rate = r;
    try { voiceEl.playbackRate = r; } catch (e) { /* ничего */ }
    if (cur && cur.kind === 'video' && cur.el) { try { cur.el.defaultPlaybackRate = r; cur.el.playbackRate = r; } catch (e) { /* ничего */ } }
    refresh();
  }
  function cycleRate() { setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]); }
  function pause() { if (cur && cur.el && !cur.el.paused) cur.el.pause(); }
  function stop() {
    if (cur && cur.kind === 'video') return closeCircle();
    cur = null;   // сначала сбрасываем источник, чтобы событие error от load() не показало лишнюю ошибку
    try { voiceEl.pause(); voiceEl.removeAttribute('src'); voiceEl.load(); } catch (e) { /* ничего */ }
    refresh();
  }

  // ── голосовые сообщения ──
  function voiceToggle(btn, msgId) {
    var wrap = btn && btn.closest && btn.closest('.mx-voice');
    var url = wrap && wrap.getAttribute('data-audio-url');
    if (!url) return;
    if (cur && cur.kind === 'voice' && String(cur.id) === String(msgId)) {
      if (voiceEl.paused) { var r = voiceEl.play(); if (r && r.catch) r.catch(function () { /* см. error-событие */ }); } else voiceEl.pause();
      return;
    }
    closeCircle(true);
    pauseForeign();
    cur = { kind: 'voice', id: String(msgId), chatId: curChatId(), el: voiceEl, title: voiceTitle(msgId, curChatId()) };
    voiceEl.src = url;
    voiceEl.playbackRate = rate;
    var p = voiceEl.play();
    if (p && p.catch) p.catch(function () { /* сообщение об ошибке покажет событие error */ });
    refresh();
  }
  function voiceSeek(evt, progEl) {
    var wrap = progEl && progEl.closest('.mx-voice');
    if (!wrap || !cur || cur.kind !== 'voice' || String(wrap.getAttribute('data-mid')) !== String(cur.id) || !voiceEl.duration) return;
    var r = progEl.getBoundingClientRect();
    voiceEl.currentTime = Math.min(1, Math.max(0, (evt.clientX - r.left) / r.width)) * voiceEl.duration;
  }
  ['play', 'pause', 'timeupdate', 'ratechange', 'loadedmetadata', 'waiting', 'playing'].forEach(function (ev) { voiceEl.addEventListener(ev, refresh); });
  voiceEl.addEventListener('ended', function () { voiceEl.currentTime = 0; cur = null; refresh(); });
  voiceEl.addEventListener('error', function () {
    if (!cur || cur.kind !== 'voice') return;
    var code = voiceEl.error && voiceEl.error.code;
    toast(code === 4 ? 'Не удалось воспроизвести: файл недоступен или формат не поддерживается' : code === 2 ? 'Не удалось загрузить голосовое — проверьте соединение' : 'Не удалось воспроизвести голосовое');
    cur = null; refresh();
  });

  // ── синхронизация DOM чата с состоянием ──
  var rafId = 0;
  function refresh() { if (!rafId) rafId = requestAnimationFrame(function () { rafId = 0; syncChat(); syncIsland(); }); }
  function syncChat() {
    document.querySelectorAll('.mx-voice[data-mid]').forEach(function (v) {
      var isCur = !!cur && cur.kind === 'voice' && String(v.getAttribute('data-mid')) === String(cur.id);
      var btn = v.querySelector('.mx-vplay');
      if (btn) { var want = isCur && !voiceEl.paused ? 'p' : 'l'; if (btn.getAttribute('data-st') !== want) { btn.setAttribute('data-st', want); btn.innerHTML = want === 'p' ? PAUSE_ICO : PLAY_ICO; } }
      var chip = v.querySelector('.mx-vrate');
      if (isCur) {
        if (!chip) { chip = document.createElement('button'); chip.className = 'mx-vrate'; chip.onclick = function (e) { e.stopPropagation(); cycleRate(); }; v.appendChild(chip); }
        chip.textContent = rateLabel(rate);
        var fill = v.querySelector('.mx-prog-fill'); if (fill && voiceEl.duration) fill.style.width = (voiceEl.currentTime / voiceEl.duration * 100) + '%';
      } else if (chip) chip.remove();
    });
  }
  (function watchChat() {
    var c = $('messages-container');
    if (c && window.MutationObserver) new MutationObserver(refresh).observe(c, { childList: true });
  })();

  // ── верхний мини-плеер («остров») ──
  var island = null, ratesOpen = false;
  function buildIsland() {
    island = document.createElement('div');
    island.id = 'mx-island'; island.className = 'mx-island'; island.hidden = true;
    island.innerHTML = '<button class="mx-isl-btn" data-act="toggle" aria-label="Пауза / продолжить"></button>'
      + '<div class="mx-isl-main" data-act="goto"><div class="mx-isl-title"></div><div class="mx-isl-prog"><i></i></div></div>'
      + '<button class="mx-isl-rate" data-act="rates" aria-label="Скорость"></button>'
      + '<button class="mx-isl-btn mx-isl-x" data-act="close" aria-label="Закрыть">✕</button>'
      + '<div class="mx-isl-rates" hidden>' + RATES.map(function (r) { return '<button data-rate="' + r + '">' + rateLabel(r) + '</button>'; }).join('') + '</div>';
    document.body.appendChild(island);
    island.addEventListener('click', function (e) {
      var rb = e.target.closest('[data-rate]');
      if (rb) { setRate(parseFloat(rb.getAttribute('data-rate'))); ratesOpen = false; return syncIsland(); }
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'toggle') { if (voiceEl.paused) { var p = voiceEl.play(); if (p && p.catch) p.catch(function () { /* ничего */ }); } else voiceEl.pause(); }
      else if (act === 'rates') { ratesOpen = !ratesOpen; syncIsland(); }
      else if (act === 'close') { ratesOpen = false; stop(); }
      else if (act === 'goto' && cur && cur.chatId && typeof window.openChat === 'function') {
        var id = cur.id;
        Promise.resolve(window.openChat(cur.chatId)).then(function () {
          setTimeout(function () { var el = document.querySelector('#messages-container .msg[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 350);
        });
      }
    });
  }
  function syncIsland() {
    var show = !!cur && cur.kind === 'voice' && SURVIVES_CHAT_SWITCH.voice;
    if (!island) { if (!show) return; buildIsland(); }
    island.hidden = !show;
    if (!show) { ratesOpen = false; return; }
    island.querySelector('[data-act="toggle"]').innerHTML = voiceEl.paused ? PLAY_ICO : PAUSE_ICO;
    island.querySelector('.mx-isl-title').textContent = cur.title || 'Голосовое сообщение';
    island.querySelector('.mx-isl-rate').textContent = rateLabel(rate);
    island.querySelector('.mx-isl-prog i').style.width = (voiceEl.duration ? voiceEl.currentTime / voiceEl.duration * 100 : 0) + '%';
    var box = island.querySelector('.mx-isl-rates'); box.hidden = !ratesOpen;
    box.querySelectorAll('[data-rate]').forEach(function (b) { b.classList.toggle('on', parseFloat(b.getAttribute('data-rate')) === rate); });
  }

  // ── видеокружок: увеличенный просмотр ──
  var zoom = null;
  function openCircle(wrap) {
    if (!wrap || wrap.classList.contains('mx-vn-pending') || wrap.classList.contains('mx-vn-failed')) return;   // ещё не готов к воспроизведению
    var small = wrap.querySelector('video');
    var src = small && (small.currentSrc || small.src);
    if (!src) return;
    setRate(1);
    closeCircle(true);
    try { if (!voiceEl.paused) voiceEl.pause(); } catch (e) { /* ничего */ }
    pauseForeign();
    zoom = document.createElement('div');
    zoom.id = 'mx-vn-zoom'; zoom.className = 'mx-vn-zoom';
    var msg = findMsg(wrap.getAttribute('data-mid') || '');
    var ownId = ''; try { ownId = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : ''; } catch (e) { /* noop */ }
    var sender = msg && (String(msg.senderId) === String(ownId) ? 'Вы' : (msg.senderName || msg.sender || ''));
    zoom.innerHTML = '<div class="mx-vnz-island"><button class="mx-vnz-pause" aria-label="Пауза"></button><span class="mx-vnz-sender">' + esc(sender || 'Кружок') + '</span><button class="mx-vnz-rate" data-rate="1">1x</button></div>'
      + '<div class="mx-vnz-circle"><video playsinline preload="auto"></video>'
      + '<svg class="mx-vnz-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/></svg></div>';
    document.body.appendChild(zoom);
    var v = zoom.querySelector('video'), ring = zoom.querySelector('.mx-vnz-ring circle');
    var btn = zoom.querySelector('.mx-vnz-pause');
    btn.innerHTML = PAUSE_ICO.replace(/16/g, '26');
    v.src = src; v.defaultPlaybackRate = rate; v.playbackRate = rate;
    v.addEventListener('loadedmetadata', function () { if (typeof window.mxFixWebmDuration === 'function') window.mxFixWebmDuration(v); v.playbackRate = rate; });
    v.addEventListener('timeupdate', function () { if (v.duration && isFinite(v.duration)) ring.style.strokeDashoffset = String(301.6 * (1 - v.currentTime / v.duration)); });
    v.addEventListener('ended', function () { closeCircle(); });
    v.addEventListener('error', function () {
      if (!zoom) return;
      var code = v.error && v.error.code;
      toast(code === 2 ? 'Не удалось загрузить кружок — проверьте соединение' : code === 4 ? 'Файл кружка недоступен или его формат не поддерживается' : 'Не удалось воспроизвести кружок');
      closeCircle();
    });
    cur = { kind: 'video', id: wrap.getAttribute('data-mid') || '', chatId: curChatId(), el: v, title: 'Кружок' };
    var rateBtn = zoom.querySelector('.mx-vnz-rate');
    rateBtn.onclick = function (e) { e.stopPropagation(); var i = circleRates.indexOf(rate); setRate(circleRates[(i + 1) % circleRates.length]); rateBtn.textContent = rateLabel(rate); };
    var tapTimer = null;
    zoom.querySelector('.mx-vnz-circle').addEventListener('dblclick', function (e) {
      e.preventDefault(); e.stopPropagation();
      var rect = e.currentTarget.getBoundingClientRect(); v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + (e.clientX >= rect.left + rect.width / 2 ? 5 : -5)));
    });
    zoom.addEventListener('click', function (e) {
      var rb = e.target.closest('[data-rate]');
      if (rb) return;
      if (e.target.closest('.mx-vnz-pause')) { e.stopPropagation(); if (v.paused) { v.play().catch(function () {}); btn.innerHTML = PAUSE_ICO.replace(/16/g, '26'); } else { v.pause(); btn.innerHTML = PLAY_ICO.replace(/16/g, '26'); } return; }
      if (e.target.closest('.mx-vnz-circle')) {
        if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; return; }
        tapTimer = setTimeout(function () { tapTimer = null; if (v.paused) { v.play().catch(function () {}); btn.innerHTML = PAUSE_ICO.replace(/16/g, '26'); } else { v.pause(); btn.innerHTML = PLAY_ICO.replace(/16/g, '26'); } }, 230);
      } else if (e.target === zoom) closeCircle();
    });
    var pr = v.play(); if (pr && pr.catch) pr.catch(function () { toast('Не удалось воспроизвести кружок'); closeCircle(); });
    requestAnimationFrame(function () { zoom && zoom.classList.add('on'); });
  }
  function closeCircle(silent) {
    if (!zoom) return;
    var v = zoom.querySelector('video');
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* ничего */ }
    zoom.remove(); zoom = null;
    if (cur && cur.kind === 'video') cur = null;
    if (!silent) refresh();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && zoom) closeCircle(); });
  // у кружка нет сквозного режима: при уходе из чата просмотр закрывается (см. SURVIVES_CHAT_SWITCH.video)
  (function () {
    var _g = window.goTo;
    if (typeof _g === 'function') window.goTo = function (id) { if (zoom && !SURVIVES_CHAT_SWITCH.video) closeCircle(); return _g.apply(this, arguments); };
  })();

  // ── публичное API и подмена старых функций ──
  window.MxPlayer = {
    RATES: RATES, get rate() { return rate; }, get current() { return cur; },
    setRate: setRate, cycleRate: cycleRate, pause: pause, stop: stop, refresh: refresh,
    voiceToggle: voiceToggle, openCircle: openCircle, closeCircle: closeCircle,
  };
  window.mxVoicePlayToggle = voiceToggle;
  window.mxVoiceSeek = voiceSeek;
  window.mxVideoNoteToggle = openCircle;
})();
