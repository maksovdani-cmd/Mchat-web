/* ============================================================
   Mchat · серия 5 (подключается ПОСЛЕ mchat-series4.js).
   1. Статусы сообщений: часы / одна галочка (принято сервером) / две (прочитано)
   2. Короткий тап → меню действий + быстрые реакции; долгое нажатие → мультивыделение
   3. Панель ввода: смайлик слева, скрепка справа, кнопка «голос ⇄ кружок»
   4. Запись кружка удержанием (свайп вверх — зафиксировать, влево — отмена)
   5. Звонки: гарантированный сброс интерфейса после завершения, проверка смены камеры
   6. Одноразовые медиа: защита просмотра (скрытие при уходе в фон, водяной знак, запрет копирования)
   7. Комментарии: ответы, лайки, @упоминания
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (m) => { try { (window.showToast || console.log)(m); } catch (e) { /* noop */ } };
  const E = (s) => (typeof window.esc === 'function' ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const msgsOf = (id) => { try { return (messages && messages[id]) || []; } catch (e) { return []; } };
  const curChat = () => { try { return currentChatId; } catch (e) { return null; } };
  const me = () => { try { return currentUser || null; } catch (e) { return null; } };
  const meta = () => { try { return currentChatMeta || null; } catch (e) { return null; } };
  const appEl = () => $('app') || document.body;
  const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* noop */ } };
  const closeFloating = () => { try { window.mxCloseFloating && window.mxCloseFloating(); } catch (e) { /* noop */ } };

  /* ═════════ 1. Статусы доставки / прочтения ═════════ */
  window.mxRefreshTicks = function () {
    const c = $('messages-container'); if (!c) return;
    const list = msgsOf(curChat());
    const m0 = meta(), at = m0 && m0.peerReadAt ? Date.parse(m0.peerReadAt) : NaN;
    c.querySelectorAll('.msg.mo[data-id] .mx-tick').forEach((el) => {
      if (el.classList.contains('pend')) return;
      const id = el.closest('.msg').dataset.id;
      const m = list.find((x) => x.id === id); if (!m) return;
      const read = !isNaN(at) && !!m.createdAt && Date.parse(m.createdAt) <= at;
      if (el.classList.contains('read') === read && (el.classList.contains('sent') || read)) return;
      el.classList.toggle('read', read); el.classList.toggle('sent', !read);
      el.title = read ? 'Прочитано' : 'Отправлено';
      el.innerHTML = read ? MX_TICK_SVG.two : MX_TICK_SVG.one;
    });
  };
  function onPeerRead(p) {
    const u = me(); if (!u || !p || p.userId === u.id || !p.at) return;
    const t = Date.parse(p.at); if (isNaN(t)) return;
    const newer = (cur) => (!cur || Date.parse(cur) < t ? p.at : cur);   // повторные и запоздавшие события не откатывают статус
    const ch = (typeof chats !== 'undefined' ? chats : []).find((c) => c.id === p.chatId);
    if (ch) ch.peerReadAt = newer(ch.peerReadAt);
    if (p.chatId === curChat() && meta()) { meta().peerReadAt = newer(meta().peerReadAt); window.mxRefreshTicks(); }
  }
  if (typeof window.bindRealtimeHandlers === 'function') {
    const _bind = window.bindRealtimeHandlers;
    window.bindRealtimeHandlers = function () {
      const r = _bind.apply(this, arguments);
      try { const h = MchatAPI.handlers, prev = h.onRead; h.onRead = function (p) { if (prev) prev.call(this, p); onPeerRead(p); }; } catch (e) { /* noop */ }
      return r;
    };
  }
  // после возврата в приложение / переподключения подтягиваем актуальное время прочтения собеседником
  async function resyncRead() {
    const id = curChat(); if (!id || document.hidden || !(MchatAPI.chat || MchatAPI.getChat)) return;
    try {
      const r = await (MchatAPI.chat || MchatAPI.getChat)(id);
      const c = r && (r.chat || r); if (c && c.peerReadAt) onPeerRead({ chatId: id, userId: '_peer', at: c.peerReadAt });
    } catch (e) { /* не критично */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resyncRead(); });
  window.addEventListener('online', resyncRead);

  /* ═════════ 2. Мультивыделение ═════════ */
  const sel = { on: false, ids: new Set() };
  const SEL_ICO = {
    x: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    copy: '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    fwd: '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 014-4h12"/></svg>',
    del: '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>',
  };
  const findMsg = (id) => msgsOf(curChat()).find((m) => m.id === id);
  const selectable = (m) => !!m && !m.pending && m.kind !== 'CALL';
  const orderedSel = () => { const set = sel.ids; return msgsOf(curChat()).filter((m) => set.has(m.id)); };

  function selBar() {
    let bar = $('mx-selbar');
    if (bar) return bar;
    bar = document.createElement('div'); bar.id = 'mx-selbar'; bar.className = 'mx-selbar';
    bar.innerHTML = '<button type="button" class="mx-sb-x" data-a="close" aria-label="Закрыть" title="Закрыть">' + SEL_ICO.x + '</button>'
      + '<div class="mx-sb-cnt" id="mx-sb-cnt"></div>'
      + '<button type="button" class="mx-sb-act" data-a="copy" aria-label="Скопировать" title="Скопировать">' + SEL_ICO.copy + '<span>Скопировать</span></button>'
      + '<button type="button" class="mx-sb-act" data-a="fwd" aria-label="Переслать" title="Переслать">' + SEL_ICO.fwd + '<span>Переслать</span></button>'
      + '<button type="button" class="mx-sb-act danger" data-a="del" aria-label="Удалить" title="Удалить">' + SEL_ICO.del + '<span>Удалить</span></button>';
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      e.stopPropagation();
      if (b.dataset.a === 'close') selExit(); else if (b.dataset.a === 'copy') selCopy(); else if (b.dataset.a === 'fwd') selForward(); else if (b.dataset.a === 'del') selDelete();
    });
    appEl().appendChild(bar);
    return bar;
  }
  function selPaint() {
    const c = $('messages-container'); if (!c) return;
    c.classList.toggle('mx-selmode', sel.on);
    c.querySelectorAll('.msg[data-id]').forEach((el) => el.classList.toggle('mx-sel', sel.on && sel.ids.has(el.dataset.id)));
    c.querySelectorAll('.mx-alb-tile[data-mid]').forEach((el) => el.classList.toggle('mx-sel', sel.on && sel.ids.has(el.dataset.mid)));
    const cnt = $('mx-sb-cnt'); if (cnt) cnt.textContent = 'Выбрано ' + sel.ids.size;
  }
  window.mxSelReapply = function () {
    if (!sel.on) return;
    const live = new Set(msgsOf(curChat()).map((m) => m.id));
    sel.ids.forEach((id) => { if (!live.has(id)) sel.ids.delete(id); });     // выбранное сообщение удалили — убираем из выбора
    if (!sel.ids.size) { selExit(); return; }
    selPaint();
  };
  function selEnter(id) {
    const m = findMsg(id); if (!selectable(m)) return;
    closeFloating();
    sel.on = true; sel.ids.clear(); sel.ids.add(id);
    selBar().classList.add('on'); selPaint(); vibrate(15);
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* noop */ }
  }
  function selToggle(id) {
    const m = findMsg(id); if (!selectable(m)) return;
    if (sel.ids.has(id)) sel.ids.delete(id); else sel.ids.add(id);
    if (!sel.ids.size) { selExit(); return; }
    selPaint(); vibrate(8);
  }
  function selExit() {
    sel.on = false; sel.ids.clear();
    const bar = $('mx-selbar'); if (bar) bar.classList.remove('on');
    selPaint();
  }
  window.mxSelPress = function (id) { if (sel.on) selToggle(id); else selEnter(id); };
  window.mxSelExit = selExit;
  window.mxSelActive = () => sel.on;

  // в режиме выделения короткий тап по сообщению/плитке альбома добавляет или снимает выделение; остальное не срабатывает
  document.addEventListener('click', (e) => {
    if (!sel.on || !e.target.closest) return;
    if (e.target.closest('#mx-selbar')) return;
    const tile = e.target.closest('#messages-container .mx-alb-tile[data-mid]');
    const msgEl = tile ? null : e.target.closest('#messages-container .msg[data-id]');
    if (tile || msgEl) { e.stopPropagation(); e.preventDefault(); selToggle(tile ? tile.dataset.mid : msgEl.dataset.id); return; }
    if (e.target.closest('#messages-container')) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel.on) selExit(); });
  // смена чата / выход из чата — выделение сбрасывается
  if (typeof window.openChat === 'function') { const _o = window.openChat; window.openChat = function () { if (sel.on) selExit(); return _o.apply(this, arguments); }; }
  if (typeof window.goTo === 'function') { const _g = window.goTo; window.goTo = function () { if (sel.on) selExit(); return _g.apply(this, arguments); }; }

  async function selCopy() {
    if (window.mxIsProtectedChat && window.mxIsProtectedChat()) { toast('Копирование запрещено в приватном чате'); return; }
    const parts = orderedSel().map((m) => (m.kind === 'TEXT' ? m.text : (m.kind === 'IMAGE' || m.kind === 'VIDEO' || m.kind === 'FILE') && m.text ? m.text : '')).filter(Boolean);
    if (!parts.length) { toast('Нечего копировать'); return; }
    const text = parts.join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      toast('Скопировано'); selExit();
    } catch (e) { toast('Не удалось скопировать'); }
  }
  function selForward() {
    if (window.mxIsProtectedChat && window.mxIsProtectedChat()) { toast('Пересылка запрещена в приватном чате'); return; }
    const list = orderedSel().filter((m) => !m.viewOnce && m.kind !== 'CALL');
    if (!list.length) { toast('Эти сообщения нельзя переслать'); return; }
    const skipped = sel.ids.size - list.length;
    const chs = (typeof chats !== 'undefined' ? chats : []);
    if (!chs.length) { toast('Нет чатов для пересылки'); return; }
    const scrim = document.createElement('div'); scrim.className = 'sheet active';
    scrim.onclick = (e) => { if (e.target === scrim) scrim.remove(); };
    scrim.innerHTML = '<div class="sheet-body"><div style="width:36px;height:4px;background:var(--surf2);border-radius:4px;margin:0 auto 18px"></div>'
      + '<div style="font-family:var(--font);font-size:18px;font-weight:800;margin-bottom:14px">Переслать в…</div>'
      + '<div style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px">'
      + chs.map((ch) => '<div class="mx-pick" data-cid="' + E(ch.id) + '"><div class="av">' + chatAvatarHtml(ch) + '</div><div class="nm">' + E(ch.name) + '</div></div>').join('') + '</div></div>';
    scrim.addEventListener('click', async (e) => {
      const row = e.target.closest('.mx-pick'); if (!row) return;
      scrim.remove();
      let ok = 0, fail = 0;
      for (const m of list) {                                      // по порядку, чтобы сохранилась хронология
        try { const saved = await MchatAPI.forward(m.id, row.dataset.cid); onIncomingMessage(saved); ok++; } catch (er) { fail++; }
      }
      selExit();
      toast(fail || skipped ? 'Переслано: ' + ok + '. Не удалось: ' + (fail + skipped) : ok > 1 ? 'Переслано: ' + ok : 'Переслано');
    });
    appEl().appendChild(scrim);
  }
  function askDelete(canAll, n, cb) {
    const m = document.createElement('div'); m.className = 'modal active'; m.style.zIndex = '1300';
    m.innerHTML = '<div class="modal-box"><h3>' + (n > 1 ? 'Удалить сообщения (' + n + ')?' : 'Удалить сообщение?') + '</h3>'
      + '<div class="mx-del-btns">' + (canAll ? '<button class="btn-danger" data-s="all">Удалить у всех</button>' : '')
      + '<button class="' + (canAll ? 'btn-sec' : 'btn-danger') + '" data-s="me">Удалить у меня</button><button class="btn-sec" data-s="">Отмена</button></div></div>';
    m.onclick = (e) => { if (e.target === m) m.remove(); const b = e.target.closest('button[data-s]'); if (!b) return; m.remove(); if (b.dataset.s) cb(b.dataset.s); };
    appEl().appendChild(m);
  }
  function selDelete() {
    const list = orderedSel(); if (!list.length) return;
    const canAll = list.every((m) => m.outgoing);                 // у всех удаляем только свои сообщения
    askDelete(canAll, list.length, async (scope) => {
      const chatId = curChat(); let fail = 0; const gone = new Set();
      const res = await Promise.allSettled(list.map((m) => MchatAPI.deleteMessage(m.id, scope)));
      res.forEach((r, i) => { if (r.status === 'fulfilled') gone.add(list[i].id); else fail++; });
      if (messages[chatId]) messages[chatId] = messages[chatId].filter((m) => !gone.has(m.id));
      selExit();
      if (curChat() === chatId) renderMessages(chatId);
      if (fail) toast('Не удалось удалить: ' + fail);
    });
  }

  /* — короткий тап: меню действий + панель быстрых реакций (как в Telegram) — */
  function placeStack(anchor, react, ctx) {
    if (!anchor || !react || !ctx || !react.isConnected || !ctx.isConnected) return;
    const host = appEl(), hr = host.getBoundingClientRect(), vv = window.visualViewport;
    const minTop = Math.max(hr.top, vv ? vv.offsetTop : 0) + 8, maxBot = Math.min(hr.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - 8;
    const r = anchor.getBoundingClientRect(), cx = r.left + r.width / 2;
    const rw = react.offsetWidth, rh = react.offsetHeight, cw = ctx.offsetWidth, ch = ctx.offsetHeight;
    const clampX = (w) => Math.min(Math.max(hr.left + 8, cx - w / 2), Math.max(hr.left + 8, hr.right - 8 - w));
    let rTop = r.top - rh - 6, cTop = r.bottom + 6;               // реакции над сообщением, меню — под ним
    if (cTop + ch > maxBot) {
      cTop = rTop - ch - 6;                                       // снизу не помещается — меню над реакциями
      if (cTop < minTop) {                                        // и так не помещается — центрируем пару по видимой части сообщения
        const mid = (Math.max(r.top, minTop) + Math.min(r.bottom, maxBot)) / 2, total = rh + ch + 6;
        rTop = mid - total / 2; cTop = rTop + rh + 6;
      }
    }
    if (rTop < minTop) { const d = minTop - rTop; rTop += d; cTop += d; }
    if (cTop + ch > maxBot) { const d = cTop + ch - maxBot; rTop -= d; cTop -= d; }
    const put = (el, x, y) => { el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.left = Math.round(x - hr.left) + 'px'; el.style.top = Math.round(y - hr.top) + 'px'; };
    put(react, clampX(rw), rTop); put(ctx, clampX(cw), cTop);
  }
  const _openReactions = window.mxOpenReactions;
  window.mxOpenReactions = function (id, evt) {
    if (sel.on) { selToggle(id); return; }
    const msg = findMsg(id);
    if (!msg || msg.pending) return;
    const anchor = evt && (evt.currentTarget || evt.target);
    let ctx = null;
    if (msg.kind !== 'CALL' && typeof window.mxOpenContextMenu === 'function') {
      window.mxOpenContextMenu(id, evt);                           // строит меню с учётом прав
      ctx = document.querySelector('#app > .mx-ctx') || document.querySelector('.mx-ctx');
      if (ctx) { const scr = document.querySelector('.mx-ctx-scrim'); ctx.remove(); if (scr) scr.remove(); }
    }
    _openReactions.call(this, id, evt);                            // скрим + панель реакций (с «+»)
    const react = document.querySelector('.mx-react');
    if (ctx) appEl().appendChild(ctx);
    if (react && ctx) { react._anchor = null; ctx._anchor = null; ctx._stack = { anchor, react }; placeStack(anchor, react, ctx); requestAnimationFrame(() => placeStack(anchor, react, ctx)); }
  };
  const restack = () => { const ctx = document.querySelector('.mx-ctx'); if (ctx && ctx._stack) placeStack(ctx._stack.anchor, ctx._stack.react, ctx); };
  if (window.visualViewport) visualViewport.addEventListener('resize', restack, { passive: true });
  window.addEventListener('resize', restack, { passive: true });

  // renderMessages: после отрисовки восстанавливаем отметки выбранных сообщений
  const _render5 = window.renderMessages;
  window.renderMessages = function () {
    const r = _render5.apply(this, arguments);
    try { if (sel.on) window.mxSelReapply(); } catch (e) { /* noop */ }
    try { window.mxRefreshTicks(); } catch (e) { /* noop */ }
    return r;
  };

  /* ═════════ 3. Панель ввода: смайлик, скрепка, кнопка «голос ⇄ кружок» ═════════ */
  window.mxComposerEmoji = function () {
    const old = $('mx-cemoji'); if (old) { old.remove(); return; }
    closeFloating();
    const sets = window.MX_EMOJI_SETS; if (!sets) { toast('Панель эмодзи недоступна'); return; }
    const sheet = document.createElement('div'); sheet.id = 'mx-cemoji'; sheet.className = 'mx-emoji-sheet mx-cemoji';
    sheet.innerHTML = '<div class="tabs">' + sets.map((s, i) => '<button type="button" data-i="' + i + '" class="' + (i === 0 ? 'on' : '') + '">' + s[0] + '</button>').join('') + '</div><div class="mx-emoji-grid" id="mx-cemoji-grid"></div>';
    const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
    const split = (s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));
    const grid = sheet.querySelector('#mx-cemoji-grid');
    const fill = (i) => { grid.innerHTML = split(sets[i][1]).map((e) => '<button type="button" data-e="' + e + '">' + e + '</button>').join(''); sheet.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', +b.dataset.i === i)); };
    fill(0);
    sheet.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) fill(+b.dataset.i); };
    grid.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const inp = $('message-input'); if (!inp) return;
      const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart, en = inp.selectionEnd == null ? s : inp.selectionEnd;
      inp.value = inp.value.slice(0, s) + b.dataset.e + inp.value.slice(en);
      const pos = s + b.dataset.e.length; try { inp.setSelectionRange(pos, pos); } catch (er) { /* noop */ }
      if (typeof mxOnComposeInput === 'function') mxOnComposeInput();
      try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (er) { /* noop */ }
    };
    (($('mx-input-row') && $('mx-input-row').parentNode) || appEl()).appendChild(sheet);
    const close = (e) => { if (!sheet.isConnected) { document.removeEventListener('pointerdown', close, true); return; } if (!sheet.contains(e.target) && !e.target.closest('#mx-emoji-btn')) { sheet.remove(); document.removeEventListener('pointerdown', close, true); } };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  };
  // кнопка записи: короткий тап переключает «голосовое ⇄ кружок», удержание записывает выбранный формат
  const modeKey = 'mchat_rec_mode';
  function applyMicMode(mode, animate) {
    const mic = $('mx-mic-btn'); if (!mic) return;
    mic.dataset.mode = mode;
    mic.title = mic.ariaLabel = mode === 'circle' ? 'Видеосообщение (кружок)' : 'Голосовое сообщение';
    mic.setAttribute('aria-label', mic.title);
    if (animate) { mic.classList.remove('flip'); void mic.offsetWidth; mic.classList.add('flip'); }
  }
  window.mxMicToggleMode = function () {
    const mic = $('mx-mic-btn'); if (!mic) return;
    const next = mic.dataset.mode === 'circle' ? 'voice' : 'circle';
    applyMicMode(next, true); vibrate(8);
    try { localStorage.setItem(modeKey, next); } catch (e) { /* noop */ }
  };
  function initComposer() {
    let saved = 'voice'; try { saved = localStorage.getItem(modeKey) === 'circle' ? 'circle' : 'voice'; } catch (e) { /* noop */ }
    applyMicMode(saved, false);
  }

  /* ═════════ 4. Кружок: запись по удержанию ═════════ */
  window.mxCircleStart = async function () {
    if (typeof mxCam !== 'undefined' && mxCam) return false;
    if (typeof mxCameraOpen !== 'function') return false;
    await mxCameraOpen();                                           // открывает камеру и ждёт поток
    if (typeof mxCam === 'undefined' || !mxCam || !mxCam.stream) return false;
    mxCameraStartRecording();
    return !!(mxCam && mxCam.recording);
  };
  window.mxCircleStop = function () {
    if (typeof mxCam === 'undefined' || !mxCam) return;
    if (!mxCam.recording) return;
    if (mxCam.elapsed < 1) { mxCameraClose(); toast('Слишком короткое видео'); return; }
    mxCameraStopRecording();                                        // откроется предпросмотр: отправить / переснять
  };
  window.mxCircleCancel = function () { if (typeof mxCam !== 'undefined' && mxCam) mxCameraClose(); };

  /* ═════════ 5. Звонки: сброс интерфейса и проверка смены камеры ═════════ */
  function resetCallUi() {
    ['call-screen', 'call-incoming'].forEach((id) => { const e = $(id); if (e) e.classList.remove('active', 'mx-swapped'); });
    const grid = $('call-grid'); if (grid) { grid.innerHTML = ''; grid.classList.remove('mx-pip', 'mx-dragging'); grid.style.left = grid.style.top = grid.style.right = grid.style.bottom = ''; grid.style.inset = '0'; }
    const self = $('call-self'); if (self) { try { self.pause && self.pause(); } catch (e) { /* noop */ } self.srcObject = null; self.style.display = 'none'; self.classList.remove('mx-fullscreen', 'mx-dragging'); }
    document.querySelectorAll('#call-add-modal, .mx-mask-panel.open').forEach((el) => { if (el.id === 'call-add-modal') el.remove(); else el.classList.remove('open'); });
    document.querySelectorAll('#call-screen video, #call-screen audio').forEach((el) => { try { el.pause(); } catch (e) { /* noop */ } try { const s = el.srcObject; if (s && s.getTracks) s.getTracks().forEach((t) => t.stop()); } catch (e) { /* noop */ } el.srcObject = null; });
    try { if (typeof mxIncoming !== 'undefined' && mxIncoming && typeof mxHideIncoming === 'function' && !(typeof mxCall !== 'undefined' && mxCall)) mxHideIncoming(); } catch (e) { /* noop */ }
    try { if (typeof mxRingStop === 'function' && !(typeof mxIncoming !== 'undefined' && mxIncoming)) mxRingStop(); } catch (e) { /* noop */ }
    try { if (window.__mxWakeLock) { window.__mxWakeLock.release(); window.__mxWakeLock = null; } } catch (e) { /* noop */ }
    document.documentElement.classList.remove('mx-in-call');
  }
  window.mxCallResetUi = resetCallUi;
  const _cleanup5 = window.mxCallCleanup;
  let cleaning = false;
  window.mxCallCleanup = function () {
    const active = typeof mxCall !== 'undefined' && !!mxCall;
    if (cleaning) return;
    if (!active) { resetCallUi(); return; }                         // звонка уже нет (второе событие о завершении) — только страховочный сброс
    cleaning = true;
    let r;
    try { r = _cleanup5.apply(this, arguments); } catch (e) { console.warn('[call] cleanup failed', e); } finally { cleaning = false; }
    try { resetCallUi(); } catch (e) { /* noop */ }
    // поздние события SDK (roomStateChanged и др.) не оставляют экран висеть; но если за эти 350 мс уже начался новый
    // звонок (повторный набор, входящий), сбрасывать нельзя — иначе таймер закроет экран нового звонка
    setTimeout(() => { try { if (!(typeof mxCall !== 'undefined' && mxCall) && !(typeof mxIncoming !== 'undefined' && mxIncoming)) resetCallUi(); } catch (e) { /* noop */ } }, 350);
    return r;
  };
  window.addEventListener('pagehide', () => { try { if (typeof mxCall !== 'undefined' && mxCall) window.mxCallCleanup('Звонок завершён'); } catch (e) { /* noop */ } });

  // смена камеры в звонке: проверяем, что реально включилась другая камера, а интерфейс показывает именно её
  const _flip5 = window.mxCallFlipCam;
  window.mxCallFlipCam = async function () {
    const call = typeof mxCall !== 'undefined' ? mxCall : null;
    const before = call && call.localStream && call.localStream.getVideoTracks()[0];
    const beforeId = before && before.getSettings && before.getSettings().deviceId;
    const r = await _flip5.apply(this, arguments);
    try {
      if (!call || !call.localStream || !beforeId || (window.MxMasks && MxMasks.active)) return r;
      await new Promise((res) => setTimeout(res, 350));
      const t = call.localStream.getVideoTracks()[0], now = t && t.getSettings && t.getSettings();
      if (now && now.deviceId && now.deviceId === beforeId && call.camOn) {
        const cams = (window.MxCamera ? await MxCamera.cameras() : []).filter((c) => c.deviceId !== beforeId);
        if (cams.length && call.zg && call.zg.useVideoDevice) {                 // вторая попытка: прямо по deviceId следующей камеры
          try { await call.zg.useVideoDevice(call.localStream, cams[0].deviceId); } catch (e) { toast('Не удалось переключить камеру'); }
        } else if (!cams.length) toast('Другой камеры на устройстве нет');
      }
      const t2 = call.localStream.getVideoTracks()[0];
      const f = window.MxCamera && t2 ? MxCamera.facingOf(t2) : null;       // что показываем — то и используется на самом деле
      if (f) { call.facing = f; const self = $('call-self'); if (self) self.style.transform = f === 'user' ? 'scaleX(-1)' : 'none'; }
    } catch (e) { /* проверка не критична */ }
    return r;
  };

  /* ═════════ 6. Одноразовые медиа: защита просмотра ═════════ */
  let wmTimer = null;
  function secureViewer(v) {
    if (!v || v._mxSecure) return; v._mxSecure = true;
    v.classList.add('mx-secure');
    const u = me(); const label = u ? '@' + (u.username || u.name || '') : '';
    const wm = document.createElement('div'); wm.className = 'mx-wm'; wm.setAttribute('aria-hidden', 'true');
    wm.innerHTML = Array.from({ length: 36 }, () => '<span>' + E(label) + '</span>').join('');
    v.appendChild(wm);
    ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut'].forEach((t) => v.addEventListener(t, (e) => e.preventDefault()));
    const hide = () => v.classList.add('mx-blank');
    const show = () => { if (!document.hidden) v.classList.remove('mx-blank'); };
    const onVis = () => { if (document.hidden) { hide(); try { const m = $('mx-once-media'); if (m && m.pause) m.pause(); } catch (e) { /* noop */ } } else show(); };
    const onBlur = () => hide(), onFocus = () => show();
    const onKey = (e) => {
      const k = e.key;
      const shot = k === 'PrintScreen' || ((e.metaKey || e.ctrlKey) && e.shiftKey && /^(3|4|5|s|S)$/.test(k));
      if (shot) { hide(); try { navigator.clipboard && navigator.clipboard.writeText(''); } catch (er) { /* noop */ } clearTimeout(wmTimer); wmTimer = setTimeout(show, 1800); }
    };
    const onPrint = () => hide();
    document.addEventListener('visibilitychange', onVis); window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPrint); window.addEventListener('beforeprint', onPrint); document.addEventListener('keyup', onKey, true); document.addEventListener('keydown', onKey, true);
    // при закрытии убираем обработчики и освобождаем медиа
    new MutationObserver(() => {
      if (v.isConnected) return;
      document.removeEventListener('visibilitychange', onVis); window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPrint); window.removeEventListener('beforeprint', onPrint); document.removeEventListener('keyup', onKey, true); document.removeEventListener('keydown', onKey, true);
      clearTimeout(wmTimer);
    }).observe(appEl(), { childList: true });
    if (document.hidden) hide();
  }
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.id === 'mx-once-viewer') secureViewer(n); });
  }).observe(document.body, { childList: true, subtree: true });

  /* ═════════ 7. Комментарии: ответы, лайки, упоминания ═════════ */
  const HEART = '<svg width="15" height="15" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
  const CTXS = {
    pv: { list: 'pv-comments', input: 'pv-comment-input', cur: () => pvCurrentId, rerender: () => window.pvRenderComments(), after: () => { try { renderFeed(); } catch (e) { /* noop */ } } },
    reels: { list: 'reels-comments-list', input: 'reels-comment-input', cur: () => reelsCurrentId, rerender: () => window.reelsRenderComments(), after: () => { /* счётчик в рилс обновляет сам рендер */ } },
  };
  const postOf = (key) => { const id = CTXS[key].cur(); try { return (posts || []).find((p) => p.id === id) || null; } catch (e) { return null; } };
  const replyState = { pv: null, reels: null };
  const initial = (c) => E(Array.from(String(c.name || c.username || '?'))[0] || '?').toUpperCase();
  const avatarHtml = (c) => (c.avatar && /^(https?:|\/|data:)/.test(c.avatar) ? '<img src="' + E(c.avatar) + '" alt="" referrerpolicy="no-referrer">' : '<span>' + initial(c) + '</span>');
  function linkify(c) {
    let t = E(c.text);
    (c.mentions || []).forEach((u) => { t = t.replace(new RegExp('(^|[^a-z0-9_])@(' + String(u).replace(/[^a-z0-9_]/gi, '') + ')(?![a-z0-9_])', 'gi'), (m, a, n) => a + '<a class="mx-mention" data-u="' + E(n.toLowerCase()) + '">@' + n + '</a>'); });
    return t;
  }
  const snippet = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 90) + '…' : s; };
  function commentHtml(c, key) {
    const quote = c.replyTo ? (c.replyTo.deleted
      ? '<div class="mx-cm-quote gone">Комментарий удалён</div>'
      : '<div class="mx-cm-quote" data-goto="' + c.replyTo.id + '"><b>@' + E(c.replyTo.username) + '</b><span>' + E(snippet(c.replyTo.text)) + '</span></div>') : '';
    return '<div class="mx-cm" id="mx-cm-' + key + '-' + c.id + '" data-cid="' + c.id + '" data-ctx="' + key + '">'
      + '<div class="mx-cm-av">' + avatarHtml(c) + '</div>'
      + '<div class="mx-cm-body"><div class="mx-cm-user">@' + E(c.username) + '</div>' + quote
      + '<div class="mx-cm-text">' + linkify(c) + '</div>'
      + '<div class="mx-cm-meta"><span>' + E(c.time || '') + '</span>' + (c.id ? '<button type="button" class="mx-cm-reply" data-a="reply">Ответить</button>' : '') + '</div></div>'
      + (c.id ? '<button type="button" class="mx-cm-like' + (c.liked ? ' on' : '') + '" data-a="like" aria-label="Нравится" aria-pressed="' + (c.liked ? 'true' : 'false') + '">' + HEART + '<b>' + (c.likes > 0 ? c.likes : '') + '</b></button>' : '')
      + '</div>';
  }
  function renderComments(key) {
    const p = postOf(key), el = $(CTXS[key].list); if (!p || !el) return;
    const cmts = Array.isArray(p.comments) ? p.comments : [];
    if (!cmts.length) { el.innerHTML = '<div style="color:var(--text2);font-size:13px">Пока нет комментариев. Будь первым!</div>'; return; }
    const top = el.scrollTop;
    el.innerHTML = cmts.map((c) => commentHtml(c, key)).join('');
    el.scrollTop = top;
  }
  window.pvRenderComments = function () { renderComments('pv'); ensureUi('pv'); startPoll('pv'); };
  window.reelsRenderComments = function () { renderComments('reels'); ensureUi('reels'); startPoll('reels'); };

  function ensureUi(key) {
    const input = $(CTXS[key].input); if (!input || input._mx5) return; input._mx5 = true;
    const row = input.parentElement;
    const bar = document.createElement('div'); bar.className = 'mx-cm-replybar'; bar.id = 'mx-cm-replybar-' + key; bar.style.display = 'none';
    bar.innerHTML = '<div class="mx-rb-txt"></div><button type="button" aria-label="Отменить ответ" title="Отменить ответ">' + SEL_ICO.x + '</button>';
    bar.querySelector('button').onclick = () => setReply(key, null);
    row.parentNode.insertBefore(bar, row);
    const dd = document.createElement('div'); dd.className = 'mx-mention-list'; dd.id = 'mx-mention-' + key; dd.style.display = 'none';
    row.style.position = 'relative'; row.appendChild(dd);
    input.setAttribute('maxlength', '500'); input.setAttribute('autocomplete', 'off');
    ['input', 'click', 'keyup'].forEach((t) => input.addEventListener(t, () => mentionUpdate(key)));
    input.addEventListener('keydown', (e) => mentionKey(e, key), true);
    input.addEventListener('blur', () => setTimeout(() => mentionHide(key), 150));
  }
  function setReply(key, r) {
    replyState[key] = r;
    const bar = $('mx-cm-replybar-' + key); if (!bar) return;
    bar.style.display = r ? 'flex' : 'none';
    if (r) bar.querySelector('.mx-rb-txt').innerHTML = '<b>Ответ @' + E(r.username) + '</b><span>' + E(snippet(r.text)) + '</span>';
  }
  async function sendComment(key) {
    const input = $(CTXS[key].input), p = postOf(key); if (!input || !p) return;
    const text = input.value.trim(); if (!text || input._sending) return;
    input._sending = true;
    try {
      const r = await MchatAPI.commentPost(p.id, text, replyState[key] ? replyState[key].id : undefined);
      if (!Array.isArray(p.comments)) p.comments = [];
      if (!p.comments.some((c) => c.id === r.comment.id)) p.comments.push(commentFromServer(r.comment));
      input.value = ''; setReply(key, null); mentionHide(key);
      CTXS[key].rerender(); CTXS[key].after();
      const el = $(CTXS[key].list); if (el) el.scrollTop = el.scrollHeight;
      toast('Комментарий отправлен');
    } catch (e) {
      if (e && /comment_not_found/.test(e.code || e.message || '')) { setReply(key, null); toast('Комментарий, на который вы отвечаете, больше не существует'); }
      else toast(MchatAPI.errorText(e));
    } finally { input._sending = false; }
  }
  window.pvSendComment = () => sendComment('pv');
  window.reelsSendComment = () => sendComment('reels');
  document.addEventListener('keydown', (e) => {                      // у рилс-поля не было отправки по Enter
    if (e.key === 'Enter' && !e.shiftKey && e.target && e.target.id === 'reels-comment-input' && !e.defaultPrevented) { e.preventDefault(); sendComment('reels'); }
  });

  async function toggleLike(key, cid, btn) {
    const p = postOf(key); if (!p) return;
    const c = (p.comments || []).find((x) => x.id === cid); if (!c || c._busy) return;
    c._busy = true;
    const prev = { liked: !!c.liked, likes: c.likes || 0 };
    c.liked = !prev.liked; c.likes = Math.max(0, prev.likes + (c.liked ? 1 : -1));      // сразу показываем результат
    renderComments(key);
    try {
      const r = await MchatAPI.likeComment(p.id, cid, c.liked);
      c.liked = !!r.liked; c.likes = r.likes;                                          // истина — счётчик сервера (повторное нажатие не накручивает)
    } catch (e) { c.liked = prev.liked; c.likes = prev.likes; toast(MchatAPI.errorText(e)); }
    finally { c._busy = false; renderComments(key); }
  }
  document.addEventListener('click', (e) => {
    const t = e.target; if (!t.closest) return;
    const cm = t.closest('.mx-cm'); if (!cm) return;
    const key = cm.dataset.ctx, cid = +cm.dataset.cid;
    const men = t.closest('.mx-mention');
    if (men) { e.preventDefault(); try { openUserProfile(men.dataset.u); } catch (er) { /* noop */ } return; }
    const q = t.closest('.mx-cm-quote[data-goto]');
    if (q) { const target = $('mx-cm-' + key + '-' + q.dataset.goto); if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('mx-flash'); setTimeout(() => target.classList.remove('mx-flash'), 1300); } return; }
    const a = t.closest('button[data-a]'); if (!a) return;
    if (a.dataset.a === 'like') toggleLike(key, cid, a);
    else if (a.dataset.a === 'reply') {
      const p = postOf(key), c = p && (p.comments || []).find((x) => x.id === cid); if (!c) return;
      setReply(key, { id: c.id, username: c.username, text: c.text });
      const input = $(CTXS[key].input); if (input) input.focus();
    }
  });

  // синхронизация между пользователями: пока список открыт, раз в 8 секунд подтягиваем свежие комментарии и лайки
  const pollers = {};
  function startPoll(key) {
    if (pollers[key]) return;
    pollers[key] = setInterval(async () => {
      const el = $(CTXS[key].list), p = postOf(key);
      if (!el || !p || document.hidden || !el.offsetParent) { if (!el || !el.offsetParent) { clearInterval(pollers[key]); pollers[key] = null; } return; }
      try {
        const r = await MchatAPI.getPost(p.id); if (!r || !r.post) return;
        const np = postFromServer(r.post);
        const sig = (a) => JSON.stringify((a || []).map((c) => [c.id, c.likes, c.liked, c.text]));
        if (sig(np.comments) !== sig(p.comments) && !(p.comments || []).some((c) => c._busy)) { p.comments = np.comments; renderComments(key); }
      } catch (e) { /* сеть пропала — повторим в следующий раз */ }
    }, 8000);
  }

  /* — @упоминания — */
  const cand = {};                                  // postId → список кандидатов (грузим один раз, фильтруем на клиенте)
  const mState = { pv: { items: [], idx: 0, range: null }, reels: { items: [], idx: 0, range: null } };
  function tokenAt(input) {
    const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
    const m = /(^|[\s(])@([a-z0-9_]{0,20})$/i.exec(input.value.slice(0, pos));
    return m ? { q: m[2].toLowerCase(), start: pos - m[2].length - 1, end: pos } : null;
  }
  async function loadCand(p) {
    if (cand[p.id] && Date.now() - cand[p.id].at < 60000) return cand[p.id].list;
    try { const r = await MchatAPI.mentionCandidates(p.id, ''); cand[p.id] = { at: Date.now(), list: r.users || [] }; } catch (e) { cand[p.id] = { at: Date.now(), list: [] }; }
    return cand[p.id].list;
  }
  async function mentionUpdate(key) {
    const input = $(CTXS[key].input), p = postOf(key); if (!input || !p) return;
    const tok = tokenAt(input);
    if (!tok) { mentionHide(key); return; }
    const list = await loadCand(p);
    const tok2 = tokenAt(input); if (!tok2) { mentionHide(key); return; }              // пока грузили — текст мог измениться
    const items = list.filter((u) => !tok2.q || u.username.indexOf(tok2.q) === 0 || u.username.indexOf(tok2.q) > 0 || (u.name || '').toLowerCase().indexOf(tok2.q) >= 0)
      .sort((a, b) => (a.username.indexOf(tok2.q) === 0 ? 0 : 1) - (b.username.indexOf(tok2.q) === 0 ? 0 : 1)).slice(0, 6);
    if (!items.length) { mentionHide(key); return; }
    const st = mState[key]; st.items = items; st.idx = Math.min(st.idx, items.length - 1); st.range = tok2;
    const dd = $('mx-mention-' + key); if (!dd) return;
    dd.innerHTML = items.map((u, i) => '<div class="mx-mn' + (i === st.idx ? ' on' : '') + '" data-i="' + i + '"><div class="mx-cm-av">' + avatarHtml(u) + '</div><div class="mx-mn-who"><b>' + E(u.name || u.username) + '</b><span>@' + E(u.username) + '</span></div></div>').join('');
    dd.style.display = 'block';
    dd.onpointerdown = (e) => { const it = e.target.closest('.mx-mn'); if (!it) return; e.preventDefault(); mentionPick(key, +it.dataset.i); };
  }
  function mentionHide(key) { const dd = $('mx-mention-' + key); if (dd) dd.style.display = 'none'; mState[key].items = []; mState[key].range = null; }
  function mentionPick(key, i) {
    const input = $(CTXS[key].input), st = mState[key], u = st.items[i]; if (!input || !u || !st.range) return;
    const ins = '@' + u.username + ' ';
    input.value = input.value.slice(0, st.range.start) + ins + input.value.slice(st.range.end);
    const pos = st.range.start + ins.length; input.focus(); try { input.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    mentionHide(key);
  }
  function mentionKey(e, key) {
    const st = mState[key], dd = $('mx-mention-' + key);
    if (!dd || dd.style.display === 'none' || !st.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); st.idx = (st.idx + (e.key === 'ArrowDown' ? 1 : -1) + st.items.length) % st.items.length; dd.querySelectorAll('.mx-mn').forEach((n, i) => n.classList.toggle('on', i === st.idx)); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); mentionPick(key, st.idx); }   // Enter выбирает, а не отправляет
    else if (e.key === 'Escape') { e.preventDefault(); mentionHide(key); }
  }

  /* ═════════ init ═════════ */
  function init() { initComposer(); selBar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();