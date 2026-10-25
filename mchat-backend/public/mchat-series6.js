/* ═══════════════════════════════════════════════════════════════════════
   Mchat · серия 6
   1. Приватные каналы и группы: ссылка-приглашение → «Отправить заявку», плашка заявок для владельца/админа
   2. Строгая приватность: нельзя копировать, пересылать, скачивать; защита от скриншотов (насколько позволяет браузер)
   3. Коллекции стикеров (сервер), «лупа» при удержании, «Добавить коллекцию»
   4. @упоминания в поле ввода чата + подсветка в сообщениях
   Подключается после Mchat-series5.js; ничего не ломает, если серверных методов нет.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__mx6) return; window.__mx6 = true;

  const $ = (id) => document.getElementById(id);
  const toast = (m) => { try { (window.showToast || console.log)(m); } catch (e) { /* noop */ } };
  const E = (s) => (typeof window.esc === 'function' ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const appEl = () => $('app') || document.body;
  const me = () => { try { return currentUser || null; } catch (e) { return null; } };
  const curChat = () => { try { return currentChatId || null; } catch (e) { return null; } };
  const meta = () => { try { return currentChatMeta || null; } catch (e) { return null; } };
  const vibrate = (n) => { try { navigator.vibrate && navigator.vibrate(n); } catch (e) { /* noop */ } };
  const errText = (e) => { try { return MchatAPI.errorText(e); } catch (er) { return 'Ошибка'; } };
  const chatOpen = () => { const s = $('s-chat-open'); return !!(s && s.classList.contains('active')); };

  /* ═════════ 2. Строгая приватность ═════════ */
  const isProt = () => !!(chatOpen() && meta() && meta().isPrivate);
  window.mxIsProtectedChat = isProt;
  const onceOpen = () => !!$('mx-once-viewer');
  let nativeState = null;
  function syncProt() {
    const on = isProt();
    const root = document.documentElement;
    if (root.classList.contains('mx-prot') !== on) root.classList.toggle('mx-prot', on);
    ensureWatermark(on);
    // в нативной оболочке (Android FLAG_SECURE / iOS) экран можно закрыть от скриншотов по-настоящему
    const secure = on || onceOpen();
    if (secure !== nativeState) {
      nativeState = secure;
      try { if (window.MchatNative && typeof window.MchatNative.setSecure === 'function') window.MchatNative.setSecure(secure); } catch (e) { /* noop */ }
      try { if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PrivacyScreen) window.Capacitor.Plugins.PrivacyScreen[secure ? 'enable' : 'disable'](); } catch (e) { /* noop */ }
    }
    if (on) document.querySelectorAll('#messages-container video').forEach((v) => {
      if (v._mx6) return; v._mx6 = true;
      v.setAttribute('controlslist', 'nodownload noremoteplayback'); v.setAttribute('disablepictureinpicture', ''); v.setAttribute('disableremoteplayback', '');
    });
  }
  function ensureWatermark(on) {
    let w = $('mx6-wm');
    if (!on) { if (w) w.remove(); return; }
    if (w) return;
    const u = me(); const label = u ? '@' + (u.username || u.name || '') : '';
    w = document.createElement('div'); w.id = 'mx6-wm'; w.setAttribute('aria-hidden', 'true');
    w.innerHTML = Array.from({ length: 40 }, () => '<span>' + E(label) + '</span>').join('');
    appEl().appendChild(w);
  }
  setInterval(syncProt, 350);
  ['openChat', 'goTo'].forEach((n) => { if (typeof window[n] === 'function') { const o = window[n]; window[n] = function () { const r = o.apply(this, arguments); setTimeout(syncProt, 30); return r; }; } });

  const inField = (t) => !!(t && t.closest && t.closest('input, textarea, [contenteditable="true"]'));
  ['copy', 'cut', 'contextmenu', 'dragstart', 'selectstart'].forEach((t) => document.addEventListener(t, (e) => {
    if (!isProt() || inField(e.target)) return;
    e.preventDefault();
  }, true));
  // скриншот/запись: прячем содержимое чата, пока окно не в фокусе и после характерных сочетаний клавиш
  let blankTimer = null;
  const blank = (ms) => {
    document.documentElement.classList.add('mx-prot-blank');
    clearTimeout(blankTimer);
    if (ms) blankTimer = setTimeout(unblank, ms);
  };
  const unblank = () => { if (!document.hidden && document.hasFocus()) document.documentElement.classList.remove('mx-prot-blank'); };
  document.addEventListener('visibilitychange', () => { if (!(isProt() || onceOpen())) return; if (document.hidden) blank(); else unblank(); });
  window.addEventListener('blur', () => { if (isProt() || onceOpen()) blank(); });
  window.addEventListener('focus', () => { setTimeout(unblank, 120); });
  window.addEventListener('pagehide', () => { if (isProt() || onceOpen()) blank(); });
  window.addEventListener('beforeprint', () => { if (isProt() || onceOpen()) blank(); });
  const onKey = (e) => {
    if (!(isProt() || onceOpen())) return;
    const k = e.key;
    if (k === 'PrintScreen' || k === 'Snapshot' || ((e.metaKey || e.ctrlKey) && e.shiftKey && /^(3|4|5|s|S)$/.test(k)) || ((e.ctrlKey || e.metaKey) && /^(p|s|P|S)$/.test(k) && !inField(e.target))) {
      if (k !== 'PrintScreen' && /^(p|s|P|S)$/.test(k) && !e.shiftKey) e.preventDefault();
      blank(2200); try { navigator.clipboard && navigator.clipboard.writeText(''); } catch (er) { /* noop */ }
    }
  };
  document.addEventListener('keydown', onKey, true); document.addEventListener('keyup', onKey, true);
  // защита от записи экрана через getDisplayMedia в этой же вкладке: при старте захвата чат скрывается
  try {
    const md = navigator.mediaDevices;
    if (md && md.getDisplayMedia && !md.__mx6) {
      md.__mx6 = true; const orig = md.getDisplayMedia.bind(md);
      md.getDisplayMedia = function () { if (isProt() || onceOpen()) blank(); return orig.apply(md, arguments); };
    }
  } catch (e) { /* noop */ }

  // запрет «Скачать/Сохранить» в приватном чате
  ['mxDownloadMedia', 'mxDownloadMessage', 'mxDownloadFrom'].forEach((n) => {
    const o = window[n]; if (typeof o !== 'function') return;
    window[n] = function () { if (isProt()) { toast('Скачивание запрещено в приватном чате'); return; } return o.apply(this, arguments); };
  });
  if (typeof window.mxCtxAdjust === 'function') {
    const o = window.mxCtxAdjust;
    window.mxCtxAdjust = function (msg, buttons) {
      o.apply(this, arguments);
      if (isProt()) { const keep = buttons.filter((b) => !/Сохранить|Скачать|Копировать|Переслать|В избранное/.test(String(b).replace(/<[^>]+>/g, ' '))); buttons.length = 0; keep.forEach((b) => buttons.push(b)); }
      else if (msg && msg.sticker) { const i = Math.max(0, buttons.length - 1); buttons.splice(i, 0, window.mxCtxItem(STK_ICO, 'Коллекция «' + String(msg.sticker.packTitle || '').slice(0, 24) + '»', "mxOpenStickerPack('" + E(msg.sticker.packId) + "')")); }
    };
  }

  /* ═════════ 1. Ссылка-приглашение, заявки ═════════ */
  const CK = 'mx6_join';
  function captureJoinLink() {
    const m = location.pathname.match(/^\/join\/([A-Za-z0-9_-]{6,64})\/?$/);
    if (m) { try { sessionStorage.setItem(CK, m[1]); } catch (e) { /* noop */ } try { history.replaceState(null, '', '/'); } catch (e) { /* noop */ } }
  }
  captureJoinLink();
  const closeModal = (id) => { const m = $(id); if (m) m.remove(); };
  const AV = (url, name, size) => {
    const ini = E(Array.from(String(name || '?'))[0] || '?').toUpperCase();
    return '<span class="mx6-av" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.42) + 'px">' + (url && /^(https?:|\/|data:|blob:)/.test(url) ? '<img src="' + E(url) + '" alt="" referrerpolicy="no-referrer">' : ini) + '</span>';
  };
  const LOCK = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

  async function showJoinCard(code) {
    let p;
    try { p = await MchatAPI.invitePreview(code); } catch (e) { toast(e && e.status === 404 ? 'Ссылка-приглашение недействительна' : errText(e)); return; }
    closeModal('mx6-join');
    const kind = p.type === 'CHANNEL' ? 'канал' : 'группа';
    const modal = document.createElement('div'); modal.id = 'mx6-join'; modal.className = 'modal active mx6-join';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    const label = { member: 'Открыть', open: 'Вступить', request: 'Отправить заявку', pending: 'Заявка отправлена', declined: 'Отправить заявку снова' };
    modal.innerHTML = '<div class="mx6-join-box">'
      + AV(p.avatar, p.name, 84)
      + '<div class="mx6-join-name">' + E(p.name) + '</div>'
      + '<div class="mx6-join-sub">' + (p.isPrivate ? '<span class="mx6-lock">' + LOCK + ' Приватный ' + kind + '</span> · ' : '') + E(String(p.memberCount)) + ' участн.</div>'
      + (p.description ? '<div class="mx6-join-desc">' + E(p.description) + '</div>' : '')
      + (p.state === 'request' || p.state === 'declined' ? '<div class="mx6-join-note">' + (p.state === 'declined' ? 'Прошлая заявка была отклонена. ' : '') + 'Чтобы вступить, нужно одобрение администратора.</div>' : '')
      + (p.state === 'pending' ? '<div class="mx6-join-note">Администратор получил вашу заявку. Мы сообщим о решении.</div>' : '')
      + '<button type="button" class="mx6-btn pri" id="mx6-join-go"' + (p.state === 'pending' ? ' disabled' : '') + '>' + label[p.state] + '</button>'
      + '<button type="button" class="mx6-btn" id="mx6-join-x">Закрыть</button></div>';
    appEl().appendChild(modal);
    $('mx6-join-x').onclick = () => modal.remove();
    $('mx6-join-go').onclick = async () => {
      const b = $('mx6-join-go');
      if (p.state === 'member' && p.chatId) { modal.remove(); try { await refreshChats(); } catch (e) { /* noop */ } return openChatById(p.chatId); }
      b.disabled = true;
      try {
        const r = await MchatAPI.joinChat(code);
        if (r.status === 'pending') { b.textContent = 'Заявка отправлена'; toast('Заявка отправлена администратору'); const n = modal.querySelector('.mx6-join-note'); if (n) n.textContent = 'Администратор получил вашу заявку. Мы сообщим о решении.'; return; }
        modal.remove();
        try { await refreshChats(); } catch (e) { /* noop */ }
        if (r.chat && r.chat.id) openChatById(r.chat.id);
      } catch (e) { b.disabled = false; toast(errText(e)); }
    };
  }
  window.mxShowJoinCard = showJoinCard;

  // плашки заявок для владельца/админа
  let reqs = [];
  const addReq = (r) => { if (r && r.id && !reqs.some((x) => x.id === r.id)) reqs.push(r); renderReqs(); };
  const dropReq = (id) => { reqs = reqs.filter((x) => x.id !== id); renderReqs(); };
  function renderReqs() {
    let box = $('mx6-reqs');
    if (!reqs.length) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'mx6-reqs'; appEl().appendChild(box); }
    const r = reqs[0];
    box.innerHTML = '<div class="mx6-req"><div class="mx6-req-h">' + AV(r.user.avatar, r.user.name, 38) + '<div class="mx6-req-t"><b>' + E(r.user.name) + '</b><small>@' + E(r.user.username) + ' хочет вступить в «' + E(r.chatName) + '»</small></div>'
      + (reqs.length > 1 ? '<span class="mx6-req-n">+' + (reqs.length - 1) + '</span>' : '') + '</div>'
      + '<div class="mx6-req-a"><button type="button" data-a="no">Отклонить</button><button type="button" class="pri" data-a="yes">Принять</button></div></div>';
    box.onclick = (e) => {
      const b = e.target.closest('button[data-a]');
      if (b) { decide(r, b.dataset.a === 'yes', b); return; }
      if (e.target.closest('.mx6-req-n') || e.target.closest('.mx6-req-t')) window.mxOpenJoinRequests(r.chatId);
    };
  }
  async function decide(r, approve, btn) {
    if (btn) btn.disabled = true;
    try { await MchatAPI.decideJoinRequest(r.chatId, r.id, approve); dropReq(r.id); toast(approve ? 'Заявка принята' : 'Заявка отклонена'); const m = $('mx6-rq-list'); if (m) { const row = m.querySelector('[data-id="' + r.id + '"]'); if (row) row.remove(); } }
    catch (e) { if (btn) btn.disabled = false; toast(errText(e)); }
  }
  window.mxOpenJoinRequests = async function (chatId) {
    closeModal('mx6-rq');
    const modal = document.createElement('div'); modal.id = 'mx6-rq'; modal.className = 'modal active mx6-join';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div class="mx6-join-box" style="align-items:stretch"><div class="mx6-join-name" style="text-align:left">Заявки на вступление</div><div id="mx6-rq-list" class="mx6-rq-list"><div class="mx6-empty">Загрузка…</div></div><button type="button" class="mx6-btn" id="mx6-rq-x">Закрыть</button></div>';
    appEl().appendChild(modal); $('mx6-rq-x').onclick = () => modal.remove();
    try {
      const r = await MchatAPI.chatJoinRequests(chatId); const list = $('mx6-rq-list'); if (!list) return;
      list.innerHTML = r.requests.length ? r.requests.map((q) => '<div class="mx6-rq-row" data-id="' + E(q.id) + '">' + AV(q.user.avatar, q.user.name, 40) + '<div class="mx6-req-t"><b>' + E(q.user.name) + '</b><small>@' + E(q.user.username) + '</small></div><button type="button" class="mx6-mini" data-a="no" data-id="' + E(q.id) + '">✕</button><button type="button" class="mx6-mini pri" data-a="yes" data-id="' + E(q.id) + '">✓</button></div>').join('') : '<div class="mx6-empty">Новых заявок нет</div>';
      list.onclick = (e) => { const b = e.target.closest('button[data-a]'); if (!b) return; const q = r.requests.find((x) => x.id === b.dataset.id); if (q) decide(q, b.dataset.a === 'yes', b); };
    } catch (e) { const list = $('mx6-rq-list'); if (list) list.innerHTML = '<div class="mx6-empty">' + E(errText(e)) + '</div>'; }
  };
  try {
    MchatAPI.on('chat:join-request', (r) => { addReq(r); vibrate(20); });
    MchatAPI.on('chat:join-request-resolved', (p) => { if (p) dropReq(p.id); });
    MchatAPI.on('chat:join-approved', () => { toast('Ваша заявка принята — чат добавлен в список'); try { refreshChats(); } catch (e) { /* noop */ } });
    MchatAPI.on('chat:join-declined', (p) => { toast('Заявка в «' + ((p && p.chatName) || 'чат') + '» отклонена'); });
  } catch (e) { /* api ещё не готов */ }

  /* ═════════ 3. Стикеры: коллекции ═════════ */
  const STK_ICO = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M15.5 3H6a3 3 0 00-3 3v12a3 3 0 003 3h8l7-7V6a3 3 0 00-3-3h-2.5z"/><path d="M21 14h-4a3 3 0 00-3 3v4"/></svg>';
  let packs = [], packsLoaded = false, activePack = null, editMode = false;
  const LASTK = 'mx6_last_pack';
  async function loadPacks(force) {
    if (packsLoaded && !force) return packs;
    try { packs = (await MchatAPI.stickerPacks()).packs || []; packsLoaded = true; } catch (e) { toast(errText(e)); }
    return packs;
  }
  const ownPacks = () => packs.filter((p) => p.owned);

  // окно «в какую коллекцию добавить?»: существующая или новая
  function askCollection() {
    return new Promise(async (resolve) => {
      await loadPacks(false);
      closeModal('mx6-ask');
      const own = ownPacks(); let last = null; try { last = localStorage.getItem(LASTK); } catch (e) { /* noop */ }
      let sel = own.some((p) => p.id === last) ? last : (own[0] ? own[0].id : '__new');
      const modal = document.createElement('div'); modal.id = 'mx6-ask'; modal.className = 'modal active mx6-join'; modal.style.zIndex = '2600';
      const draw = () => {
        modal.innerHTML = '<div class="mx6-join-box" style="align-items:stretch"><div class="mx6-join-name" style="text-align:left">В какую коллекцию добавить стикер?</div>'
          + '<div class="mx6-ask-list">' + own.map((p) => '<label class="mx6-ask-row' + (sel === p.id ? ' on' : '') + '"><input type="radio" name="mx6c" value="' + E(p.id) + '"' + (sel === p.id ? ' checked' : '') + '><span>' + E(p.title) + '</span><small>' + p.count + '</small></label>').join('')
          + '<label class="mx6-ask-row' + (sel === '__new' ? ' on' : '') + '"><input type="radio" name="mx6c" value="__new"' + (sel === '__new' ? ' checked' : '') + '><span>＋ Новая коллекция</span></label></div>'
          + '<input class="mx6-inp" id="mx6-ask-name" maxlength="40" placeholder="Название коллекции" style="display:' + (sel === '__new' ? 'block' : 'none') + '">'
          + '<div class="mx6-row"><button type="button" class="mx6-btn" id="mx6-ask-no">Отмена</button><button type="button" class="mx6-btn pri" id="mx6-ask-ok">Добавить</button></div></div>';
        modal.querySelectorAll('input[name="mx6c"]').forEach((r) => { r.onchange = () => { sel = r.value; draw(); }; });
        $('mx6-ask-no').onclick = () => { modal.remove(); resolve(null); };
        $('mx6-ask-ok').onclick = () => {
          if (sel === '__new') { const t = ($('mx6-ask-name').value || '').trim(); if (!t) { toast('Введите название коллекции'); return; } modal.remove(); resolve({ packTitle: t }); }
          else { try { localStorage.setItem(LASTK, sel); } catch (e) { /* noop */ } modal.remove(); resolve({ packId: sel }); }
        };
        if (sel === '__new') setTimeout(() => { const i = $('mx6-ask-name'); if (i) i.focus(); }, 30);
      };
      modal.onclick = (e) => { if (e.target === modal) { modal.remove(); resolve(null); } };
      draw(); appEl().appendChild(modal);
    });
  }
  async function uploadSticker(blob) {
    const pick = await askCollection(); if (!pick) return null;
    const file = new File([blob], 'sticker-' + Date.now() + '.' + (blob.type === 'image/webp' ? 'webp' : 'png'), { type: blob.type });
    const media = await MchatAPI.uploadMedia('image', file, { name: file.name });
    const r = await MchatAPI.addSticker({ mediaId: media.id, packId: pick.packId, packTitle: pick.packTitle });
    if (r.pack) { const i = packs.findIndex((p) => p.id === r.pack.id); if (i >= 0) packs[i] = r.pack; else packs.push(r.pack); packsLoaded = true; activePack = r.pack.id; try { localStorage.setItem(LASTK, r.pack.id); } catch (e) { /* noop */ } }
    return r;
  }
  window.mxStickerSaveBlob = async function (blob) {
    try { const r = await uploadSticker(blob); if (!r) return false; toast('Стикер добавлен в «' + r.pack.title + '»'); return true; }
    catch (e) { toast(errText(e)); return false; }
  };
  window.mxStickerSendBlob = async function (blob) {
    const chatId = curChat(); if (!chatId) { toast('Откройте чат, чтобы отправить стикер'); return false; }
    try { const r = await uploadSticker(blob); if (!r) return false; return await sendStickerById(r.sticker.id); }
    catch (e) { toast(errText(e)); return false; }
  };
  async function sendStickerById(stickerId) {
    const chatId = curChat(); if (!chatId) { toast('Откройте чат'); return false; }
    try {
      const saved = await MchatAPI.sendMessage(chatId, '', 'stk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), { kind: 'IMAGE', stickerId: stickerId });
      if (typeof onIncomingMessage === 'function') onIncomingMessage(saved);
      return true;
    } catch (e) { toast(errText(e)); return false; }
  }

  // «лупа»: стикер под пальцем растёт, соседние — следом
  const LOUPE_MAX = 2.7, LOUPE_SIGMA = 74;
  function bindLoupe(grid, onTap, canStart) {
    let timer = null, down = null, active = false, layer = null, clones = [], items = [];
    const end = () => {
      clearTimeout(timer); timer = null;
      if (!active) return;
      active = false;
      clones.forEach((c) => { c.el.style.transition = 'transform .2s ease'; c.el.style.transform = 'scale(1)'; });
      const L = layer, its = items; layer = null; clones = []; items = [];
      setTimeout(() => { if (L) L.remove(); its.forEach((it) => { it.style.visibility = ''; }); }, 210);
    };
    const begin = (x, y) => {
      active = true; vibrate(6);
      items = Array.from(grid.querySelectorAll('.mx6-st-it'));
      layer = document.createElement('div'); layer.className = 'mx6-loupe';
      const vh = window.innerHeight;
      items.forEach((it) => {
        const r = it.getBoundingClientRect(); if (r.bottom < 0 || r.top > vh) return;
        const img = it.querySelector('img'); if (!img) return;
        const el = document.createElement('img'); el.src = img.currentSrc || img.src; el.draggable = false;
        el.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
        layer.appendChild(el); clones.push({ el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });
        it.style.visibility = 'hidden';
      });
      appEl().appendChild(layer); move(x, y);
    };
    const move = (x, y) => {
      const W = window.innerWidth;
      clones.forEach((c) => {
        const d2 = (c.cx - x) * (c.cx - x) + (c.cy - y) * (c.cy - y);
        const s = 1 + (LOUPE_MAX - 1) * Math.exp(-d2 / (2 * LOUPE_SIGMA * LOUPE_SIGMA));
        const half = c.w * s / 2; let dx = 0;
        if (c.cx - half < 4) dx = 4 - (c.cx - half); else if (c.cx + half > W - 4) dx = (W - 4) - (c.cx + half);
        c.el.style.transition = 'none'; c.el.style.zIndex = String(Math.round(s * 100));
        c.el.style.transform = 'translateX(' + dx + 'px) scale(' + s.toFixed(3) + ')';
      });
    };
    grid.addEventListener('pointerdown', (e) => {
      const it = e.target.closest('.mx6-st-it'); if (!it || (canStart && !canStart(it))) return;
      down = { x: e.clientX, y: e.clientY, id: it.dataset.id, moved: false };
      clearTimeout(timer); timer = setTimeout(() => { if (down && !down.moved) begin(down.x, down.y); }, 220);
    });
    grid.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (active) { move(e.clientX, e.clientY); return; }
      if (Math.abs(e.clientX - down.x) > 9 || Math.abs(e.clientY - down.y) > 9) { down.moved = true; clearTimeout(timer); }
    });
    grid.addEventListener('touchmove', (e) => { if (active) e.preventDefault(); }, { passive: false });
    const up = (cancel) => (e) => {
      if (!down) return; const d = down; down = null;
      if (active) { end(); return; }
      clearTimeout(timer);
      if (!cancel && !d.moved) { const it = e.target.closest && e.target.closest('.mx6-st-it'); if (it && it.dataset.id === d.id) onTap(d.id, it, e); }
    };
    grid.addEventListener('pointerup', up(false)); grid.addEventListener('pointercancel', up(true));
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
    return end;
  }

  function stickerPane(sheet) {
    const pane = document.createElement('div'); pane.className = 'mx6-st'; pane.style.display = 'none';
    sheet.appendChild(pane);
    const draw = async () => {
      await loadPacks(false);
      if (!packs.some((p) => p.id === activePack)) activePack = packs[0] ? packs[0].id : null;
      const p = packs.find((x) => x.id === activePack);
      pane.innerHTML = '<div class="mx6-st-chips">' + packs.map((x) => '<button type="button" class="mx6-chip' + (x.id === activePack ? ' on' : '') + '" data-p="' + E(x.id) + '">' + E(x.title) + '</button>').join('') + '<button type="button" class="mx6-chip plus" data-new="1" title="Новая коллекция">＋</button></div>'
        + (p ? '<div class="mx6-st-bar"><span>' + E(p.title) + ' · ' + p.count + (p.owned ? '' : ' · ' + E(p.ownerName)) + '</span><span class="mx6-st-act">'
          + (p.owned ? '<button type="button" data-a="edit" class="' + (editMode ? 'on' : '') + '">' + (editMode ? 'Готово' : 'Изменить') + '</button><button type="button" data-a="ren">Название</button><button type="button" data-a="delp" class="danger">Удалить</button>' : '<button type="button" data-a="unsave" class="danger">Убрать</button>') + '</span></div>' : '')
        + '<div class="mx6-st-grid' + (editMode ? ' edit' : '') + '">'
        + (p && p.stickers.length ? p.stickers.map((s) => '<div class="mx6-st-it" data-id="' + E(s.id) + '"><img src="' + E(s.url) + '" alt="" draggable="false">' + (editMode && p.owned ? '<button type="button" class="x" data-del="' + E(s.id) + '">✕</button>' : '') + '</div>').join('')
          : '<div class="mx6-empty">' + (packs.length ? 'В этой коллекции пока пусто.' : 'Коллекций пока нет.') + '<br>Откройте фото → ⋮ → «Сделать стикер».</div>') + '</div>';
      const grid = pane.querySelector('.mx6-st-grid');
      if (grid && p) bindLoupe(grid, (id) => { if (editMode) return; sendStickerById(id); }, () => !editMode);
    };
    pane.onclick = async (e) => {
      const chip = e.target.closest('.mx6-chip');
      if (chip) {
        if (chip.dataset.new) { const t = await askText('Новая коллекция', 'Название коллекции'); if (!t) return; try { const r = await MchatAPI.createStickerPack(t); const i = packs.findIndex((x) => x.id === r.pack.id); if (i < 0) packs.push(r.pack); activePack = r.pack.id; } catch (er) { toast(errText(er)); } }
        else { activePack = chip.dataset.p; editMode = false; }
        return draw();
      }
      const del = e.target.closest('button[data-del]');
      if (del) { try { await MchatAPI.deleteSticker(del.dataset.del); await loadPacks(true); } catch (er) { toast(errText(er)); } return draw(); }
      const a = e.target.closest('button[data-a]'); if (!a) return;
      const p = packs.find((x) => x.id === activePack); if (!p) return;
      if (a.dataset.a === 'edit') { editMode = !editMode; return draw(); }
      if (a.dataset.a === 'ren') { const t = await askText('Название коллекции', p.title, p.title); if (!t) return; try { await MchatAPI.renameStickerPack(p.id, t); await loadPacks(true); } catch (er) { toast(errText(er)); } return draw(); }
      if (a.dataset.a === 'delp') { if (!confirm('Удалить коллекцию «' + p.title + '» вместе со стикерами?')) return; try { await MchatAPI.deleteStickerPack(p.id); await loadPacks(true); activePack = null; } catch (er) { toast(errText(er)); } return draw(); }
      if (a.dataset.a === 'unsave') { try { await MchatAPI.unsaveStickerPack(p.id); await loadPacks(true); activePack = null; } catch (er) { toast(errText(er)); } return draw(); }
    };
    pane._draw = draw;
    return pane;
  }
  function askText(title, ph, val) {
    return new Promise((resolve) => {
      closeModal('mx6-txt');
      const modal = document.createElement('div'); modal.id = 'mx6-txt'; modal.className = 'modal active mx6-join'; modal.style.zIndex = '2700';
      modal.innerHTML = '<div class="mx6-join-box" style="align-items:stretch"><div class="mx6-join-name" style="text-align:left">' + E(title) + '</div><input class="mx6-inp" id="mx6-txt-i" maxlength="40" placeholder="' + E(ph || '') + '" value="' + E(val || '') + '" style="display:block"><div class="mx6-row"><button type="button" class="mx6-btn" id="mx6-txt-no">Отмена</button><button type="button" class="mx6-btn pri" id="mx6-txt-ok">Готово</button></div></div>';
      const done = (v) => { modal.remove(); resolve(v); };
      modal.onclick = (e) => { if (e.target === modal) done(null); };
      appEl().appendChild(modal);
      $('mx6-txt-no').onclick = () => done(null);
      $('mx6-txt-ok').onclick = () => { const v = ($('mx6-txt-i').value || '').trim(); if (!v) { toast('Введите название'); return; } done(v); };
      $('mx6-txt-i').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mx6-txt-ok').click(); });
      setTimeout(() => $('mx6-txt-i').focus(), 40);
    });
  }

  // вкладки «Эмодзи | Стикеры» внутри панели смайлика
  if (typeof window.mxComposerEmoji === 'function') {
    const orig = window.mxComposerEmoji;
    window.mxComposerEmoji = function () {
      const had = $('mx-cemoji');
      const r = orig.apply(this, arguments);
      const sheet = $('mx-cemoji');
      if (had || !sheet || sheet.querySelector('.mx6-seg')) return r;
      const seg = document.createElement('div'); seg.className = 'mx6-seg';
      seg.innerHTML = '<button type="button" class="on" data-t="e">Эмодзи</button><button type="button" data-t="s">Стикеры</button>';
      sheet.insertBefore(seg, sheet.firstChild);
      const pane = stickerPane(sheet);
      seg.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const st = b.dataset.t === 's';
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        sheet.querySelector('.tabs').style.display = st ? 'none' : '';
        sheet.querySelector('.mx-emoji-grid').style.display = st ? 'none' : '';
        pane.style.display = st ? 'flex' : 'none';
        sheet.classList.toggle('mx6-stk-open', st);
        if (st) pane._draw();
      };
      return r;
    };
  }
  // «Мои стикеры» из меню чата открывает ту же панель
  window.mxStickerSheet = function () { try { if (typeof closeFloating === 'function') closeFloating(); } catch (e) { /* noop */ } if (!$('mx-cemoji')) window.mxComposerEmoji(); const sh = $('mx-cemoji'); const b = sh && sh.querySelector('.mx6-seg button[data-t="s"]'); if (b) b.click(); };

  // коллекция целиком (по нажатию на стикер в чате): «Добавить коллекцию»
  window.mxOpenStickerPack = async function (packId) {
    try { if (typeof mxCloseFloating === 'function') mxCloseFloating(); } catch (e) { /* noop */ }
    closeModal('mx6-pack');
    let pack; try { pack = (await MchatAPI.stickerPack(packId)).pack; } catch (e) { toast(errText(e)); return; }
    const modal = document.createElement('div'); modal.id = 'mx6-pack'; modal.className = 'modal active mx6-join'; modal.style.zIndex = '2500';
    modal.onclick = (e) => { if (e.target === modal) { end(); modal.remove(); } };
    const draw = () => {
      modal.innerHTML = '<div class="mx6-join-box" style="align-items:stretch;max-height:82vh"><div class="mx6-join-name" style="text-align:left">' + E(pack.title) + '</div><div class="mx6-join-sub" style="text-align:left">' + pack.count + ' стикеров · ' + E(pack.ownerName) + '</div>'
        + '<div class="mx6-st-grid pack">' + pack.stickers.map((s) => '<div class="mx6-st-it" data-id="' + E(s.id) + '"><img src="' + E(s.url) + '" alt="" draggable="false"></div>').join('') + '</div>'
        + (pack.owned ? '<div class="mx6-join-note">Это ваша коллекция</div>' : '<button type="button" class="mx6-btn pri" id="mx6-pk-save">' + (pack.saved ? 'Убрать из моих стикеров' : 'Добавить коллекцию (' + pack.count + ')') + '</button>')
        + '<button type="button" class="mx6-btn" id="mx6-pk-x">Закрыть</button></div>';
      $('mx6-pk-x').onclick = () => { end(); modal.remove(); };
      const sv = $('mx6-pk-save');
      if (sv) sv.onclick = async () => { sv.disabled = true; try { if (pack.saved) { await MchatAPI.unsaveStickerPack(pack.id); pack.saved = false; toast('Коллекция убрана'); } else { pack = (await MchatAPI.saveStickerPack(pack.id)).pack; toast('Коллекция «' + pack.title + '» добавлена'); } packsLoaded = false; } catch (e) { toast(errText(e)); } draw(); };
      end = bindLoupe(modal.querySelector('.mx6-st-grid'), () => {}, null);
    };
    let end = () => {};
    appEl().appendChild(modal); draw();
  };

  /* ═════════ 4. @упоминания в поле ввода чата ═════════ */
  const MRE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{0,20})$/;
  let mState = { items: [], idx: 0, range: null }, mTimer = null, mSeq = 0;
  function mHide() { const d = $('mx6-mention'); if (d) d.remove(); mState = { items: [], idx: 0, range: null }; }
  function mRender() {
    let d = $('mx6-mention');
    if (!mState.items.length) { if (d) d.remove(); return; }
    if (!d) { d = document.createElement('div'); d.id = 'mx6-mention'; d.className = 'mx-mention-list'; const row = $('mx-input-row'); (row && row.parentNode ? row.parentNode : appEl()).appendChild(d); if (row && row.parentNode && getComputedStyle(row.parentNode).position === 'static') row.parentNode.style.position = 'relative'; }
    d.innerHTML = mState.items.map((u, i) => '<div class="mx6-mi' + (i === mState.idx ? ' on' : '') + '" data-i="' + i + '">' + AV(u.avatar, u.name, 30) + '<span class="mx6-mi-t"><b>' + E(u.name) + '</b><small>@' + E(u.username) + '</small></span></div>').join('');
    d.onpointerdown = (e) => { e.preventDefault(); const it = e.target.closest('.mx6-mi'); if (it) mPick(+it.dataset.i); };
  }
  function mPick(i) {
    const u = mState.items[i], inp = $('message-input'); if (!u || !inp || !mState.range) return;
    const { start, end } = mState.range, ins = '@' + u.username + ' ';
    inp.value = inp.value.slice(0, start) + ins + inp.value.slice(end);
    const pos = start + ins.length; try { inp.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    mHide(); inp.focus();
    try { if (typeof mxOnComposeInput === 'function') mxOnComposeInput(); inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* noop */ }
  }
  function mCheck() {
    const inp = $('message-input'), m = meta();
    if (!inp || !m || m.type === 'SAVED' || m.type === 'DIRECT') { mHide(); return; }
    const caret = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    const before = inp.value.slice(0, caret), mt = MRE.exec(before);
    if (!mt) { mHide(); return; }
    const q = mt[2], start = caret - q.length - 1, seq = ++mSeq;
    clearTimeout(mTimer);
    mTimer = setTimeout(async () => {
      try {
        const r = await MchatAPI.chatMentionCandidates(curChat(), q);
        if (seq !== mSeq) return;
        mState = { items: r.users || [], idx: 0, range: { start, end: caret } }; mRender();
      } catch (e) { mHide(); }
    }, 110);
  }
  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'message-input') mCheck(); }, true);
  document.addEventListener('keydown', (e) => {
    if (!e.target || e.target.id !== 'message-input' || !mState.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); mState.idx = (mState.idx + (e.key === 'ArrowDown' ? 1 : mState.items.length - 1)) % mState.items.length; mRender(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); mPick(mState.idx); }
    else if (e.key === 'Escape') { e.preventDefault(); mHide(); }
  }, true);
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#mx6-mention') && e.target.id !== 'message-input') mHide(); }, true);

  // подсветка @username в тексте сообщений; нажатие открывает профиль
  const MENT_RE = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,20})(?![a-zA-Z0-9_])/g;
  function decorate(root) {
    root.querySelectorAll('.mx-txt:not([data-m6])').forEach((el) => {
      el.setAttribute('data-m6', '1');
      if (!el.textContent || el.textContent.indexOf('@') < 0) return;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), nodes = [];
      while (w.nextNode()) { if (!w.currentNode.parentNode.closest('a, .mx-mention')) nodes.push(w.currentNode); }
      nodes.forEach((n) => {
        const t = n.nodeValue; MENT_RE.lastIndex = 0; if (!MENT_RE.test(t)) return; MENT_RE.lastIndex = 0;
        const frag = document.createDocumentFragment(); let last = 0, m;
        while ((m = MENT_RE.exec(t))) {
          const s = m.index + m[1].length;
          frag.appendChild(document.createTextNode(t.slice(last, s)));
          const a = document.createElement('a'); a.className = 'mx-mention'; a.dataset.u = m[2].toLowerCase(); a.textContent = '@' + m[2]; frag.appendChild(a);
          last = s + 1 + m[2].length;
        }
        frag.appendChild(document.createTextNode(t.slice(last))); n.parentNode.replaceChild(frag, n);
      });
    });
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('#messages-container .mx-mention'); if (!a) return;
    e.stopPropagation(); e.preventDefault();
    try { openUserProfile(a.dataset.u); } catch (er) { /* noop */ }
  }, true);
  function watchMessages() {
    const c = $('messages-container'); if (!c || c._mx6w) return !!c; c._mx6w = true;
    let busy = false;
    new MutationObserver(() => { if (busy) return; busy = true; requestAnimationFrame(() => { busy = false; try { decorate(c); } catch (e) { /* noop */ } syncProt(); }); }).observe(c, { childList: true, subtree: true });
    decorate(c); return true;
  }

  /* ═════════ запуск после входа в аккаунт ═════════ */
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    try { const r = await MchatAPI.joinRequests(); (r.requests || []).forEach(addReq); } catch (e) { /* нет прав/сети — не страшно */ }
    let code = null; try { code = sessionStorage.getItem(CK); } catch (e) { /* noop */ }
    if (code) { try { sessionStorage.removeItem(CK); } catch (e) { /* noop */ } showJoinCard(code); }
  }
  let bootUid = null;
  setInterval(() => {
    watchMessages();
    const u = me();
    if (u && u.id !== bootUid) { bootUid = u.id; booted = false; reqs = []; renderReqs(); packs = []; packsLoaded = false; activePack = null; }   // другой аккаунт — всё начинаем заново
    if (u && typeof chats !== 'undefined' && $('app')) boot();
  }, 700);
  window.addEventListener('popstate', () => { captureJoinLink(); });
})();
