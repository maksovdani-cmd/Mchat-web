/* ============================================================
   Mchat · серия 4 (подключается ПОСЛЕ mchat-fixes.js).
   1. Реакции: мини-аватарки, счётчик, список «кто поставил» по долгому нажатию
   2. Просмотр фото: меню ⋮ (Поделиться / Показать в чате / Сделать стикер) + редактор стикеров
   3. Кнопка «Скачать» — только внутри чатов при просмотре фото/видео
   4. Долгое нажатие на сообщение (iOS/Android/мышь) → меню удаления; «Очистить чат» в меню ⋮
   5. Голосовые: фиксация свайпом вверх, круги на воде, волна из вертикальных палочек
   6. Альбомы: несколько фото/видео → один блок, просмотр с листанием и скачиванием по одному
   7. Фикс прыжков прокрутки и позиционирования контекстных меню (клавиатура)
   ============================================================ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (m) => { try { (window.showToast || console.log)(m); } catch (e) { /* noop */ } };
  const E = (s) => (typeof window.esc === 'function' ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const msgsOf = (id) => { try { return (messages && messages[id]) || []; } catch (e) { return []; } };
  const curChat = () => { try { return currentChatId; } catch (e) { return null; } };
  const me = () => { try { return currentUser || null; } catch (e) { return null; } };
  const findMsg = (mid) => msgsOf(curChat()).find((m) => m.id === mid || m.clientId === mid);
  const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* noop */ } };
  const closeFloating = () => { try { window.mxCloseFloating && window.mxCloseFloating(); } catch (e) { /* noop */ } };
  const appEl = () => $('app') || document.body;
  const hash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* ═════════ 7. Позиционирование меню: строго по центру над сообщением, внутри видимой области (клавиатура) ═════════ */
  function placePanel(panel) {
    const el = panel._anchor; if (!el || !panel.isConnected) return;
    const host = panel.offsetParent || appEl();
    const hr = host.getBoundingClientRect();
    const vv = window.visualViewport;
    // видимая область: приложение уже ужато под клавиатуру (--app-h), но на всякий случай пересекаем с visualViewport
    let minTop = Math.max(hr.top, vv ? vv.offsetTop : 0) + 8;
    let maxBot = Math.min(hr.bottom, vv ? vv.offsetTop + vv.height : innerHeight) - 8;
    const minLeft = hr.left + 8, maxRight = hr.right - 8;
    const r = el.getBoundingClientRect();
    const pw = panel.offsetWidth || 240, ph = panel.offsetHeight || 56;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.min(Math.max(minLeft, left), Math.max(minLeft, maxRight - pw));
    let top = r.top - ph - 8;                                   // 1) над сообщением
    if (top < minTop) top = r.bottom + 8;                       // 2) под ним
    if (top + ph > maxBot) {                                    // 3) не помещается — центрируем по видимой части сообщения
      const vt = Math.max(r.top, minTop), vb = Math.min(r.bottom, maxBot);
      top = (vt + vb) / 2 - ph / 2;
    }
    top = Math.min(Math.max(minTop, top), Math.max(minTop, maxBot - ph));
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    panel.style.left = Math.round(left - hr.left) + 'px';
    panel.style.top = Math.round(top - hr.top) + 'px';
  }
  window.mxPositionNear = function (el, panel) {
    if (!el || !panel) return;
    panel._anchor = el;
    placePanel(panel);
    requestAnimationFrame(() => placePanel(panel));
  };
  const repositionOpen = () => document.querySelectorAll('.mx-ctx,.mx-react').forEach((p) => { if (p._anchor) placePanel(p); });
  if (window.visualViewport) visualViewport.addEventListener('resize', repositionOpen, { passive: true });
  window.addEventListener('resize', repositionOpen, { passive: true });

  /* ═════════ 7. Прокрутка: не «кидает» вниз при реакции/удалении медиа ═════════ */
  const lastCount = {};
  let freshId = null;
  if (typeof window.openChat === 'function') {
    const _open = window.openChat;
    window.openChat = async function (id) {
      freshId = id; lastCount[id] = undefined;
      try { return await _open.apply(this, arguments); } finally { setTimeout(() => { if (freshId === id) freshId = null; }, 0); }
    };
  }
  const _render = window.renderMessages;
  window.renderMessages = function (id) {
    const c = $('messages-container');
    if (!c || typeof _render !== 'function') return _render && _render.apply(this, arguments);
    const list = msgsOf(id);
    const fresh = freshId === id || c.dataset.mxChat !== id || !c.firstElementChild;
    let near = true, anchor = null;
    if (!fresh) {
      near = c.scrollHeight - c.scrollTop - c.clientHeight < 160;
      if (!near) {
        const cr = c.getBoundingClientRect();
        for (const el of c.querySelectorAll('.msg[data-id]')) {
          if (el.style.display === 'none') continue;
          const r = el.getBoundingClientRect();
          if (r.bottom > cr.top + 4) { anchor = { id: el.dataset.id, off: r.top - cr.top }; break; }
        }
      }
    }
    const prev = lastCount[id], last = list[list.length - 1];
    const ownSend = !!(last && last.outgoing && prev !== undefined && list.length > prev);
    const out = _render.apply(this, arguments);
    c.dataset.mxChat = id; lastCount[id] = list.length;
    try { buildAlbums(c, id); } catch (e) { console.warn('albums', e); }
    try { decorateVoices(c); } catch (e) { console.warn('voices', e); }
    if (fresh || near || ownSend) c.scrollTop = c.scrollHeight;
    else if (anchor) {
      const el2 = c.querySelector('.msg[data-id="' + CSS.escape(anchor.id) + '"]');
      if (el2 && el2.style.display !== 'none') { c.scrollTop += (el2.getBoundingClientRect().top - c.getBoundingClientRect().top) - anchor.off; }
    }
    return out;
  };

  /* ═════════ 1. Реакции с мини-аватарками ═════════ */
  const GRADS = ['#6c6cf5,#9b5cf6', '#f59e0b,#ef4444', '#10b981,#06b6d4', '#ec4899,#8b5cf6', '#3b82f6,#06b6d4', '#f97316,#eab308'];
  const grad = (id) => 'linear-gradient(135deg,' + GRADS[hash(id || '?') % GRADS.length] + ')';
  const firstChar = (s) => { const a = Array.from(String(s || '').trim()); return (a[0] || '?').toUpperCase(); };
  function avEl(u, cls) {
    const a = u && u.avatar;
    if (a && /^(https?:|\/|data:|blob:)/.test(a)) return '<img class="' + cls + '" src="' + E(a) + '" referrerpolicy="no-referrer" alt="">';
    return '<span class="' + cls + ' fb" style="background:' + grad(u && u.id) + '">' + E(firstChar((u && (u.name || u.username)) || '?')) + '</span>';
  }
  function reactionUsers(r) {
    if (r.users && r.users.length) return r.users;
    const u = me();
    return (r.userIds || []).map((uid) => (u && uid === u.id ? { id: uid, name: u.name, username: u.username, avatar: u.avatar } : { id: uid, name: '', username: '', avatar: null }));
  }
  window.reactionsHtml = function (m) {
    if (!m.reactions || !m.reactions.length) return '';
    const u0 = me(), mine = u0 && u0.id;
    return '<div class="mx-reactions">' + m.reactions.map((r) => {
      const us = reactionUsers(r), n = (r.userIds || []).length;
      const avs = us.slice(0, 4).map((u) => avEl(u, 'mx-rav')).join('');
      const showN = n > 1 || !(r.users && r.users.length);
      return '<span class="mx-chip' + (r.userIds.includes(mine) ? ' mine' : '') + '" data-mid="' + E(m.id) + '" data-emoji="' + E(r.emoji) + '" onclick="event.stopPropagation();mxPickReaction(\'' + E(m.id) + '\',\'' + E(r.emoji) + '\')">'
        + '<span class="mx-remo">' + r.emoji + '</span>' + (avs ? '<span class="mx-ravs">' + avs + '</span>' : '') + (showN ? '<b>' + n + '</b>' : '') + '</span>';
    }).join('') + '</div>';
  };
  window.mxReactionList = function (mid, emoji) {
    closeFloating(); const old = $('mx-rl'); if (old) old.remove();
    const msg = findMsg(mid); if (!msg || !msg.reactions || !msg.reactions.length) return;
    let tab = emoji && msg.reactions.some((r) => r.emoji === emoji) ? emoji : 'all';
    const wrap = document.createElement('div');
    wrap.id = 'mx-rl'; wrap.className = 'mx-rl-scrim';
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    const total = msg.reactions.reduce((s, r) => s + (r.userIds || []).length, 0);
    const draw = () => {
      const tabs = '<button class="mx-rl-tab' + (tab === 'all' ? ' on' : '') + '" data-t="all">Все <b>' + total + '</b></button>'
        + msg.reactions.map((r) => '<button class="mx-rl-tab' + (tab === r.emoji ? ' on' : '') + '" data-t="' + E(r.emoji) + '">' + r.emoji + ' <b>' + (r.userIds || []).length + '</b></button>').join('');
      const rows = [];
      msg.reactions.forEach((r) => { if (tab === 'all' || tab === r.emoji) reactionUsers(r).forEach((u) => rows.push({ u, e: r.emoji })); });
      wrap.innerHTML = '<div class="mx-rl"><div class="mx-rl-grip"></div><div class="mx-rl-tabs">' + tabs + '</div><div class="mx-rl-list">'
        + (rows.map((x) => '<div class="mx-rl-row">' + avEl(x.u, 'mx-rl-av') + '<div class="mx-rl-who"><div class="mx-rl-name">' + E(x.u.name || x.u.username || 'Пользователь') + '</div>'
          + (x.u.username ? '<div class="mx-rl-un">@' + E(x.u.username) + '</div>' : '') + '</div><span class="mx-rl-emo">' + x.e + '</span></div>').join('') || '<div class="mx-rl-empty">Нет данных</div>')
        + '</div></div>';
      wrap.querySelectorAll('.mx-rl-tab').forEach((b) => { b.onclick = () => { tab = b.dataset.t; draw(); }; });
    };
    draw();
    appEl().appendChild(wrap);
  };

  /* ═════════ 4. Долгое нажатие (сообщение / реакция / плитка альбома) ═════════ */
  let lpT = null, lpFired = 0, lpX = 0, lpY = 0;
  const lpClear = () => { clearTimeout(lpT); lpT = null; };
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !e.target.closest) return;
    const chip = e.target.closest('.mx-chip[data-mid]');
    const tile = !chip && e.target.closest('.mx-alb-tile[data-mid]');
    const msgEl = !chip && e.target.closest('#messages-container .msg[data-id]');
    if (!chip && !tile && !msgEl) return;
    if (!chip && e.target.closest('a,input,textarea,.mx-callmsg')) return;
    const vid = e.target.closest('video.mx-video');
    if (vid) { const r = vid.getBoundingClientRect(); if (e.clientY - r.top > r.height * 0.65) return; } // не мешаем нативной полосе управления
    lpClear(); lpX = e.clientX; lpY = e.clientY;
    const target = chip || tile || msgEl;
    lpT = setTimeout(() => {
      lpT = null; lpFired = Date.now(); vibrate(12);
      if (chip) window.mxReactionList(chip.dataset.mid, chip.dataset.emoji);
      else {
        const id = tile ? tile.dataset.mid : msgEl.dataset.id;
        if (typeof window.mxSelPress === 'function') window.mxSelPress(id);
        else if (typeof window.mxOpenContextMenu === 'function') window.mxOpenContextMenu(id, { currentTarget: tile || msgEl, target: tile || msgEl });
      }
    }, 450);
    target._lp = true;
  }, true);
  document.addEventListener('pointermove', (e) => { if (lpT && Math.hypot(e.clientX - lpX, e.clientY - lpY) > 10) lpClear(); }, true);
  ['pointerup', 'pointercancel', 'scroll'].forEach((t) => document.addEventListener(t, lpClear, true));
  // после срабатывания долгого нажатия «проглатываем» клик и системное контекстное меню
  ['click', 'contextmenu'].forEach((t) => document.addEventListener(t, (e) => {
    if (Date.now() - lpFired < 700) { e.stopImmediatePropagation(); e.stopPropagation(); e.preventDefault(); return; }   // клик после долгого нажатия не должен сработать как короткий тап
    if (t === 'contextmenu') {
      const chip = e.target.closest && e.target.closest('.mx-chip[data-mid]');
      if (chip) { e.stopPropagation(); e.preventDefault(); window.mxReactionList(chip.dataset.mid, chip.dataset.emoji); }
    }
  }, true));

  /* ═════════ 4/5. «Очистить чат» в меню ⋮ + исправление падения меню ═════════ */
  window.mxClearChat = function (id) {
    closeFloating();
    const ch = (typeof chats !== 'undefined' ? chats : []).find((c) => c.id === id); if (!ch) return;
    window.showConfirm('Очистить всю переписку в этом чате? Сообщения исчезнут только у вас.', async () => {
      try {
        await MchatAPI.clearChat(id);
        messages[id] = [];
        ch.lastMessage = ''; ch.unread = 0;
        if (curChat() === id) window.renderMessages(id);
        try { window.renderChats(''); } catch (e) { /* noop */ }
        toast('Чат очищен');
      } catch (e) { toast(MchatAPI.errorText(e)); }
    });
  };
  const _extra = window.mxChatMenuExtra;
  window.mxChatMenuExtra = function (ch) {
    let r;
    try { r = _extra ? _extra.apply(this, arguments) : (ch ? '' : []); } catch (e) { r = ch ? '' : []; }
    if (ch) return r;                           // долгое нажатие в списке чатов — без изменений
    const id = curChat(); if (!id) return r;
    const out = Array.isArray(r) ? r.slice() : [r];
    const ICO = (window.MX_ICO && window.MX_ICO.del) || '';
    out.unshift(window.mxCtxItem(STK_ICO, 'Мои стикеры', 'mxStickerSheet()'));
    out.push(window.mxCtxItem(ICO, 'Очистить чат', "mxClearChat('" + E(id) + "')", true));
    return out;
  };

  /* ═════════ 3. «Скачать» — только внутри чатов ═════════ */
  function cleanDownloadButtons() {
    ['post-viewer', 'foreign-post-viewer', 'story-viewer'].forEach((id) => { const ov = $(id); if (ov) ov.querySelectorAll('.mx-dl-btn').forEach((b) => b.remove()); });
    document.querySelectorAll('.mx-dl-reel').forEach((b) => b.remove());
  }
  document.addEventListener('DOMContentLoaded', () => { cleanDownloadButtons(); setTimeout(cleanDownloadButtons, 600); });
  cleanDownloadButtons();

  /* ═════════ 2. Просмотр фото: меню ⋮ ═════════ */
  const MORE_ICO = '<svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>';
  const SHARE_ICO = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>';
  const CHAT_ICO = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
  const STK_ICO = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15.5 3H6a3 3 0 00-3 3v12a3 3 0 003 3h12a3 3 0 003-3V9.5z"/><path d="M15 3v4a2 2 0 002 2h4"/><path d="M9 14s1 1.6 3 1.6 3-1.6 3-1.6M9 11h.01M15 11h.01"/></svg>';
  const curUrl = () => { try { return mxGallery.urls[mxGallery.i] || ''; } catch (e) { return ''; } };
  function injectViewerMenu() {
    const ov = $('avatar-fullscreen'); if (!ov || ov.querySelector('.mx-vw-more')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mx-vw-more'; b.title = 'Ещё'; b.setAttribute('aria-label', 'Ещё'); b.innerHTML = MORE_ICO;
    const menu = document.createElement('div'); menu.className = 'mx-vw-menu';
    menu.innerHTML = '<button type="button" data-a="share">' + SHARE_ICO + '<span>Поделиться</span></button>'
      + '<button type="button" data-a="show">' + CHAT_ICO + '<span>Показать в чате</span></button>'
      + '<button type="button" data-a="sticker">' + STK_ICO + '<span>Сделать стикер</span></button>';
    const stop = (e) => e.stopPropagation();
    b.addEventListener('pointerdown', stop);
    b.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    menu.addEventListener('pointerdown', stop);
    menu.onclick = async (e) => {
      e.stopPropagation();
      const a = e.target.closest('button[data-a]'); if (!a) return;
      menu.classList.remove('open');
      const url = curUrl();
      if (a.dataset.a === 'share') shareUrl(url);
      else if (a.dataset.a === 'show') showInChat(url);
      else if (a.dataset.a === 'sticker') { const u = url; closeViewer(); openSticker(u); }
    };
    ov.appendChild(b); ov.appendChild(menu);
    new MutationObserver(() => {
      if (!ov.classList.contains('active')) { delete ov.dataset.chat; menu.classList.remove('open'); }
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  }
  function closeViewer() { const ov = $('avatar-fullscreen'); if (ov) { ov.classList.remove('active'); delete ov.dataset.chat; } try { mxGallery.urls = []; } catch (e) { /* noop */ } }
  const _openImage = window.mxOpenImage;
  window.mxOpenImage = function (url) {
    _openImage.apply(this, arguments);
    const ov = $('avatar-fullscreen'); if (!ov) return;
    const inChat = msgsOf(curChat()).some((m) => m.kind === 'IMAGE' && m.mediaUrl === url);
    if (inChat) ov.dataset.chat = '1'; else delete ov.dataset.chat;
    const mn = ov.querySelector('.mx-vw-menu'); if (mn) mn.classList.remove('open');
  };
  const absUrl = (u) => { try { return new URL(u, location.href).href; } catch (e) { return u; } };
  async function shareUrl(url) {
    if (!url) return;
    try {
      const r = await fetch(url, { credentials: 'include' });
      const blob = await r.blob();
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[blob.type] || 'jpg';
      const f = new File([blob], 'mchat-' + Date.now() + '.' + ext, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    if (navigator.share) { try { await navigator.share({ url: absUrl(url) }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(absUrl(url)); toast('Ссылка скопирована'); } catch (e) { toast('Не удалось поделиться'); }
  }
  function showInChat(url) {
    const m = msgsOf(curChat()).find((x) => x.mediaUrl === url);
    closeViewer();
    const im = $('mx-info-modal'); if (im) im.remove();
    if (!m) { toast('Сообщение не найдено'); return; }
    setTimeout(() => {
      const el = document.querySelector('#messages-container .mx-alb-tile[data-mid="' + CSS.escape(m.id) + '"]') || document.querySelector('#messages-container .msg[data-id="' + CSS.escape(m.id) + '"]');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('mx-flash'); setTimeout(() => el.classList.remove('mx-flash'), 1400);
    }, 120);
  }

  /* ═════════ 2. Редактор стикеров ═════════ */
  const STK_FONTS = [['Impact', 'Impact, "Arial Black", sans-serif'], ['Comic', '"Comic Sans MS", "Comic Neue", cursive'], ['Georgia', 'Georgia, "Times New Roman", serif'], ['Courier', '"Courier New", monospace'], ['Обычный', 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Color Emoji", sans-serif']];
  const STK_COLORS = ['#ffffff', '#111111', '#ffd60a', '#ff3b30', '#0a84ff', '#30d158', '#ff2d92'];
  function idb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open('mchat-stickers', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('st', { keyPath: 'id' });
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  const uidKey = () => { const u = me(); return u ? u.id : 'anon'; };
  async function stkAll() {
    const db = await idb();
    return new Promise((res) => { const r = db.transaction('st').objectStore('st').getAll(); r.onsuccess = () => res((r.result || []).filter((x) => x.uid === uidKey()).sort((a, b) => b.ts - a.ts)); r.onerror = () => res([]); });
  }
  async function stkPut(blob) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('st', 'readwrite'); t.objectStore('st').put({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), uid: uidKey(), ts: Date.now(), blob }); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }
  async function stkDel(id) {
    const db = await idb();
    return new Promise((res) => { const t = db.transaction('st', 'readwrite'); t.objectStore('st').delete(id); t.oncomplete = () => res(); t.onerror = () => res(); });
  }
  async function loadImage(src) {
    const mk = (u, cors) => new Promise((res, rej) => { const im = new Image(); if (cors) im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = rej; im.src = u; });
    if (/^(blob:|data:)/.test(src)) return mk(src, false);
    try { const r = await fetch(src, { credentials: 'include' }); const b = await r.blob(); return await mk(URL.createObjectURL(b), false); }
    catch (e) { return mk(src, true); }
  }
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  async function openSticker(src) {
    if (!src) return;
    let img;
    try { img = await loadImage(src); } catch (e) { toast('Не удалось открыть фото'); return; }
    const old = $('mx-stk'); if (old) old.remove();
    const S = { text: '', font: 0, size: 64, color: 0, stroke: true, bold: true, fit: false, tx: 256, ty: 420 };
    const ov = document.createElement('div'); ov.id = 'mx-stk'; ov.className = 'mx-stk';
    ov.innerHTML = '<div class="mx-stk-top"><button type="button" class="mx-stk-x" data-a="close" title="Закрыть" aria-label="Закрыть"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button><div class="mx-stk-ttl">Стикер</div><span style="width:40px"></span></div>'
      + '<div class="mx-stk-stage"><canvas id="mx-stk-cv" width="512" height="512"></canvas></div>'
      + '<div class="mx-stk-hint">Перетащите текст пальцем</div>'
      + '<div class="mx-stk-ctl">'
      + '<textarea id="mx-stk-txt" rows="2" maxlength="80" placeholder="Текст на стикере"></textarea>'
      + '<div class="mx-stk-row"><span>Шрифт</span><select id="mx-stk-font">' + STK_FONTS.map((f, i) => '<option value="' + i + '">' + f[0] + '</option>').join('') + '</select></div>'
      + '<div class="mx-stk-row"><span>Размер</span><input type="range" id="mx-stk-size" min="20" max="140" value="64"></div>'
      + '<div class="mx-stk-row"><span>Цвет</span><div class="mx-stk-colors">' + STK_COLORS.map((c, i) => '<button type="button" class="' + (i === 0 ? 'on' : '') + '" data-c="' + i + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') + '</div></div>'
      + '<div class="mx-stk-row chk"><label><input type="checkbox" id="mx-stk-stroke" checked> <span>Контур</span></label><label><input type="checkbox" id="mx-stk-bold" checked> <span>Жирный</span></label><label><input type="checkbox" id="mx-stk-fit"> <span>Без обрезки</span></label></div>'
      + '<div class="mx-stk-acts"><button type="button" data-a="save">Сохранить</button><button type="button" data-a="dl">Скачать</button><button type="button" class="pri" data-a="send">Отправить</button></div></div>';
    appEl().appendChild(ov);
    const cv = $('mx-stk-cv'), g = cv.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, 512, 512);
      g.save(); rrect(g, 0, 0, 512, 512, 64); g.clip();
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const k = S.fit ? Math.min(512 / iw, 512 / ih) : Math.max(512 / iw, 512 / ih);
      g.drawImage(img, (512 - iw * k) / 2, (512 - ih * k) / 2, iw * k, ih * k);
      g.restore();
      const lines = S.text.split('\n').filter((l, i) => l.length || i === 0);
      if (!S.text.trim()) return;
      let size = S.size; const fam = STK_FONTS[S.font][1];
      const setFont = (s) => { g.font = (S.bold ? '800 ' : '500 ') + s + 'px ' + fam; };
      setFont(size);
      const widest = Math.max.apply(null, lines.map((l) => g.measureText(l).width));
      if (widest > 480) { size = Math.max(14, size * 480 / widest); setFont(size); }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const col = STK_COLORS[S.color], lh = size * 1.12, y0 = S.ty - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => {
        const y = y0 + i * lh;
        if (S.stroke) { g.lineWidth = Math.max(4, size / 5); g.strokeStyle = (col === '#111111') ? '#ffffff' : '#000000'; g.strokeText(l, S.tx, y); }
        g.fillStyle = col; g.fillText(l, S.tx, y);
      });
    };
    draw();
    const bind = (id, ev, fn) => $(id).addEventListener(ev, fn);
    bind('mx-stk-txt', 'input', (e) => { S.text = e.target.value; draw(); });
    bind('mx-stk-font', 'change', (e) => { S.font = +e.target.value; draw(); });
    bind('mx-stk-size', 'input', (e) => { S.size = +e.target.value; draw(); });
    bind('mx-stk-stroke', 'change', (e) => { S.stroke = e.target.checked; draw(); });
    bind('mx-stk-bold', 'change', (e) => { S.bold = e.target.checked; draw(); });
    bind('mx-stk-fit', 'change', (e) => { S.fit = e.target.checked; draw(); });
    ov.querySelector('.mx-stk-colors').onclick = (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; S.color = +b.dataset.c; ov.querySelectorAll('.mx-stk-colors button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    let drag = null;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * 512 / r.width, y: (e.clientY - r.top) * 512 / r.height }; };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); const p = pt(e); drag = { dx: S.tx - p.x, dy: S.ty - p.y }; });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; const p = pt(e); S.tx = Math.min(512, Math.max(0, p.x + drag.dx)); S.ty = Math.min(512, Math.max(0, p.y + drag.dy)); draw(); });
    ['pointerup', 'pointercancel'].forEach((t) => cv.addEventListener(t, () => { drag = null; }));
    const toBlob = () => new Promise((res) => cv.toBlob((b) => { if (b) res(b); else res(null); }, 'image/webp', 0.9));
    ov.addEventListener('click', async (e) => {
      const a = e.target.closest('button[data-a]'); if (!a) return;
      if (a.dataset.a === 'close') { ov.remove(); return; }
      let blob;
      try { blob = await toBlob(); } catch (er) { blob = null; }
      if (!blob) { toast('Не удалось создать стикер'); return; }
      if (a.dataset.a === 'save') {
        // коллекции стикеров (series6): спрашиваем, в какую коллекцию положить, и сохраняем на сервере
        if (window.mxStickerSaveBlob) { a.disabled = true; const ok = await window.mxStickerSaveBlob(blob); a.disabled = false; if (ok) ov.remove(); }
        else { try { await stkPut(blob); toast('Стикер сохранён'); } catch (er) { toast('Не удалось сохранить стикер'); } }
      }
      else if (a.dataset.a === 'dl') {
        const f = new File([blob], 'sticker-' + Date.now() + '.' + (blob.type === 'image/webp' ? 'webp' : 'png'), { type: blob.type });
        const url = URL.createObjectURL(f);
        if (window.mxDownloadMedia) await window.mxDownloadMedia(url, f.name); else { const l = document.createElement('a'); l.href = url; l.download = f.name; l.click(); }
        setTimeout(() => URL.revokeObjectURL(url), 8000);
      } else if (a.dataset.a === 'send') { a.disabled = true; const ok = window.mxStickerSendBlob ? await window.mxStickerSendBlob(blob) : await sendStickerBlob(blob); a.disabled = false; if (ok) ov.remove(); }
    });
  }
  window.mxMakeSticker = openSticker;
  async function sendStickerBlob(blob) {
    const chatId = curChat(); if (!chatId) { toast('Откройте чат, чтобы отправить стикер'); return false; }
    try {
      const file = new File([blob], 'sticker.' + (blob.type === 'image/webp' ? 'webp' : 'png'), { type: blob.type });
      const media = await MchatAPI.uploadMedia('image', file, { name: file.name });
      const saved = await MchatAPI.sendMessage(chatId, '', 'stk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), { kind: 'IMAGE', mediaId: media.id });   // «stk_» — признак стикера (без рамки баббла)
      onIncomingMessage(saved);
      return true;
    } catch (e) { toast(MchatAPI.errorText(e)); return false; }
  }
  window.mxStickerSheet = async function () {
    closeFloating(); const old = $('mx-stk-sheet'); if (old) old.remove();
    const list = await stkAll();
    const wrap = document.createElement('div'); wrap.id = 'mx-stk-sheet'; wrap.className = 'mx-rl-scrim';
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    const urls = list.map((s) => URL.createObjectURL(s.blob));
    wrap.innerHTML = '<div class="mx-rl"><div class="mx-rl-grip"></div><div class="mx-stk-sh-t">Мои стикеры</div>'
      + (list.length ? '<div class="mx-stk-grid">' + list.map((s, i) => '<div class="mx-stk-it" data-i="' + i + '"><img src="' + urls[i] + '" alt=""><button type="button" class="x" data-d="' + i + '" aria-label="Удалить">✕</button></div>').join('') + '</div>'
        : '<div class="mx-rl-empty">Пока пусто. Откройте фото в чате → ⋮ → «Сделать стикер».</div>') + '</div>';
    wrap.onclick = async (e) => {
      if (e.target === wrap) { wrap.remove(); return; }
      const d = e.target.closest('button[data-d]');
      if (d) { e.stopPropagation(); await stkDel(list[+d.dataset.d].id); wrap.remove(); window.mxStickerSheet(); return; }
      const it = e.target.closest('.mx-stk-it'); if (!it) return;
      wrap.remove(); await sendStickerBlob(list[+it.dataset.i].blob);
    };
    appEl().appendChild(wrap);
  };
  // «из галереи»: кнопка «Стикер» в окне предпросмотра перед отправкой
  function injectPreviewStickerBtn() {
    const hd = $('mx-pv-hd'); if (!hd || $('mx-pv-stk')) return;
    const b = document.createElement('button');
    b.id = 'mx-pv-stk'; b.type = 'button'; b.className = 'ib ghost'; b.title = 'Сделать стикер'; b.style.color = '#fff'; b.innerHTML = STK_ICO.replace('width="18" height="18"', 'width="22" height="22"');
    b.onclick = () => { try { if (mxPv && mxPv.url) openSticker(mxPv.url); } catch (e) { /* noop */ } };
    hd.parentNode.insertBefore(b, hd);
  }

  /* ═════════ 6. Голосовые: фиксация, круги, волна ═════════ */
  const NB = 40;                                   // палочек в сообщении
  const Meter = { ctx: null, an: null, buf: null, timer: null, levels: [], last: 0, live: [] };
  function startMeter(stream) {
    stopMeter(true); Meter.levels = []; Meter.live = [];
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC(); const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.4; src.connect(an);
      Meter.ctx = ctx; Meter.an = an; Meter.buf = new Uint8Array(an.fftSize);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      Meter.timer = setInterval(tick, 70);
    } catch (e) { /* без метра запись всё равно работает */ }
  }
  function stopMeter(reset) {
    clearInterval(Meter.timer); Meter.timer = null;
    try { if (Meter.ctx) Meter.ctx.close(); } catch (e) { /* noop */ }
    Meter.ctx = null; Meter.an = null;
    const mainBtn = $('mx-rec-main'); if (mainBtn) mainBtn.style.transform = '';
    if (reset) { Meter.levels = []; Meter.live = []; }
  }
  function tick() {
    if (!Meter.an) return;
    Meter.an.getByteTimeDomainData(Meter.buf);
    let s = 0; for (let i = 0; i < Meter.buf.length; i++) { const v = (Meter.buf[i] - 128) / 128; s += v * v; }
    const lvl = Math.min(1, Math.sqrt(s / Meter.buf.length) * 3.4);
    Meter.levels.push(lvl); Meter.live.push(lvl); if (Meter.live.length > 30) Meter.live.shift();
    const mainBtn = $('mx-rec-main');
    if (mainBtn) {
      mainBtn.style.transform = 'scale(' + (1 + lvl * 0.3).toFixed(3) + ')';
      const now = performance.now();
      if (lvl > 0.1 && now - Meter.last > 240) { Meter.last = now; spawnRipple(mainBtn, lvl); }
    }
    const lb = $('mx-live-bars');
    if (lb) { const ch = lb.children; const off = ch.length - Meter.live.length; for (let i = 0; i < ch.length; i++) { const v = i >= off ? Meter.live[i - off] : 0; ch[i].style.height = Math.round(4 + v * 22) + 'px'; } }
  }
  function spawnRipple(btn, lvl) {
    let host = btn.querySelector('.mx-rip-host');
    if (!host) { host = document.createElement('span'); host.className = 'mx-rip-host'; btn.appendChild(host); }
    const r = document.createElement('span'); r.className = 'mx-rip'; host.appendChild(r);
    const a = r.animate([{ transform: 'scale(1)', opacity: 0.55 }, { transform: 'scale(' + (1.7 + lvl * 2.1).toFixed(2) + ')', opacity: 0 }], { duration: 950, easing: 'cubic-bezier(.2,.6,.3,1)' });
    a.onfinish = () => r.remove();
  }
  function peaksFromLevels(levels) {
    if (!levels.length) return null;
    const out = [], step = levels.length / NB;
    for (let i = 0; i < NB; i++) {
      const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
      let m = 0, sum = 0; for (let j = a; j < b && j < levels.length; j++) { m = Math.max(m, levels[j]); sum += levels[j]; }
      out.push(m * 0.6 + (sum / (b - a)) * 0.4);
    }
    const mx = Math.max.apply(null, out) || 1;
    return out.map((v) => Math.max(0.1, Math.min(1, v / mx)));
  }
  const encodeWave = (p) => 'wf:' + p.map((v) => Math.round(v * 35).toString(36)).join('');
  function decodeWave(t) {
    if (!t || t.slice(0, 3) !== 'wf:') return null;
    const s = t.slice(3); if (s.length < 8 || !/^[0-9a-z]+$/.test(s)) return null;
    return Array.from(s).map((ch) => Math.max(0.08, parseInt(ch, 36) / 35));
  }
  function pseudoWave(id) {
    let a = hash(id) || 1; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const out = []; let v = 0.5;
    for (let i = 0; i < NB; i++) { v = Math.min(1, Math.max(0.15, v + (rnd() - 0.5) * 0.7)); out.push(v); }
    return out;
  }
  function renderWave(prog, peaks) {
    if (!prog) return;
    prog.classList.add('mx-wave');
    prog.innerHTML = peaks.map((v) => '<i style="--h:' + Math.round(14 + v * 86) + '%"></i>').join('');
  }
  function setWave(prog, pct) {
    if (!prog) return;
    const bars = prog.children, n = bars.length, k = Math.floor(pct / 100 * n);
    for (let i = 0; i < n; i++) { bars[i].classList.toggle('on', i < k); bars[i].classList.toggle('cur', pct > 0 && pct < 100 && i === k); }
  }
  function decorateVoices(c) {
    c.querySelectorAll('.msg[data-id] .mx-voice:not([data-wv])').forEach((v) => {
      v.dataset.wv = '1';
      const msgEl = v.closest('.msg'), m = findMsg(msgEl.dataset.id), prog = v.querySelector('.mx-prog');
      if (!m || !prog) return;
      renderWave(prog, decodeWave(m.text) || pseudoWave(m.id || m.clientId || 'x'));
    });
    bindPlayingWave();
  }
  function bindPlayingWave() {
    const a = window._mxVoiceAudio, pid = window._mxVoicePlayingId; if (!a) return;
    if (a._mxL) { a.removeEventListener('timeupdate', a._mxL); a.removeEventListener('ended', a._mxE); }
    const find = () => { const el = document.querySelector('#messages-container .msg[data-id="' + CSS.escape(String(pid)) + '"] .mx-voice'); return el ? el.querySelector('.mx-prog') : null; };
    a._mxL = () => { if (window._mxVoicePlayingId !== pid) return; setWave(find(), a.duration ? a.currentTime / a.duration * 100 : 0); };
    a._mxE = () => setWave(find(), 0);
    a.addEventListener('timeupdate', a._mxL); a.addEventListener('ended', a._mxE);
    // после перерисовки чата восстанавливаем состояние играющего сообщения
    const prog = find();
    if (prog) { setWave(prog, a.duration ? a.currentTime / a.duration * 100 : 0); const btn = prog.parentNode.querySelector('.mx-vplay'); if (btn && !a.paused) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'; }
  }
  if (typeof window.mxVoicePlayToggle === 'function') {
    const _pt = window.mxVoicePlayToggle;
    window.mxVoicePlayToggle = function () { const r = _pt.apply(this, arguments); setTimeout(bindPlayingWave, 0); return r; };
  }

  // запись: метр громкости, живая волна, отправка волны вместе с сообщением
  const _vStart = window.mxVoiceStart;
  window.mxVoiceStart = async function () {
    await _vStart.apply(this, arguments);
    try {
      if (mxRec && mxRec.stream && !mxRec._mx) {
        mxRec._mx = true; startMeter(mxRec.stream);
        const live = document.querySelector('#mx-rec-live');
        if (live && !$('mx-live-bars')) { const lb = document.createElement('span'); lb.id = 'mx-live-bars'; lb.className = 'mx-live-bars'; lb.innerHTML = '<i></i>'.repeat(30); const hint = live.querySelector('.mx-rec-hint'); live.insertBefore(lb, hint || null); }
        const rec = $('mx-rec'); if (rec) rec.classList.remove('locked');
      }
    } catch (e) { /* noop */ }
  };
  const _vStop = window.mxVoiceStopToPreview;
  window.mxVoiceStopToPreview = function () {
    const r = _vStop.apply(this, arguments);
    stopMeter(false);
    try {
      const prog = document.querySelector('#mx-rec-prev .mx-prog'); const pk = peaksFromLevels(Meter.levels);
      if (prog && pk) renderWave(prog, pk);
    } catch (e) { /* noop */ }
    return r;
  };
  if (typeof window.mxPreviewToggle === 'function') {
    const _pv = window.mxPreviewToggle;
    window.mxPreviewToggle = function () {
      const r = _pv.apply(this, arguments);
      try {
        const a = mxRec && mxRec.previewAudio, prog = document.querySelector('#mx-rec-prev .mx-prog');
        if (a && !a._mxW && prog) { a._mxW = 1; a.addEventListener('timeupdate', () => setWave(prog, a.duration ? a.currentTime / a.duration * 100 : 0)); a.addEventListener('ended', () => setWave(prog, 0)); }
      } catch (e) { /* noop */ }
      return r;
    };
  }
  const _vCancel = window.mxVoiceCancel;
  window.mxVoiceCancel = function () { stopMeter(true); hideHoldUi(); return _vCancel.apply(this, arguments); };
  const _vSend = window.mxVoiceSend;
  window.mxVoiceSend = function () {
    const pk = peaksFromLevels(Meter.levels); window.__mxWave = pk ? encodeWave(pk) : null;
    stopMeter(true); hideHoldUi();
    return _vSend.apply(this, arguments);
  };
  if (window.MchatAPI && typeof MchatAPI.sendMessage === 'function' && !MchatAPI.sendMessage.__wave) {
    const _sm = MchatAPI.sendMessage;
    const w = function (chatId, text, clientId, extra) {
      if (extra && extra.kind === 'VOICE' && !text && window.__mxWave) { text = window.__mxWave; window.__mxWave = null; }
      return _sm.call(this, chatId, text, clientId, extra);
    };
    w.__wave = true; MchatAPI.sendMessage = w;
  }

  /* — жест: удержание микрофона, свайп вверх = фиксация, влево = отмена — */
  let hold = null;
  const LOCK_DY = 70, CANCEL_DX = 90, HOLD_MS = 260;
  const LOCK_OPEN = '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/></svg>';
  const LOCK_SHUT = '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';
  function showHoldUi() {
    hideHoldUi();
    const ui = document.createElement('div'); ui.id = 'mx-hold'; ui.className = 'mx-hold';
    ui.innerHTML = '<div class="mx-hold-lock">' + LOCK_OPEN + '</div><div class="mx-hold-arrow">⌃</div><div class="mx-hold-cancel">‹ Влево — отмена</div>';
    appEl().appendChild(ui);
    const circle = hold && hold.mode === 'circle';
    const ar = appEl().getBoundingClientRect();
    if (circle && $('mx-camera')) { $('mx-camera').appendChild(ui); ui.style.bottom = '120px'; ui.style.zIndex = '9999'; }
    else { const rec = $('mx-rec'); const rr = rec ? rec.getBoundingClientRect() : { top: ar.bottom - 90 }; ui.style.bottom = Math.max(70, ar.bottom - rr.top + 8) + 'px'; }
    hold.ui = ui;
  }
  function hideHoldUi() { const ui = $('mx-hold'); if (ui) { ui.classList.add('out'); setTimeout(() => ui.remove(), 260); } }
  function lockNow() {
    if (!hold || hold.locked) return;
    hold.locked = true; vibrate(35);
    const ui = hold.ui;
    if (ui) {
      const lk = ui.querySelector('.mx-hold-lock'); lk.innerHTML = LOCK_SHUT; lk.style.transform = ''; lk.classList.add('locked');
      ui.classList.add('locked');
      setTimeout(hideHoldUi, 700);
    }
    if (hold.mode !== 'circle') { const rec = $('mx-rec'); if (rec) rec.classList.add('locked'); const hint = document.querySelector('#mx-rec-live .mx-rec-hint'); if (hint) hint.textContent = 'Запись зафиксирована'; }
  }
  function holdMove(e) {
    if (!hold || hold.locked) return;
    const dx = e.clientX - hold.x, dy = e.clientY - hold.y;
    if (hold.ui) {
      const lk = hold.ui.querySelector('.mx-hold-lock'), up = Math.max(0, Math.min(-dy, LOCK_DY + 10));
      lk.style.transform = 'translateY(' + (-up * 0.55).toFixed(1) + 'px) scale(' + (1 + up / 260).toFixed(3) + ')';
      lk.style.opacity = String(0.55 + Math.min(1, up / LOCK_DY) * 0.45);
      const cn = hold.ui.querySelector('.mx-hold-cancel'); const l = Math.max(0, -dx);
      cn.style.transform = 'translateX(' + (-Math.min(l, CANCEL_DX)).toFixed(1) + 'px)'; cn.style.opacity = String(1 - Math.min(1, l / CANCEL_DX) * 0.6);
    }
    if (-dy >= LOCK_DY) lockNow();
    else if (-dx >= CANCEL_DX) { const h = hold; hold = null; endHoldListeners(); vibrate([15, 40, 15]); hideHoldUi(); if (h.mode === 'circle') window.mxCircleCancel(); else if (mxRec) window.mxVoiceCancel(); h.cancelled = true; }
  }
  function holdUp() {
    const h = hold; endHoldListeners();
    if (!h) return;
    hold = null;
    if (h.locked) return;                                     // зафиксировано — дальше кнопками «стоп / отправить»
    hideHoldUi();
    const finish = () => {
      if (h.mode === 'circle') { window.mxCircleStop(); return; }
      if (!mxRec) return;
      if (mxRec.elapsed < 1 && Date.now() - mxRec.startedAt < 900) { window.mxVoiceCancel(); toast('Слишком короткое сообщение'); return; }
      window.mxVoiceStopToPreview();
    };
    const ready = h.mode === 'circle' ? (typeof mxCam !== 'undefined' && !!mxCam && !!mxCam.recording) : !!mxRec;
    if (ready) finish(); else h.pendingRelease = finish;
  }
  function endHoldListeners() {
    document.removeEventListener('pointermove', holdMove, true);
    ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach((t) => document.removeEventListener(t, holdUp, true));
  }
  let pend = null;                                  // нажатие на микрофон, ожидающее порога удержания
  function bindMic() {
    const mic = $('mx-mic-btn'); if (!mic || mic._mxHold) return; mic._mxHold = true;
    mic.addEventListener('contextmenu', (e) => e.preventDefault());
    mic.addEventListener('pointerdown', (e) => {
      window.__mxHoldClick = false;
      if (e.button > 0 || mxRec) return;
      const h = { x: e.clientX, y: e.clientY, locked: false, started: false, ui: null, t: null, mode: mic.dataset.mode === 'circle' ? 'circle' : 'voice' };
      pend = h;
      h.t = setTimeout(async () => {
        pend = null; h.started = true; hold = h; window.__mxHoldClick = true;
        document.addEventListener('pointermove', holdMove, true);
        ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach((t) => document.addEventListener(t, holdUp, true));
        vibrate(10);
        let ok;
        if (h.mode === 'circle') ok = await window.mxCircleStart(); else { await window.mxVoiceStart(); ok = !!mxRec; }
        if (!ok) { hold = null; endHoldListeners(); hideHoldUi(); return; }       // нет доступа к микрофону/камере
        if (hold === h) showHoldUi();
        if (h.pendingRelease) h.pendingRelease();
      }, HOLD_MS);
    });
    const cancelPend = () => { if (pend) { clearTimeout(pend.t); pend = null; } };
    mic.addEventListener('pointerup', cancelPend); mic.addEventListener('pointercancel', cancelPend);
    mic.addEventListener('pointermove', (ev) => { if (pend && Math.hypot(ev.clientX - pend.x, ev.clientY - pend.y) > 12) cancelPend(); });
    // клик после удержания не должен второй раз запускать запись
    // короткий тап (не удержание) — переключает режим «голосовое ⇄ кружок»; после удержания клик проглатывается
    mic.addEventListener('click', (e) => {
      e.stopImmediatePropagation(); e.preventDefault();
      if (window.__mxHoldClick) { window.__mxHoldClick = false; return; }
      if (typeof window.mxMicToggleMode === 'function') window.mxMicToggleMode();
    }, true);
  }

  /* ═════════ 6. Альбомы (несколько фото/видео одним блоком) ═════════ */
  const ALB = /^(a[0-9a-z]{5,14})_(\d+)_/;
  function buildAlbums(c, id) {
    const byId = new Map(msgsOf(id).map((m) => [m.id, m]));
    let run = null; const runs = [];
    for (const el of Array.from(c.children)) {
      const m = el.classList && el.classList.contains('msg') ? byId.get(el.dataset.id) : null;
      const am = m && !m.viewOnce && (m.kind === 'IMAGE' || m.kind === 'VIDEO') ? ALB.exec(m.clientId || '') : null;
      if (am) {
        const key = am[1] + (m.outgoing ? 'o' : 'i');
        if (run && run.key === key) { run.els.push(el); run.msgs.push(m); } else { run = { key, els: [el], msgs: [m] }; runs.push(run); }
      } else run = null;
    }
    runs.forEach(makeAlbum);
  }
  function makeAlbum(run) {
    if (run.els.length < 2) return;
    run.msgs.sort((a, b) => (+ALB.exec(a.clientId)[2]) - (+ALB.exec(b.clientId)[2]));
    const host = run.els[0], items = run.msgs, n = items.length;
    const shown = items.slice(0, 4);
    const tiles = shown.map((m, i) => {
      const more = i === 3 && n > 4 ? '<span class="mx-alb-more">+' + (n - 3) + '</span>' : '';
      let inner;
      if (!m.mediaUrl) inner = '<div class="mx-alb-ph"></div>';
      else if (m.kind === 'VIDEO') inner = '<video src="' + E(m.mediaUrl) + '#t=0.1" preload="metadata" muted playsinline></video><span class="mx-alb-play"><svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><polygon points="7 4 20 12 7 20 7 4"/></svg></span>';
      else inner = '<img src="' + E(m.mediaUrl) + '" loading="lazy" alt="">';
      return '<div class="mx-alb-tile' + (m.pending ? ' pending' : '') + '" data-i="' + i + '" data-mid="' + E(m.id) + '">' + inner + more + '</div>';
    }).join('');
    const box = document.createElement('div'); box.className = 'mx-album n' + Math.min(n, 4); box.innerHTML = tiles;
    box.addEventListener('click', (e) => {
      const t = e.target.closest('.mx-alb-tile'); if (!t) return;
      e.stopPropagation(); if (Date.now() - lpFired < 700) return;
      openAlbum(items, +t.dataset.i);
    });
    box.addEventListener('contextmenu', (e) => {
      const t = e.target.closest('.mx-alb-tile'); if (!t) return;
      e.preventDefault(); e.stopPropagation();
      if (typeof window.mxOpenContextMenu === 'function') window.mxOpenContextMenu(t.dataset.mid, { currentTarget: t, target: t });
    });
    host.querySelectorAll('.mx-img,.mx-video,.mx-lost,.mx-upbar').forEach((x) => x.remove());
    const mt = host.querySelector('.mt');
    host.insertBefore(box, host.querySelector('.mx-reactions') || mt);
    host.classList.remove('mx-photo', 'mx-media'); host.classList.add('mx-album-msg');
    host.style.opacity = items.every((m) => m.pending) ? '.6' : '';
    // реакции остальных элементов — в общий блок; время — последнего
    run.els.slice(1).forEach((el) => {
      const rx = el.querySelector('.mx-reactions'); if (rx) host.insertBefore(rx, mt);
      el.style.display = 'none'; el.classList.add('mx-alb-hidden');
    });
    const lastT = run.els[run.els.length - 1].querySelector('.mt'); if (lastT && mt) mt.innerHTML = lastT.innerHTML;
  }
  function openAlbum(items, start) {
    const old = $('mx-alb-view'); if (old) old.remove();
    const list = items.filter((m) => m.mediaUrl);
    if (!list.length) return;
    let i = Math.max(0, list.findIndex((m) => m === items[start]));
    const ov = document.createElement('div'); ov.id = 'mx-alb-view'; ov.className = 'mx-alb-view';
    ov.innerHTML = '<div class="mx-alb-top"><button type="button" data-a="close" aria-label="Закрыть" title="Закрыть"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button><div class="mx-alb-cnt"></div>'
      + '<button type="button" data-a="dl" aria-label="Скачать" title="Скачать"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg></button></div>'
      + '<div class="mx-alb-stage"></div><button type="button" class="mx-alb-nav l" data-a="prev" aria-label="Назад">‹</button><button type="button" class="mx-alb-nav r" data-a="next" aria-label="Вперёд">›</button>';
    appEl().appendChild(ov);
    const stage = ov.querySelector('.mx-alb-stage'), cnt = ov.querySelector('.mx-alb-cnt');
    const show = (dir) => {
      const m = list[i];
      stage.innerHTML = m.kind === 'VIDEO' ? '<video src="' + E(m.mediaUrl) + '" controls autoplay playsinline></video>' : '<img src="' + E(m.mediaUrl) + '" alt="">';
      const el = stage.firstElementChild;
      if (dir) el.animate([{ opacity: 0.2, transform: 'translateX(' + dir * 50 + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 180 });
      cnt.textContent = list.length > 1 ? (i + 1) + ' / ' + list.length : '';
      ov.querySelector('.mx-alb-nav.l').style.display = i > 0 ? '' : 'none';
      ov.querySelector('.mx-alb-nav.r').style.display = i < list.length - 1 ? '' : 'none';
    };
    const step = (d) => { const n = i + d; if (n < 0 || n >= list.length) return; i = n; show(d); };
    const close = () => { document.removeEventListener('keydown', key); ov.remove(); };
    const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); };
    document.addEventListener('keydown', key);
    ov.addEventListener('click', (e) => {
      const a = e.target.closest('button[data-a]');
      if (!a) { if (e.target === stage || e.target === ov) close(); return; }
      if (a.dataset.a === 'close') close(); else if (a.dataset.a === 'prev') step(-1); else if (a.dataset.a === 'next') step(1);
      else if (a.dataset.a === 'dl') { const m = list[i]; if (window.mxDownloadMedia) window.mxDownloadMedia(m.mediaUrl, m.fileName || ''); }
    });
    let sx = null, sy = 0;
    stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1); });
    show(0);
  }

  /* ═════════ init ═════════ */
  function init() { injectViewerMenu(); bindMic(); injectPreviewStickerBtn(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  setTimeout(init, 800);   // экраны могут дорисоваться позже
})();