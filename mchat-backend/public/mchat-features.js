/* ============================================================================
 * Mchat — новые модули (подключается после mchat-ext.js)
 *   A. общие хелперы · плавающая дата · кнопка «вниз» · мут на время · исчезающие сообщения
 *      · «Избранное» · меню участников группы · чёрный список
 *   B. окно чата (медиа / файлы / аудио / ссылки / настройки) · списки подписчиков · история звонков · зум фото
 *   C. плеер треков · музыка профиля · сохранение треков из чужих профилей
 *   D. «Момент» — живой дневник (карточки, публикация, просмотры, комментарии, WebSocket)
 * ========================================================================== */

/* ───────────────────────── A. ХЕЛПЕРЫ ───────────────────────── */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const F = (window.MxF = window.MxF || {});
  F.$ = $;

  F.icons = {
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>',
    bellOff: '<path d="M13.7 21a2 2 0 01-3.4 0M18.6 13A17.9 17.9 0 0118 8a6 6 0 00-9.3-5M6.3 6.3A6 6 0 006 8c0 7-3 9-3 9h14M1 1l22 22"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
    shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
    brush: '<path d="M18.4 2.6a2 2 0 013 3L12 15l-4 1 1-4z"/><path d="M3 21c2 0 4-1 4-3"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    play: '<polygon points="7 4 20 12 7 20 7 4"/>',
    phone: '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    more: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  };
  F.svg = (name, size, extra) =>
    `<svg width="${size || 18}" height="${size || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" ${extra || ''}>${F.icons[name] || ''}</svg>`;

  F.err = (e) => MchatAPI.errorText(e);
  F.toast = (m) => showToast(m);
  F.avatar = (u, size) => {
    size = size || 42;
    const letter = esc(((u && (u.name || u.username)) || '?').charAt(0).toUpperCase());
    return `<div class="mx-f-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${u && u.avatar ? `<img src="${esc(u.avatar)}" referrerpolicy="no-referrer" alt="">` : letter}</div>`;
  };
  F.badge = (u) => (u && u.verified ? (typeof VERIFIED_BADGE_HTML !== 'undefined' ? VERIFIED_BADGE_HTML : '') : '');

  /** Выезжающая снизу панель (sheet). Возвращает корневой элемент. */
  F.sheet = (id, html, opts) => {
    opts = opts || {};
    document.querySelectorAll('#' + id).forEach((x) => x.remove());
    const el = document.createElement('div');
    el.id = id;
    el.className = 'mx-f-scrim' + (opts.center ? ' center' : '');
    el.style.zIndex = String(opts.z || 880);
    el.innerHTML = `<div class="mx-f-sheet${opts.full ? ' full' : ''}">${html}</div>`;
    el.addEventListener('click', (e) => { if (e.target === el) F.closeSheet(id); });
    $('app').appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    return el;
  };
  F.closeSheet = (id) => {
    const el = $(id);
    if (!el) return;
    el.classList.remove('in');
    setTimeout(() => el.remove(), 220);
  };
  window.mxFClose = F.closeSheet;

  F.timeLabel = (iso) => {
    const d = new Date(iso), now = new Date();
    const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return clock;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера, ' + clock;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + clock;
  };

  /* ───────── 1. ПЛАВАЮЩАЯ ДАТА + КНОПКА «ВНИЗ» ───────── */
  let bound = null;
  function ensureFloaters() {
    const screen = $('s-chat-open');
    if (!screen) return {};
    let pill = $('mx-float-date');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'mx-float-date';
      pill.className = 'mx-float-date';
      screen.appendChild(pill);
    }
    let btn = $('mx-scroll-down');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'mx-scroll-down';
      btn.type = 'button';
      btn.className = 'mx-scroll-down';
      btn.title = 'Вниз';
      btn.setAttribute('aria-label', 'Прокрутить вниз');
      btn.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
      btn.onclick = () => { const c = $('messages-container'); if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); };
      screen.appendChild(btn);
    }
    return { pill, btn };
  }
  const dayFromKey = (key) => {
    const p = String(key || '').split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  function updateFloaters() {
    const c = $('messages-container');
    const { pill, btn } = ensureFloaters();
    if (!c || !pill) return;
    const items = c.querySelectorAll('.msg');
    if (!items.length) { pill.classList.remove('show'); btn.classList.remove('show'); return; }
    // дата первого видимого сообщения
    const top = c.getBoundingClientRect().top + 6;
    let day = items[0].dataset.day;
    for (let i = 0; i < items.length; i++) {
      if (items[i].getBoundingClientRect().bottom > top) { day = items[i].dataset.day; break; }
    }
    pill.textContent = dayFromKey(day);
    pill.style.top = (c.offsetTop + 8) + 'px';
    pill.classList.add('show');
    // кнопка «вниз»: появляется, когда прокрутили вверх
    const away = c.scrollHeight - c.scrollTop - c.clientHeight;
    btn.style.top = (c.offsetTop + c.clientHeight - 58) + 'px';
    btn.classList.toggle('show', away > 220);
  }
  window.mxAfterRender = function (c) {
    if (bound !== c) {
      bound = c;
      c.addEventListener('scroll', updateFloaters, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(updateFloaters).observe(c);
    }
    updateFloaters();
    requestAnimationFrame(updateFloaters);
  };
  window.addEventListener('resize', updateFloaters);

  /* ───────── 2. УВЕДОМЛЕНИЯ ЧАТА: 1 час / 2 часа / 8 часов / навсегда ───────── */
  const MUTE_LABEL = { '1h': 'на 1 час', '2h': 'на 2 часа', '8h': 'на 8 часов', forever: 'навсегда' };
  window.mxMuteSheet = function (chatId) {
    const ch = chats.find((c) => c.id === chatId);
    if (!ch) return;
    const row = (d, label) => `<button class="mx-f-row" onclick="mxDoMute('${esc(chatId)}','${d}')"><span class="mx-f-rico">${F.svg('bellOff', 18)}</span><span class="mx-f-rtxt">${label}</span></button>`;
    F.sheet('mx-mute-sheet', `<div class="mx-f-grip"></div><div class="mx-f-title">Выключить уведомления</div>
      ${row('1h', 'На 1 час')}${row('2h', 'На 2 часа')}${row('8h', 'На 8 часов')}${row('forever', 'Навсегда')}
      <button class="mx-f-cancel" onclick="mxFClose('mx-mute-sheet')">Отмена</button>`, { z: 890 });
  };
  window.mxDoMute = async function (chatId, duration) {
    const ch = chats.find((c) => c.id === chatId);
    F.closeSheet('mx-mute-sheet');
    if (!ch) return;
    try {
      const r = await MchatAPI.muteChat(chatId, true, duration);
      ch.muted = true; ch.mutedUntil = r.mutedUntil || null;
      F.toast('Уведомления выключены ' + MUTE_LABEL[duration]);
      F.afterMuteChange(ch);
    } catch (e) { F.toast(F.err(e)); }
  };
  window.mxUnmute = async function (chatId) {
    const ch = chats.find((c) => c.id === chatId);
    if (!ch) return;
    try {
      await MchatAPI.muteChat(chatId, false);
      ch.muted = false; ch.mutedUntil = null;
      F.toast('Уведомления включены');
      F.afterMuteChange(ch);
    } catch (e) { F.toast(F.err(e)); }
  };
  F.afterMuteChange = (ch) => {
    if ($('mx-info-modal') && typeof mxRenderChatInfo === 'function') mxRenderChatInfo();
    if (typeof mxRefreshGlobalChannels === 'function') mxRefreshGlobalChannels();
    if (window.mxAfterOpenChat && ch.id === currentChatId) window.mxAfterOpenChat(ch);
    if (F.renderChatModalTab) F.renderChatModalTab();
  };
  F.muteText = (ch) => {
    if (!ch.muted) return 'Включены';
    if (!ch.mutedUntil) return 'Выключены';
    return 'Выключены до ' + new Date(ch.mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  // срок «глушения» истёк — уведомления снова включены (сервер считает так же)
  setInterval(() => {
    let changed = false;
    (typeof chats !== 'undefined' ? chats : []).forEach((c) => {
      if (c.muted && c.mutedUntil && Date.parse(c.mutedUntil) <= Date.now()) { c.muted = false; c.mutedUntil = null; changed = true; }
    });
    if (changed && window.mxAfterOpenChat && typeof currentChatId !== 'undefined' && currentChatId) {
      const cur = chats.find((c) => c.id === currentChatId); if (cur) window.mxAfterOpenChat(cur);
    }
  }, 20000);

  /* ───────── 3. ОЧИСТКА ЧАТА ЧЕРЕЗ 24 ЧАСА (исчезающие сообщения) ───────── */
  F.canAutoDelete = (ch) => !(ch.type === 'GROUP' || ch.type === 'CHANNEL') || ch.role === 'OWNER' || ch.role === 'ADMIN';
  window.mxToggleAutoDelete = async function (chatId) {
    const ch = chats.find((c) => c.id === chatId);
    if (!ch) return;
    if (!F.canAutoDelete(ch)) { F.toast('Включать очистку могут только владелец и админы'); return; }
    try {
      const r = await MchatAPI.setAutoDelete(chatId, !ch.autoDeleteSec);
      Object.assign(ch, { autoDeleteSec: r.autoDeleteSec || null });
      if (currentChatMeta) currentChatMeta.autoDeleteSec = ch.autoDeleteSec;
      F.toast(ch.autoDeleteSec ? 'Сообщения будут исчезать через 24 часа' : 'Очистка чата выключена');
      if (chatId === currentChatId) updateChatStatus(ch);
      if (F.renderChatModalTab) F.renderChatModalTab();
    } catch (e) { F.toast(F.err(e)); }
  };

  /* пункты меню «⋮» в шапке чата */
  window.mxChatMenuExtra = function () {
    const ch = chats.find((c) => c.id === currentChatId);
    if (!ch) return [];
    const out = [];
    out.push(mxCtxItem(F.svg('bell', 17), ch.muted ? 'Включить уведомления' : 'Выключить уведомления',
      ch.muted ? `mxCloseFloating();mxUnmute('${esc(ch.id)}')` : `mxCloseFloating();mxMuteSheet('${esc(ch.id)}')`));
    if (F.canAutoDelete(ch)) out.push(mxCtxItem(F.svg('timer', 17), ch.autoDeleteSec ? 'Отключить очистку (24 ч)' : 'Очистка чата через 24 ч', `mxCloseFloating();mxToggleAutoDelete('${esc(ch.id)}')`));
    return out;
  };

  /* ───────── 4. «ИЗБРАННОЕ»: сохранить сообщение себе ───────── */
  window.mxSaveToFavorites = async function (id) {
    mxCloseFloating();
    try {
      let saved = chats.find((c) => c.type === 'SAVED');
      if (!saved) {
        const r = await MchatAPI.openSavedChat();
        saved = chatFromServer(r.chat);
        chats.unshift(saved);
      }
      await MchatAPI.forward(id, saved.id); // пересылка копирует и текст, и файлы/медиа
      F.toast('Сохранено в «Избранное»');
    } catch (e) { F.toast(F.err(e)); }
  };
  /** Открыть «Избранное» из любого места. */
  window.mxOpenSavedChat = async function () {
    try {
      let saved = chats.find((c) => c.type === 'SAVED');
      if (!saved) { const r = await MchatAPI.openSavedChat(); saved = chatFromServer(r.chat); chats.unshift(saved); renderChats(); }
      openChat(saved.id);
    } catch (e) { F.toast(F.err(e)); }
  };

  /* ───────── 5. ЛИЧНЫЕ СООБЩЕНИЯ: подписка / чёрный список прямо из чата ───────── */
  window.mxFollowFromChat = async function () {
    if (!currentChatPeer) return;
    try {
      await MchatAPI.follow(currentChatPeer.username);
      F.toast('Вы подписались. Теперь собеседник сможет вам ответить');
      await refreshChats();
      const cur = chats.find((c) => c.id === currentChatId); if (cur) mxApplyChatInputState(cur);
    } catch (e) { F.toast(F.err(e)); }
  };
  window.mxUnblockFromChat = async function () {
    if (!currentChatPeer) return;
    try {
      await MchatAPI.unblockUser(currentChatPeer.username);
      F.toast('Пользователь разблокирован');
      await refreshChats();
      const cur = chats.find((c) => c.id === currentChatId); if (cur) { mxApplyChatInputState(cur); if (F.renderChatModalTab) F.renderChatModalTab(); }
    } catch (e) { F.toast(F.err(e)); }
  };
  window.mxBlockPeer = function () {
    if (!currentChatPeer) return;
    const name = currentChatPeer.username;
    F.closeSheet('mx-chatmodal');
    showConfirm('Заблокировать @' + esc(name) + '?', async () => {
      try {
        await MchatAPI.blockUser(name);
        F.toast('Пользователь заблокирован');
        await refreshChats();
        const cur = chats.find((c) => c.id === currentChatId); if (cur) mxApplyChatInputState(cur);
      } catch (e) { F.toast(F.err(e)); }
    });
    const yes = document.getElementById('confirm-yes'); if (yes) yes.textContent = 'Да, заблокировать';
  };

  /* Чёрный список в настройках */
  window.mxOpenBlockedList = async function () {
    F.sheet('mx-blocked', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxFClose('mx-blocked')">${F.svg('back', 22)}</button><div class="mx-f-htitle">Чёрный список</div></div>
      <div class="mx-f-body" id="mx-blocked-body"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true });
    try {
      const r = await MchatAPI.blockedUsers();
      const body = $('mx-blocked-body'); if (!body) return;
      body.innerHTML = r.users.length ? r.users.map((u) => `<div class="mx-f-user">
        ${F.avatar(u)}<div class="mx-f-utxt"><div class="mx-f-uname">${esc(u.name || u.username)}</div><div class="mx-f-usub">@${esc(u.username)}</div></div>
        <button class="mx-f-btn" onclick="mxUnblockUser('${esc(u.username)}',this)">Разблокировать</button></div>`).join('')
        : '<div class="mx-f-empty">Список пуст. Заблокированные пользователи не смогут вам писать и звонить</div>';
    } catch (e) { const b = $('mx-blocked-body'); if (b) b.innerHTML = '<div class="mx-f-empty">' + esc(F.err(e)) + '</div>'; }
  };
  window.mxUnblockUser = async function (username, btn) {
    try { await MchatAPI.unblockUser(username); const row = btn.closest('.mx-f-user'); if (row) row.remove(); F.toast('Разблокировано'); refreshChats(); }
    catch (e) { F.toast(F.err(e)); }
  };

  /* ───────── 6. УЧАСТНИКИ ГРУППЫ: меню по нажатию ───────── */
  window.mxMemberMenu = function (userId) {
    const ch = chats.find((c) => c.id === currentChatId);
    const m = (typeof mxInfoMembers !== 'undefined' ? mxInfoMembers : []).find((x) => x.id === userId);
    if (!ch || !m) return;
    if (ch.type === 'CHANNEL') return; // в канале нет админов и управления подписчиками
    const isMe = currentUser && m.id === currentUser.id;
    const iOwner = ch.role === 'OWNER';
    const ROLE = { OWNER: 'Владелец', ADMIN: 'Админ' };
    let html = `<div class="mx-f-grip"></div>
      <div class="mx-f-who">${F.avatar(m, 52)}<div><div class="mx-f-uname">${esc(m.name || m.username)}${F.badge(m)}</div><div class="mx-f-usub">@${esc(m.username)}${ROLE[m.role] ? ' · ' + ROLE[m.role] : ''}</div></div></div>
      <button class="mx-f-row" onclick="mxMemberProfile('${esc(m.id)}')"><span class="mx-f-rico">${F.svg('user', 18)}</span><span class="mx-f-rtxt">Посмотреть профиль</span></button>`;
    if (iOwner && !isMe && m.role !== 'OWNER') {
      const isAdmin = m.role === 'ADMIN';
      html += `<button class="mx-f-row" onclick="mxMemberToggleAdmin('${esc(m.id)}')"><span class="mx-f-rico">${F.svg('shield', 18)}</span><span class="mx-f-rtxt">${isAdmin ? 'Снять админа' : 'Сделать админом'}</span></button>`;
    }
    html += '<button class="mx-f-cancel" onclick="mxFClose(\'mx-member-sheet\')">Закрыть</button>';
    F.sheet('mx-member-sheet', html, { z: 890 });
  };
  window.mxMemberProfile = function (userId) {
    const m = (typeof mxInfoMembers !== 'undefined' ? mxInfoMembers : []).find((x) => x.id === userId);
    F.closeSheet('mx-member-sheet');
    if (!m) return;
    if (typeof mxInfoClose === 'function') mxInfoClose();
    goToUserOrOwnProfile(m.username);
  };
  window.mxMemberToggleAdmin = async function (userId) {
    { const c0 = chats.find((c) => c.id === currentChatId); if (c0 && c0.type === 'CHANNEL') return; } // в каналах админов нет
    const ch = chats.find((c) => c.id === currentChatId);
    const m = (typeof mxInfoMembers !== 'undefined' ? mxInfoMembers : []).find((x) => x.id === userId);
    F.closeSheet('mx-member-sheet');
    if (!ch || !m || ch.role !== 'OWNER') return;
    const next = m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
    try {
      await MchatAPI.setMemberRole(ch.id, userId, next);
      m.role = next;
      mxRenderChatInfo();
      F.toast(next === 'ADMIN' ? (m.name || m.username) + ' теперь админ' : 'Админ снят: ' + (m.name || m.username));
    } catch (e) { F.toast(F.err(e)); }
  };

  /* ───────── 7. КОЛЬЦО АКТИВНОЙ ИСТОРИИ: просмотр историй автора ───────── */
  /** Открыть истории пользователя. Смотреть могут только подписчики — остальным подсказываем подписаться. */
  window.mxOpenStoriesOf = async function (username, avatar) {
    try {
      const r = await MchatAPI.listStories(username);
      const list = (r.stories || []).map(storyFromServer);
      if (!list.length) { F.toast('Активных историй нет'); return true; }
      svList = list;
      svAuthor = { username: username, avatar: avatar || (list[0] && list[0].avatar) || null };
      svCurrentIdx = 0;
      _openStoryViewer();
      return true;
    } catch (e) {
      if (e && e.code === 'stories_followers_only') F.toast('Истории видны только подписчикам. Подпишись, чтобы смотреть');
      else F.toast(F.err(e));
      return false;
    }
  };
  window.mxUserAvatarTap = async function () {
    const u = typeof upProfileInfo !== 'undefined' ? upProfileInfo : null;
    if (u && u.hasStory) {
      const ok = await mxOpenStoriesOf(u.username, u.avatar);
      if (!ok) mxOpenUserAvatar(); // не подписан: историю не показываем, но аватар открывается
      return;
    }
    mxOpenUserAvatar();
  };

  /* ───────── 8. ЧУЖОЙ ПРОФИЛЬ: кольцо истории, «⋮», подписки, треки ───────── */
  window.mxFeatOnUserOpen = function () {
    const av = $('up-avatar'); if (av) av.classList.remove('mx-story-ring');
    const more = $('up-more-btn'); if (more) more.remove();
    const tl = $('up-tracks-link'); if (tl) tl.remove();
    const mt = $('uptab-moment'); if (mt) mt.classList.remove('mx-moment-live');
    document.querySelectorAll('#up-following-count + .pslbl').forEach((l) => { l.textContent = 'Подписки'; });
  };
  window.mxFeatOnUserLoaded = function (u) {
    upProfileInfo = u;
    const av = $('up-avatar');
    if (av) av.classList.toggle('mx-story-ring', !!u.hasStory); // цветной круг активной истории — виден и неподписанным
    const mt = $('uptab-moment'); if (mt) mt.classList.toggle('mx-moment-live', !!u.momentActive);
    if (u.followingHidden) document.querySelectorAll('#up-following-count + .pslbl').forEach((l) => { l.textContent = 'Подписки 🔒'; });
    // «⋮» в шапке профиля: чёрный список
    const head = $('up-header-username') && $('up-header-username').parentNode;
    if (head && !$('up-more-btn')) {
      const b = document.createElement('button');
      b.id = 'up-more-btn'; b.className = 'mx-f-x'; b.type = 'button'; b.title = 'Ещё';
      b.innerHTML = F.svg('more', 22);
      b.onclick = () => mxUserMoreMenu();
      head.appendChild(b);
    }
    // все треки пользователя
    if (u.tracksCount > 0 && !$('up-tracks-link')) {
      const a = document.createElement('button');
      a.id = 'up-tracks-link'; a.type = 'button'; a.className = 'mx-f-link';
      a.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Музыка · ' + u.tracksCount;
      a.onclick = () => mxOpenUserTracks(u.username);
      const anchor = $('up-status') || $('up-username');
      anchor.insertAdjacentElement('beforebegin', a);
    }
  };
  window.mxUserMoreMenu = function () {
    if (!upViewedUsername) return;
    const blocked = !!(upFriendState && upFriendState.blockedByMe);
    F.sheet('mx-user-more', `<div class="mx-f-grip"></div>
      <button class="mx-f-row" onclick="mxFClose('mx-user-more');mxToggleBlockUser()"><span class="mx-f-rico danger">${F.svg('block', 18)}</span><span class="mx-f-rtxt danger">${blocked ? 'Разблокировать' : 'Заблокировать'}</span></button>
      <button class="mx-f-cancel" onclick="mxFClose('mx-user-more')">Отмена</button>`, { z: 890 });
  };
  window.mxToggleBlockUser = async function () {
    const name = upViewedUsername; if (!name) return;
    const blocked = !!(upFriendState && upFriendState.blockedByMe);
    const run = async () => {
      try {
        upFriendState = blocked ? await MchatAPI.unblockUser(name) : await MchatAPI.blockUser(name);
        mxRenderFriendButton();
        F.toast(blocked ? 'Пользователь разблокирован' : 'Пользователь заблокирован');
        refreshChats();
      } catch (e) { F.toast(F.err(e)); }
    };
    if (blocked) run();
    else {
      showConfirm('Заблокировать @' + esc(name) + '?', run);
      const yes = document.getElementById('confirm-yes'); if (yes) yes.textContent = 'Да, заблокировать';
    }
  };

  /* ───────── 9. ИНДИКАТОР «МОМЕНТА» в профиле ───────── */
  F.momentLastAt = null; // время последнего своего момента (для подсветки на 24 часа)
  F.updateMomentIndicator = () => {
    const own = $('ptab-moment');
    if (own) {
      const live = F.momentLastAt ? (Date.now() - F.momentLastAt < 24 * 3600 * 1000) : !!(currentUser && currentUser.momentActive);
      own.classList.toggle('mx-moment-live', live);
    }
  };
  const _updateProfileUI = window.updateProfileUI;
  if (typeof _updateProfileUI === 'function') {
    window.updateProfileUI = function () { const r = _updateProfileUI.apply(this, arguments); try { F.updateMomentIndicator(); } catch (e) { /* не критично */ } return r; };
  }
  setInterval(F.updateMomentIndicator, 60000);
})();

/* ───────────────────────── B. ОКНО ЧАТА · СПИСКИ ПОДПИСЧИКОВ · ИСТОРИЯ ЗВОНКОВ · ЗУМ ФОТО ───────────────────────── */
(function () {
  'use strict';
  const F = window.MxF, $ = F.$;

  /* ───────── 1. ОКНО ЧАТА (нажатие на ник в шапке) ───────── */
  const TABS = [['media', 'Медиа'], ['files', 'Файлы'], ['audio', 'Аудио'], ['links', 'Ссылки'], ['settings', 'Настройки']];
  let cm = { chatId: null, tab: 'media', seq: 0, media: [] };

  window.mxOpenChatModal = function () {
    const ch = chats.find((c) => c.id === currentChatId);
    if (!ch) return;
    cm = { chatId: ch.id, tab: 'media', seq: 0, media: [] };
    const isGroup = ch.type === 'GROUP' || ch.type === 'CHANNEL';
    const peer = ch.peer || null;
    let status = '';
    if (ch.type === 'SAVED') status = 'Заметки, файлы и пересланное';
    else if (ch.type === 'GROUP') status = mxPlural(ch.memberCount, ['участник', 'участника', 'участников']);
    else if (ch.type === 'CHANNEL') status = mxPlural(ch.memberCount, ['подписчик', 'подписчика', 'подписчиков']);
    else if (peer && peer.online === true) status = 'онлайн';
    else if (peer && peer.online === false && peer.lastSeenAt) status = 'был(а) ' + fmtChatTime(peer.lastSeenAt);
    const avatarInner = ch.type === 'SAVED' ? MX_SAVED_AV : chatAvatarHtml(ch);
    const clickable = ch.type !== 'SAVED';
    F.sheet('mx-chatmodal', `
      <div class="mx-f-head"><button class="mx-f-x" onclick="mxFClose('mx-chatmodal')" title="Закрыть">${F.svg('x', 22)}</button><div class="mx-f-htitle">${isGroup ? (ch.type === 'CHANNEL' ? 'Канал' : 'Группа') : ch.type === 'SAVED' ? 'Избранное' : 'Чат'}</div></div>
      <div class="mx-cm-top">
        <div class="mx-cm-av${clickable ? ' tap' : ''}" ${clickable ? 'onclick="mxChatModalAvatar()" title="' + (isGroup ? 'Открыть профиль группы' : 'Открыть профиль') + '"' : ''}>${avatarInner}</div>
        <div class="mx-cm-name">${esc(ch.name)}${ch.type === 'DIRECT' && peer && peer.verified ? F.badge(peer) : ''}</div>
        <div class="mx-cm-status">${esc(status)}</div>
      </div>
      <div class="mx-cm-tabs" id="mx-cm-tabs">${TABS.map((t) => `<button data-tab="${t[0]}" class="${t[0] === 'media' ? 'on' : ''}" onclick="mxChatModalTab('${t[0]}')">${t[1]}</button>`).join('')}</div>
      <div class="mx-f-body" id="mx-cm-body"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true });
    mxChatModalTab('media');
  };

  /** Переход в профиль — ТОЛЬКО отсюда, по нажатию на аватарку внутри окна. */
  window.mxChatModalAvatar = function () {
    const ch = chats.find((c) => c.id === cm.chatId);
    if (!ch) return;
    F.closeSheet('mx-chatmodal');
    if (ch.type === 'DIRECT' && ch.peer) openUserProfile(ch.peer.username);
    else if (ch.type === 'GROUP' || ch.type === 'CHANNEL') mxOpenChatInfo();
  };

  window.mxChatModalTab = function (tab) {
    cm.tab = tab;
    document.querySelectorAll('#mx-cm-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    F.renderChatModalTab();
  };

  const fileRow = (m) => `<a class="mx-f-file" href="${esc(m.mediaUrl || '#')}" download="${esc(m.fileName || 'file')}">
      <span class="mx-f-fico"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
      <span class="mx-f-utxt"><span class="mx-f-uname">${esc(m.fileName || 'Файл')}</span><span class="mx-f-usub">${esc(mxFmtSize(m.fileSize))}${m.fileSize ? ' · ' : ''}${esc(F.timeLabel(m.createdAt))}</span></span></a>`;

  F.renderChatModalTab = async function () {
    const body = $('mx-cm-body');
    const ch = chats.find((c) => c.id === cm.chatId);
    if (!body || !ch) return;
    const seq = ++cm.seq, tab = cm.tab; // любой новый показ отменяет «опоздавшие» ответы предыдущей вкладки
    if (tab === 'settings') { body.innerHTML = settingsHtml(ch); return; }
    body.innerHTML = '<div class="mx-f-empty">Загрузка…</div>';
    let list;
    try { list = (await MchatAPI.chatShared(ch.id, tab)).messages; }
    catch (e) { if (seq === cm.seq && $('mx-cm-body')) $('mx-cm-body').innerHTML = '<div class="mx-f-empty">' + esc(F.err(e)) + '</div>'; return; }
    if (seq !== cm.seq || !$('mx-cm-body')) return;
    if (tab === 'media') {
      cm.media = list.filter((m) => m.kind === 'IMAGE');
      body.innerHTML = list.length ? `<div class="mx-cm-grid">${list.map((m) => m.kind === 'IMAGE'
        ? `<div class="mx-cm-cell" onclick="mxChatModalImage('${esc(m.id)}')"><img src="${esc(m.mediaUrl)}" loading="lazy" alt=""></div>`
        : `<div class="mx-cm-cell"><video src="${esc(m.mediaUrl)}#t=0.1" controls playsinline preload="metadata"></video></div>`).join('')}</div>`
        : '<div class="mx-f-empty">Фото и видео пока нет</div>';
    } else if (tab === 'files') {
      body.innerHTML = list.length ? list.map(fileRow).join('') : '<div class="mx-f-empty">Файлов пока нет</div>';
    } else if (tab === 'audio') {
      body.innerHTML = list.length ? list.map((m) => `<div class="mx-cm-audio">
        <div class="mx-f-usub">${esc(m.kind === 'VOICE' ? (m.senderName || 'Голосовое сообщение') : (m.fileName || 'Аудио'))} · ${esc(F.timeLabel(m.createdAt))}</div>
        <audio controls preload="none" src="${esc(m.mediaUrl || '')}"></audio></div>`).join('') : '<div class="mx-f-empty">Аудио и голосовых пока нет</div>';
    } else {
      const links = [];
      list.forEach((m) => (String(m.text || '').match(/https?:\/\/[^\s<>"']+/g) || []).forEach((u) => links.push({ u, at: m.createdAt })));
      body.innerHTML = links.length ? links.map((l) => {
        let host = l.u; try { host = new URL(l.u).hostname; } catch (e) { /* оставим как есть */ }
        return `<a class="mx-f-file" href="${esc(l.u)}" target="_blank" rel="noopener noreferrer nofollow"><span class="mx-f-fico"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/></svg></span>
          <span class="mx-f-utxt"><span class="mx-f-uname">${esc(host)}</span><span class="mx-f-usub">${esc(l.u.slice(0, 70))}</span></span></a>`;
      }).join('') : '<div class="mx-f-empty">Ссылок пока нет</div>';
    }
  };

  window.mxChatModalImage = function (id) {
    const urls = cm.media.map((m) => m.mediaUrl);
    const cur = cm.media.find((m) => m.id === id);
    if (!cur) return;
    mxGallery.urls = urls; mxGallery.i = Math.max(0, urls.indexOf(cur.mediaUrl));
    const box = $('avatar-fullscreen'); box.style.zIndex = '950';
    mxGalleryShow(0); box.classList.add('active');
  };

  function settingsHtml(ch) {
    const group = ch.type === 'GROUP' || ch.type === 'CHANNEL';
    const rows = [];
    const row = (ico, label, right, onclick, cls) => `<button class="mx-f-row ${cls || ''}" onclick="${onclick}"><span class="mx-f-rico ${cls || ''}">${F.svg(ico, 18)}</span><span class="mx-f-rtxt ${cls || ''}">${label}</span>${right || ''}</button>`;
    if (ch.type !== 'SAVED') {
      rows.push(row(ch.muted ? 'bellOff' : 'bell', 'Уведомления', `<span class="mx-f-rval">${esc(F.muteText(ch))}</span>`,
        ch.muted ? `mxUnmute('${esc(ch.id)}')` : `mxMuteSheet('${esc(ch.id)}')`));
    }
    const canTtl = F.canAutoDelete(ch);
    rows.push(`<div class="mx-f-row static"><span class="mx-f-rico">${F.svg('timer', 18)}</span><span class="mx-f-rtxt">Очистка чата через 24 часа<small>Новые сообщения исчезают через сутки</small></span>
      ${mxSwitchHtml(!!ch.autoDeleteSec, canTtl ? `mxToggleAutoDelete('${esc(ch.id)}')` : `showToast('Включать очистку могут только владелец и админы')`)}</div>`);
    rows.push(row('brush', 'Оформление чата', '', `mxFClose('mx-chatmodal');mxOpenChatCustomize()`));
    if (group) rows.push(row('info', ch.type === 'CHANNEL' ? 'Информация о канале' : 'Участники и управление группой', '', `mxFClose('mx-chatmodal');mxOpenChatInfo()`));
    if (ch.type === 'DIRECT' && ch.peer) {
      const mine = ch.dm && ch.dm.blockedByMe;
      rows.push(mine
        ? row('block', 'Разблокировать', '', `mxUnblockFromChat()`)
        : row('block', 'Заблокировать пользователя', '', 'mxBlockPeer()', 'danger'));
    }
    return `<div class="mx-f-list">${rows.join('')}</div>`;
  }

  /* ───────── 2. СПИСКИ «ПОДПИСЧИКИ» / «ПОДПИСКИ» ───────── */
  let fl = { name: null, kind: null };
  window.mxOpenFollowList = async function (username, kind) {
    if (username === 'me') username = currentUser && currentUser.username;
    if (!username) return;
    fl = { name: username, kind };
    const own = currentUser && username === currentUser.username;
    F.sheet('mx-followlist', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxFClose('mx-followlist')">${F.svg('back', 22)}</button><div class="mx-f-htitle">${kind === 'followers' ? 'Подписчики' : 'Подписки'}</div></div>
      <div class="mx-f-body" id="mx-fl-body"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true });
    try {
      const r = await MchatAPI.followsOf(username, kind);
      const body = $('mx-fl-body'); if (!body || fl.name !== username || fl.kind !== kind) return;
      if (r.hidden) { body.innerHTML = `<div class="mx-f-empty">${F.svg('lock', 30)}<div style="margin-top:10px">Пользователь скрыл свои подписки</div></div>`; return; }
      body.innerHTML = r.users.length ? r.users.map((u) => `<div class="mx-f-user" onclick="mxFlOpen('${esc(u.username)}')">
        ${F.avatar(u)}<div class="mx-f-utxt"><div class="mx-f-uname">${esc(u.name || u.username)}${F.badge(u)}</div><div class="mx-f-usub">@${esc(u.username)}</div></div>
        ${u.isMe ? '' : `<button class="mx-f-btn${u.iFollow ? ' ghost' : ''}" data-f="${u.iFollow ? 1 : 0}" onclick="event.stopPropagation();mxFlToggle('${esc(u.username)}',this,${own && kind === 'following' ? 'true' : 'false'})">${u.iFollow ? 'Отписаться' : 'Подписаться'}</button>`}</div>`).join('')
        : `<div class="mx-f-empty">${kind === 'followers' ? 'Подписчиков пока нет' : 'Подписок пока нет'}</div>`;
    } catch (e) { const b = $('mx-fl-body'); if (b) b.innerHTML = '<div class="mx-f-empty">' + esc(F.err(e)) + '</div>'; }
  };
  window.mxFlOpen = function (username) { F.closeSheet('mx-followlist'); goToUserOrOwnProfile(username); };
  window.mxFlToggle = async function (username, btn, adjustOwnCount) {
    btn.disabled = true;
    const was = btn.dataset.f === '1';
    try {
      if (was) await MchatAPI.unfollow(username); else await MchatAPI.follow(username);
      btn.dataset.f = was ? '0' : '1';
      btn.textContent = was ? 'Подписаться' : 'Отписаться';
      btn.classList.toggle('ghost', !was);
      if (adjustOwnCount) { const el = $('following-count'); if (el) el.textContent = Math.max(0, (parseInt(el.textContent, 10) || 0) + (was ? -1 : 1)); }
    } catch (e) { F.toast(F.err(e)); }
    finally { btn.disabled = false; }
  };

  /* ───────── 3. ИСТОРИЯ ЗВОНКОВ (Настройки) ───────── */
  let ch2 = { items: [], filter: 'all' };
  const DIR = {
    outgoing: ['Исходящий', 'out'], incoming: ['Входящий', 'in'], missed: ['Пропущенный', 'missed'], declined: ['Отклонённый', 'missed'],
  };
  function durText(sec) {
    sec = Math.round(sec || 0);
    if (sec <= 0) return '';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ' ч ' + m + ' мин' : m ? m + ' мин ' + (s ? s + ' с' : '') : s + ' с';
  }
  window.mxOpenCallHistory = async function () {
    ch2 = { items: [], filter: 'all' };
    F.sheet('mx-callhist', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxFClose('mx-callhist')">${F.svg('back', 22)}</button><div class="mx-f-htitle">История звонков</div></div>
      <div class="mx-cm-tabs" id="mx-ch-tabs">${[['all', 'Все'], ['incoming', 'Входящие'], ['outgoing', 'Исходящие'], ['missed', 'Пропущенные']].map((t) => `<button data-f="${t[0]}" class="${t[0] === 'all' ? 'on' : ''}" onclick="mxCallHistFilter('${t[0]}')">${t[1]}</button>`).join('')}</div>
      <div class="mx-f-body" id="mx-ch-body"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true });
    try { ch2.items = (await MchatAPI.callHistory()).calls || []; renderHist(); }
    catch (e) { const b = $('mx-ch-body'); if (b) b.innerHTML = '<div class="mx-f-empty">' + esc(F.err(e)) + '</div>'; }
  };
  window.mxCallHistFilter = function (f) {
    ch2.filter = f;
    document.querySelectorAll('#mx-ch-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
    renderHist();
  };
  function renderHist() {
    const body = $('mx-ch-body'); if (!body) return;
    const f = ch2.filter;
    const list = ch2.items.filter((c) => f === 'all' || (f === 'missed' ? (c.direction === 'missed' || c.direction === 'declined') : c.direction === f));
    if (!list.length) { body.innerHTML = '<div class="mx-f-empty">Звонков пока нет</div>'; return; }
    body.innerHTML = list.map((c) => {
      const d = DIR[c.direction] || DIR.missed;
      const dur = c.status === 'ENDED' ? durText(c.durationSec) : '';
      const chat = chats.find((x) => x.id === c.chatId);
      const canCall = chat && (chat.type === 'DIRECT' || (chat.type === 'GROUP' && chat.canModerate));
      const arrow = d[1] === 'in' ? '<path d="M17 7L7 17M7 17h8M7 17V9"/>' : d[1] === 'out' ? '<path d="M7 17L17 7M17 7H9M17 7v8"/>' : '<path d="M17 7L7 17M7 7l10 10"/>';
      return `<div class="mx-f-user mx-ch-row ${d[1]}">
        ${F.avatar({ name: c.name, avatar: c.avatar })}
        <div class="mx-f-utxt"><div class="mx-f-uname">${esc(c.name)}${c.isGroup ? ' <span class="mx-f-tag">группа</span>' : ''}</div>
          <div class="mx-f-usub mx-ch-sub"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">${arrow}</svg>${d[0]}${c.video ? ' · видео' : ''} · ${esc(F.timeLabel(c.startedAt))}${dur ? ' · ' + esc(dur) : ''}</div></div>
        ${canCall ? `<button class="mx-f-call" title="Перезвонить" onclick="mxCallBack('${esc(c.chatId)}',${c.video ? 'true' : 'false'})">${F.svg(c.video ? 'video' : 'phone', 18)}</button>` : ''}
      </div>`;
    }).join('');
  }
  /** Перезвонить в один клик: открываем чат и сразу звоним. */
  window.mxCallBack = async function (chatId, video) {
    F.closeSheet('mx-callhist');
    await openChatById(chatId);
    if (currentChatId === chatId) mxStartCall(!!video);
  };

  /* ───────── 4. ЗУМ ФОТО: щипок, колесо, двойной тап, перетаскивание, полноэкранный просмотр ───────── */
  (function zoom() {
    const box = $('avatar-fullscreen'), img = $('avatar-full-img');
    if (!box || !img) return;
    const pts = new Map();
    let s = 1, tx = 0, ty = 0, startDist = 0, startS = 1, startTx = 0, startTy = 0, startMid = null, drag = null, lastTap = 0, lastGesture = 0, fromImg = false, closeTimer = null;
    const MAX = 6;
    img.style.touchAction = 'none';
    img.draggable = false;

    const apply = (anim) => { img.style.transition = anim ? 'transform .22s ease' : 'none'; img.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; setLabel(); };
    const clamp = () => {
      const mx = Math.max(0, (img.clientWidth * s - box.clientWidth) / 2), my = Math.max(0, (img.clientHeight * s - box.clientHeight) / 2);
      tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
    };
    const setGallery = () => { // при зуме листание галереи отключено (см. mxGalleryBindSwipe)
      if (typeof mxGallery === 'undefined') return;
      mxGallery.cur = s > 1.02 ? null : img.getAttribute('src');
    };
    const reset = (anim) => { s = 1; tx = 0; ty = 0; apply(anim); setGallery(); };
    const zoomAt = (cx, cy, ns, anim) => {
      ns = Math.min(MAX, Math.max(1, ns));
      const r = box.getBoundingClientRect();
      const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
      tx = px - (px - tx) * (ns / s); ty = py - (py - ty) * (ns / s); s = ns;
      if (s <= 1.02) { s = 1; tx = 0; ty = 0; } else clamp();
      apply(anim); setGallery(); lastGesture = Date.now();
    };

    // элементы управления: закрыть и масштаб
    if (!$('mx-zoom-ctl')) {
      const ctl = document.createElement('div');
      ctl.id = 'mx-zoom-ctl'; ctl.className = 'mx-zoom-ctl';
      ctl.innerHTML = `<button type="button" id="mx-zoom-out" aria-label="Уменьшить">−</button><span id="mx-zoom-lbl">100%</span><button type="button" id="mx-zoom-in" aria-label="Увеличить">+</button>`;
      box.appendChild(ctl);
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'mx-zoom-x'; x.setAttribute('aria-label', 'Закрыть'); x.innerHTML = F.svg('x', 22);
      box.appendChild(x);
      ctl.addEventListener('click', (e) => e.stopPropagation());
      x.addEventListener('click', (e) => { e.stopPropagation(); closeNow(); });
      $('mx-zoom-in').addEventListener('click', () => { const r = box.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, s * 1.5, true); });
      $('mx-zoom-out').addEventListener('click', () => { const r = box.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, s / 1.5, true); });
    }
    function setLabel() { const l = $('mx-zoom-lbl'); if (l) l.textContent = Math.round(s * 100) + '%'; }

    const dist = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    const mid = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; };

    img.addEventListener('pointerdown', (e) => {
      img.setPointerCapture && img.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: Date.now() });
      if (pts.size === 2) { startDist = dist(); startS = s; startTx = tx; startTy = ty; startMid = mid(); drag = null; clearTimeout(closeTimer); }
      else if (pts.size === 1 && s > 1) drag = { x: e.clientX, y: e.clientY, tx, ty };
    });
    img.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2 && startDist) {
        const ns = Math.min(MAX, Math.max(1, startS * dist() / startDist));
        // точка изображения под серединой пальцев остаётся под ней, пока пальцы двигаются
        const m = mid(), r = box.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        s = ns;
        tx = (m.x - cx) - ns * ((startMid.x - cx) - startTx) / startS;
        ty = (m.y - cy) - ns * ((startMid.y - cy) - startTy) / startS;
        if (s <= 1.02) { tx = 0; ty = 0; } else clamp();
        apply(false); setGallery(); lastGesture = Date.now();
      } else if (pts.size === 1 && drag && s > 1) {
        tx = drag.tx + (e.clientX - drag.x); ty = drag.ty + (e.clientY - drag.y); clamp(); apply(false);
        if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) lastGesture = Date.now();
      }
    });
    const end = (e) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) startDist = 0;
      if (pts.size === 0) drag = null;
      if (!p || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 8;
      if (!moved && Date.now() - p.t0 < 300) { // тап: двойной тап — приближение / возврат
        const now = Date.now();
        if (now - lastTap < 320) { clearTimeout(closeTimer); zoomAt(e.clientX, e.clientY, s > 1.05 ? 1 : 2.5, true); lastTap = 0; }
        else lastTap = now;
      }
    };
    img.addEventListener('pointerup', end);
    img.addEventListener('pointercancel', end);
    img.addEventListener('click', () => { fromImg = true; });
    box.addEventListener('wheel', (e) => { if (!box.classList.contains('active')) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, s * (e.deltaY < 0 ? 1.18 : 1 / 1.18), false); }, { passive: false });
    img.addEventListener('dblclick', (e) => { e.preventDefault(); });

    // при смене картинки и открытии просмотр начинается без зума
    img.addEventListener('load', () => reset(false));
    new MutationObserver(() => { if (!box.classList.contains('active')) { reset(false); pts.clear(); } }).observe(box, { attributes: true, attributeFilter: ['class'] });

    // закрытие: тап по фону закрывает; тап по приближенной картинке сначала возвращает масштаб; одиночный тап ждёт возможного двойного
    const baseClose = window.closeAvatarFull;
    function closeNow() { clearTimeout(closeTimer); reset(false); if (typeof mxSwipeAt !== 'undefined') mxSwipeAt = 0; baseClose(); }
    window.closeAvatarFull = function () {
      const onImg = fromImg; fromImg = false;
      if (Date.now() - lastGesture < 350) return;
      if (s > 1.02) { if (onImg) reset(true); else closeNow(); return; }
      if (onImg) { clearTimeout(closeTimer); closeTimer = setTimeout(() => { if (s <= 1.02 && Date.now() - lastGesture >= 350) closeNow(); }, 280); return; }
      closeNow();
    };
    document.addEventListener('keydown', (e) => {
      if (!box.classList.contains('active')) return;
      if (e.key === 'Escape') closeNow();
      else if (e.key === '+' || e.key === '=') { const r = box.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, s * 1.4, true); }
      else if (e.key === '-') { const r = box.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, s / 1.4, true); }
    });
  })();

  /** Открыть любое изображение на весь экран с зумом (посты, моменты, профиль). */
  window.mxZoomOpen = function (url) {
    if (!url) return;
    mxGallery.urls = [url]; mxGallery.i = 0;
    const box = $('avatar-fullscreen'); box.style.zIndex = '950';
    mxGalleryShow(0);
    box.classList.add('active');
  };
  // фото в просмотре поста (свои и чужие) открываются на весь экран по нажатию
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && (t.id === 'pv-img' || t.id === 'fpv-img') && t.src) mxZoomOpen(t.currentSrc || t.src);
  });
})();

/* ───────────────────────── C. ПЛЕЕР ТРЕКОВ · МУЗЫКА ПРОФИЛЯ · СОХРАНЕНИЕ ЧУЖИХ ТРЕКОВ ─────────────────────────
 * Раньше в окне трека был квадрат с нотой, а сам плеер был скрыт (display:none) и не включался.
 * Теперь один общий плеер: кнопка ▶/❚❚, перемотка, время; работает в окне трека, в списках и в «Моменте».
 * Трек из чужого профиля можно сохранить себе и поставить в свой профиль. */
(function () {
  'use strict';
  const F = window.MxF, $ = F.$;
  const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  const PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  const NOTE = '<svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const STAR = (on) => `<svg width="18" height="18" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" viewBox="0 0 24 24"><polygon points="12 2 15.1 8.6 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.6"/></svg>`;
  const BOOK = (on) => `<svg width="18" height="18" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`;
  const TRASH = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';

  const fmt = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  /* ───────── реестр треков и сохранённые ───────── */
  const savedIds = new Set();
  let savedLoaded = false;
  async function loadSavedIds(force) {
    if (savedLoaded && !force) return;
    try { const r = await MchatAPI.savedTracks(); savedIds.clear(); r.tracks.forEach((t) => savedIds.add(t.id)); savedLoaded = true; } catch (e) { /* без сети — не критично */ }
  }
  /** Регистрируем серверный трек в общем реестре аудио и возвращаем ключ. */
  function reg(t) {
    const key = 'srv_' + t.id;
    const mine = !!(currentUser && String(t.artist || '') === '@' + currentUser.username) || t.mine === true;
    audioRegistry[key] = {
      id: key, title: t.title || 'Без названия', artist: t.artist || '', url: t.url, avatar: null,
      originalUploader: String(t.artist || '').replace(/^@/, '') || 'user', serverId: t.id, mine, durationSec: t.durationSec || 0,
    };
    return key;
  }
  F.regTrack = reg;

  /* ───────── единый аудио-движок ───────── */
  let audio = null, curKey = null;
  function stopOthers() {
    ['_mxTrackRowAudio', '_mxProfileAudio'].forEach((k) => { try { if (window[k] && !window[k].paused) window[k].pause(); } catch (e) { /* ничего */ } });
    document.querySelectorAll('audio, .mx-voice audio').forEach((a) => { if (a !== audio && !a.paused) a.pause(); });
  }
  function ensure(key) {
    const e = audioRegistry[key];
    if (!e || !e.url) return null;
    if (!audio || curKey !== key) {
      if (audio) { try { audio.pause(); } catch (x) { /* ничего */ } audio.removeAttribute('src'); audio.load(); }
      audio = new Audio();
      audio.preload = 'auto';
      audio.src = e.url;
      curKey = key;
      window._mxTrackAudio = audio; window._mxTrackAudioId = key;
      ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ended', 'waiting', 'playing'].forEach((ev) => audio.addEventListener(ev, sync));
      audio.addEventListener('error', () => { F.toast('Не удалось воспроизвести трек'); sync(); });
    }
    return audio;
  }
  function play(key) {
    const a = ensure(key);
    if (!a) { F.toast('У этого трека нет аудио'); return; }
    stopOthers();
    const p = a.play();
    if (p && p.catch) p.catch(() => F.toast('Не удалось воспроизвести. Нажми ещё раз'));
  }
  function toggle(key) {
    if (curKey === key && audio && !audio.paused) { audio.pause(); return; }
    play(key);
  }
  function seek(key, ratio) {
    if (curKey !== key || !audio || !isFinite(audio.duration) || !audio.duration) { if (curKey !== key) { play(key); } return; }
    audio.currentTime = Math.min(1, Math.max(0, ratio)) * audio.duration;
  }
  F.audio = { play, toggle, seek, reg };

  /** Перерисовка всех элементов управления: строки списков, карточки моментов, окно трека. */
  function sync() {
    const playing = !!(audio && !audio.paused && !audio.ended);
    const dur = audio && isFinite(audio.duration) ? audio.duration : 0;
    const cur = audio ? audio.currentTime : 0;
    document.querySelectorAll('[data-pkey]').forEach((el) => {
      const on = el.dataset.pkey === curKey;
      el.classList.toggle('current', on);
      el.classList.toggle('playing', on && playing);
      const btn = el.querySelector('.mx-trk-play');
      if (btn) btn.innerHTML = on && playing ? PAUSE : PLAY;
      const fill = el.querySelector('.mx-trk-fill');
      if (fill) fill.style.width = on && dur ? (cur / dur * 100) + '%' : '0%';
      const tm = el.querySelector('.mx-trk-time');
      if (tm && on) tm.textContent = fmt(cur) + (dur ? ' / ' + fmt(dur) : '');
    });
    // окно трека
    const on = currentReelsAudioId && currentReelsAudioId === curKey;
    const b = $('mx-audio-play');
    if (b) b.innerHTML = on && playing ? PAUSE : PLAY;
    const fill = $('mx-audio-fill'); if (fill) fill.style.width = on && dur ? (cur / dur * 100) + '%' : '0%';
    const t = $('mx-audio-time'); if (t) t.textContent = on ? fmt(cur) + (dur ? ' / ' + fmt(dur) : '') : '0:00';
    const disc = $('audio-modal-disc'); if (disc) disc.classList.toggle('spin', !!(on && playing));
  }

  /* ───────── окно трека (старый квадрат с нотой → рабочий плеер) ───────── */
  window.mxAudioToggle = function () { if (currentReelsAudioId) toggle(currentReelsAudioId); };
  window.mxAudioSeek = function (evt) {
    const bar = evt.currentTarget, r = bar.getBoundingClientRect();
    seek(currentReelsAudioId, (evt.clientX - r.left) / r.width);
  };
  window.openAudioModal = function () {
    const key = currentReelsAudioId, a = key && audioRegistry[key];
    if (!a) return;
    const disc = $('audio-modal-disc');
    disc.innerHTML = a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : NOTE;
    disc.onclick = () => toggle(key); // нажатие на диск тоже включает/ставит на паузу
    disc.style.cursor = 'pointer';
    $('audio-modal-title').textContent = a.title;
    $('audio-modal-artist').textContent = a.artist;
    $('mx-audio-player').style.display = 'flex';
    const server = !!a.serverId;
    // кнопки Reels-звука прячем у серверных треков, вместо них — «сохранить» и «в профиль»
    const useBtn = document.querySelector('#audio-modal [onclick="useTrackForVideo()"]'), saveBtn = $('audio-save-btn');
    if (useBtn) useBtn.style.display = server ? 'none' : '';
    if (saveBtn) saveBtn.style.display = server ? 'none' : '';
    let box = $('mx-audio-actions');
    if (!box) { box = document.createElement('div'); box.id = 'mx-audio-actions'; box.className = 'mx-audio-actions'; (useBtn || saveBtn).insertAdjacentElement('beforebegin', box); }
    box.style.display = server ? 'flex' : 'none';
    if (server) renderModalActions(key);
    if (!server) {
      const saved = isTrackSaved(key);
      $('audio-save-btn-text').textContent = saved ? 'Удалить из избранного' : 'Сохранить в избранное';
      saveBtn.classList.toggle('primary', !saved); saveBtn.classList.toggle('secondary', saved);
    }
    sync();
    $('audio-modal').classList.add('active');
  };
  const _close = window.closeAudioModal;
  window.closeAudioModal = function () { if (audio && !audio.paused) audio.pause(); _close(); };

  async function renderModalActions(key) {
    const a = audioRegistry[key], box = $('mx-audio-actions');
    if (!a || !box) return;
    await loadSavedIds();
    if (currentReelsAudioId !== key) return;
    const inProfile = !!(currentUser && currentUser.musicTrack && currentUser.musicTrack.id === a.serverId);
    const saved = a.mine || savedIds.has(a.serverId);
    box.innerHTML = `
      ${a.mine ? '' : `<button class="audio-modal-btn ${saved ? 'secondary' : 'primary'}" onclick="mxTrackSaveToggle('${esc(a.serverId)}','${esc(key)}')">${BOOK(saved)} ${saved ? 'Сохранён · убрать' : 'Сохранить себе'}</button>`}
      <button class="audio-modal-btn ${inProfile ? 'secondary' : (a.mine || saved ? 'primary' : 'secondary')}" onclick="mxTrackToProfile('${esc(a.serverId)}','${esc(key)}')">${STAR(inProfile)} ${inProfile ? 'Убрать из моего профиля' : 'Поставить в мой профиль'}</button>`;
  }

  /** Музыка под ником в профиле (своя и чужая): открывает рабочий плеер и сразу включает трек. */
  window.mxProfileMusicPlay = function (track) {
    const t = track || (typeof mxProfileTrack !== 'undefined' ? mxProfileTrack : null);
    if (!t) return;
    const key = reg(t);
    currentReelsAudioId = key;
    openAudioModal();
    play(key);
  };

  /* ───────── сохранить чужой трек / поставить в свой профиль ───────── */
  window.mxTrackSaveToggle = async function (id, key) {
    try {
      await loadSavedIds();
      if (savedIds.has(id)) { await MchatAPI.unsaveTrack(id); savedIds.delete(id); F.toast('Трек убран из сохранённых'); if (currentUser.musicTrack && currentUser.musicTrack.id === id) { currentUser.musicTrack = null; saveUser(); mxRenderOwnMusic(); } }
      else { await MchatAPI.saveTrack(id); savedIds.add(id); F.toast('Трек сохранён'); }
      if (key && currentReelsAudioId === key) renderModalActions(key);
      refreshLists();
    } catch (e) { F.toast(F.err(e)); }
  };
  window.mxTrackToProfile = async function (id, key) {
    try {
      const inProfile = !!(currentUser.musicTrack && currentUser.musicTrack.id === id);
      const a = key && audioRegistry[key];
      if (!inProfile && !(a && a.mine)) { await loadSavedIds(); if (!savedIds.has(id)) { await MchatAPI.saveTrack(id); savedIds.add(id); } } // сначала сохраняем себе
      const r = await MchatAPI.updateMe({ musicTrack: inProfile ? null : id });
      currentUser.musicTrack = r.musicTrack || null; saveUser(); mxRenderOwnMusic();
      F.toast(inProfile ? 'Трек убран из профиля' : 'Трек стоит в вашем профиле');
      if (key && currentReelsAudioId === key) renderModalActions(key);
      refreshLists();
    } catch (e) { F.toast(F.err(e)); }
  };

  /* ───────── строки треков (общий компонент) ───────── */
  function rowHtml(t, actions, ownKey) {
    const key = ownKey || reg(t);
    return `<div class="mx-trk" data-pkey="${esc(key)}">
      <button class="mx-trk-play" onclick="mxF_toggle('${esc(key)}')" aria-label="Играть">${PLAY}</button>
      <div class="mx-trk-main" onclick="mxF_openModal('${esc(key)}')">
        <div class="mx-trk-title">${esc(t.title || 'Без названия')}</div>
        <div class="mx-trk-sub">${esc(t.artist || '')}${t.durationSec ? ' · ' + esc(fmt(t.durationSec)) : ''}<span class="mx-trk-time"></span></div>
        <div class="mx-trk-bar" onclick="event.stopPropagation();mxF_seek(event,'${esc(key)}')"><i class="mx-trk-fill"></i></div>
      </div>
      ${actions || ''}</div>`;
  }
  window.mxF_toggle = (key) => toggle(key);
  window.mxF_seek = (e, key) => { const r = e.currentTarget.getBoundingClientRect(); seek(key, (e.clientX - r.left) / r.width); };
  window.mxF_openModal = (key) => { currentReelsAudioId = key; openAudioModal(); };
  const act = (title, ico, js, on) => `<button class="mx-trk-act${on ? ' on' : ''}" title="${title}" onclick="event.stopPropagation();${js}">${ico}</button>`;

  /* ───────── «Моя музыка»: мои треки, сохранённые у других, звуки из Reels ───────── */
  let libOpen = false;
  window.mxOpenMusicLibrary = function () {
    libOpen = true;
    F.sheet('mx-lib', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxCloseMusicLibrary()">${F.svg('back', 22)}</button><div class="mx-f-htitle">Моя музыка</div></div>
      <div class="mx-f-body" id="mx-lib-body"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true });
    loadLib();
  };
  window.mxCloseMusicLibrary = function () { libOpen = false; if (audio && !audio.paused) audio.pause(); F.closeSheet('mx-lib'); };

  async function loadLib() {
    const body = $('mx-lib-body'); if (!body) return;
    let mine = [], saved = [];
    try { mine = (await MchatAPI.myTracks()).tracks; } catch (e) { /* покажем пусто */ }
    try { saved = (await MchatAPI.savedTracks()).tracks; savedIds.clear(); saved.forEach((t) => savedIds.add(t.id)); savedLoaded = true; } catch (e) { /* ничего */ }
    if (!$('mx-lib-body')) return;
    const curId = currentUser && currentUser.musicTrack && currentUser.musicTrack.id;
    const own = (t) => Object.assign({ artist: '@' + currentUser.username, mine: true }, t);
    const reels = (typeof savedTracks !== 'undefined' ? savedTracks : []).map((t) => ({ t, a: audioRegistry[t.id] })).filter((x) => x.a);
    body.innerHTML = `
      <button class="mx-f-upload" onclick="mxOpenTrackPicker()"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Загрузить свой трек</button>
      <div class="mx-f-sect">Мои треки</div>
      ${mine.length ? mine.map((t) => rowHtml(own(t), act('Поставить в профиль', STAR(curId === t.id), `mxTrackToProfile('${esc(t.id)}','srv_${esc(t.id)}')`, curId === t.id) + act('Удалить', TRASH, `mxLibDelete('${esc(t.id)}')`))).join('') : '<div class="mx-f-empty small">Пока нет загруженных треков</div>'}
      <div class="mx-f-sect">Сохранённые из чужих профилей</div>
      ${saved.length ? saved.map((t) => rowHtml(t, act('Поставить в профиль', STAR(curId === t.id), `mxTrackToProfile('${esc(t.id)}','srv_${esc(t.id)}')`, curId === t.id) + act('Убрать из сохранённых', BOOK(true), `mxTrackSaveToggle('${esc(t.id)}')`, true))).join('')
        : '<div class="mx-f-empty small">Открой профиль человека и сохрани его трек — он появится здесь</div>'}
      ${reels.length ? `<div class="mx-f-sect">Звуки из Reels</div>${reels.map((x) => rowHtml({ title: x.a.title, artist: x.a.artist }, act('Убрать', TRASH, `mxLibRemoveReel('${esc(x.t.id)}')`), x.t.id)).join('')}` : ''}`;
    sync();
  }
  function refreshLists() { if (libOpen && $('mx-lib-body')) loadLib(); if ($('mx-ut-body')) loadUserTracks(); }
  window.mxLibDelete = function (id) {
    showConfirm('Удалить трек?', async () => {
      try {
        await MchatAPI.deleteMedia(id);
        if (currentUser.musicTrack && currentUser.musicTrack.id === id) { currentUser.musicTrack = null; saveUser(); mxRenderOwnMusic(); }
        if (curKey === 'srv_' + id && audio) audio.pause();
        F.toast('Трек удалён'); refreshLists();
      } catch (e) { F.toast(F.err(e)); }
    });
  };
  window.mxLibRemoveReel = function (id) {
    const i = savedTracks.findIndex((t) => t.id === id);
    if (i >= 0) { savedTracks.splice(i, 1); saveSavedTracks(); if (typeof renderPinnedTracks === 'function') renderPinnedTracks(); }
    refreshLists();
  };
  // после загрузки нового трека обновляем библиотеку
  const _chosen = window.mxTrackChosen;
  if (typeof _chosen === 'function') window.mxTrackChosen = async function () { await _chosen.apply(this, arguments); refreshLists(); };

  /* ───────── треки другого пользователя: слушать, сохранить, поставить к себе ───────── */
  let utName = null;
  window.mxOpenUserTracks = function (username) {
    utName = username;
    F.sheet('mx-usertracks', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxCloseUserTracks()">${F.svg('back', 22)}</button><div class="mx-f-htitle">Музыка @${esc(username)}</div></div>
      <div class="mx-f-body" id="mx-ut-body"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true });
    loadUserTracks();
  };
  window.mxCloseUserTracks = function () { if (audio && !audio.paused) audio.pause(); F.closeSheet('mx-usertracks'); };
  async function loadUserTracks() {
    const body = $('mx-ut-body'); if (!body || !utName) return;
    try {
      await loadSavedIds();
      const r = await MchatAPI.userTracks(utName);
      if (!$('mx-ut-body')) return;
      const curId = currentUser && currentUser.musicTrack && currentUser.musicTrack.id;
      body.innerHTML = r.tracks.length ? r.tracks.map((t) => {
        const saved = t.mine || savedIds.has(t.id);
        return rowHtml(t,
          (t.mine ? '' : act(saved ? 'Убрать из сохранённых' : 'Сохранить себе', BOOK(saved), `mxTrackSaveToggle('${esc(t.id)}')`, saved)) +
          act(curId === t.id ? 'Убрать из моего профиля' : 'Поставить в мой профиль', STAR(curId === t.id), `mxTrackToProfile('${esc(t.id)}','srv_${esc(t.id)}')`, curId === t.id));
      }).join('') : '<div class="mx-f-empty">У пользователя нет треков</div>';
      sync();
    } catch (e) { if ($('mx-ut-body')) $('mx-ut-body').innerHTML = '<div class="mx-f-empty">' + esc(F.err(e)) + '</div>'; }
  }

  /* ───────── сохранённые «звуки» из Reels: вместо мёртвых квадратов — рабочие строки ───────── */
  const _tab = window.renderProfileTracksTab;
  if (typeof _tab === 'function') {
    window.renderProfileTracksTab = async function () {
      await _tab.apply(this, arguments);
      document.querySelectorAll('.track-card').forEach((c) => { c.style.cursor = 'pointer'; });
    };
  }
})();

/* ───────────────────────── D. «МОМЕНТ» — живой дневник / стена ─────────────────────────
 * Фото/видео + заметка + трек дня. Свежий (до 24 часов) момент подсвечивает иконку модуля в профиле,
 * затем остаётся на стене как хроника. Просмотры уникальные (автор и гости), комментарии можно отключить.
 * Бэкенд: REST /api/moments + WebSocket moment:create | list | get | view | comments | comment | subscribe. */
(function () {
  'use strict';
  const F = window.MxF, $ = F.$;
  const cache = {};             // id → момент
  const viewedLocal = new Set(); // кого уже отправили на сервер в этой сессии
  let wall = { host: null, username: null, own: false, before: null, hasMore: false, seq: 0 };
  const MAX_TEXT = 500;
  const EYE = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const CHAT = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
  const PLAYI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  const SPARK = '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

  /** WebSocket с подтверждением; если сокет недоступен — тот же запрос по REST. */
  async function call(event, payload, rest) {
    try { return await MchatAPI.emit(event, payload); }
    catch (e) { if (e && (e.code === 'offline' || e.code === 'timeout')) return rest(); throw e; }
  }
  const pluralV = (n) => mxPlural(n, ['просмотр', 'просмотра', 'просмотров']);

  /* ───────── карточка момента ───────── */
  function vibeHtml(m) {
    const key = F.regTrack(m.track);
    return `<div class="mx-m-vibe" data-pkey="${esc(key)}">
      <button class="mx-trk-play" onclick="mxF_toggle('${esc(key)}')" aria-label="Играть">${PLAYI}</button>
      <div class="mx-m-vtxt" onclick="mxF_openModal('${esc(key)}')"><span class="mx-m-vt">♪ ${esc(m.track.title)}</span><span class="mx-m-va">${esc(m.track.artist)} · трек дня</span></div>
      <span class="mx-eq" aria-hidden="true"><i></i><i></i><i></i></span>
      <div class="mx-trk-bar" onclick="mxF_seek(event,'${esc(key)}')"><i class="mx-trk-fill"></i></div>
    </div>`;
  }
  function cardHtml(m, i) {
    const media = m.mediaUrl
      ? (m.mediaType === 'video'
        ? `<div class="mx-m-mwrap"><video class="mx-m-media" src="${esc(m.mediaUrl)}" controls playsinline preload="metadata"></video></div>`
        : `<div class="mx-m-mwrap"><img class="mx-m-media" src="${esc(m.mediaUrl)}" loading="lazy" alt="" onclick="mxZoomOpen(this.currentSrc||this.src)"></div>`)
      : '';
    const text = m.text ? `<div class="mx-m-text${m.mediaUrl ? '' : ' big'}">${esc(m.text)}</div>` : '';
    return `<article class="mx-m-card${m.active ? ' live' : ''}" data-mid="${m.id}" style="animation-delay:${Math.min(i || 0, 8) * 45}ms">
      <header class="mx-m-head">${F.avatar({ name: m.name, avatar: m.avatar }, 38)}
        <div class="mx-m-who"><div class="mx-m-name">${esc(m.name || m.username)}${m.verified ? F.badge({ verified: true }) : ''}</div>
        <div class="mx-m-time">${esc(F.timeLabel(m.createdAt))}${m.active ? ' <span class="mx-m-livetag">24 ч</span>' : ''}</div></div>
        ${m.mine ? `<button class="mx-m-menu" aria-label="Меню" onclick="mxMomentMenu(${m.id})">${F.svg('more', 20)}</button>` : ''}
      </header>
      ${media}${text}${m.track ? vibeHtml(m) : ''}
      <footer class="mx-m-foot">
        <span class="mx-m-views" title="Уникальные просмотры (автор и гости)">${EYE}<b>${m.views}</b></span>
        <button class="mx-m-cbtn" onclick="mxMomentComments(${m.id},this)">${CHAT}<b class="mx-m-ccount">${m.commentsCount}</b><span class="mx-m-coff">${m.commentsEnabled ? '' : ' · выкл'}</span></button>
      </footer>
      <div class="mx-m-comments" hidden></div>
    </article>`;
  }

  /* ───────── просмотры: считаем, когда карточка реально была на экране ───────── */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      clearTimeout(en.target._mt);
      if (en.isIntersecting) en.target._mt = setTimeout(() => countView(+en.target.dataset.mid), 900);
    });
  }, { threshold: 0.5 }) : null;
  function watch(root) { root.querySelectorAll('.mx-m-card').forEach((c) => { if (io) io.observe(c); else countView(+c.dataset.mid); }); }
  async function countView(id) {
    if (!id || viewedLocal.has(id)) return;
    viewedLocal.add(id);
    try {
      const r = await call('moment:view', { id }, () => MchatAPI.viewMoment(id));
      setViews(id, r.views);
    } catch (e) { viewedLocal.delete(id); }
  }
  function setViews(id, n) {
    if (cache[id]) cache[id].views = n;
    document.querySelectorAll(`.mx-m-card[data-mid="${id}"] .mx-m-views b`).forEach((b) => { b.textContent = n; });
  }

  /* ───────── стена ───────── */
  function composerBar() {
    return `<button class="mx-m-new" onclick="mxMomentCompose()"><span class="mx-m-newico">${SPARK}</span><span class="mx-m-newtxt"><b>Что происходит сейчас?</b><small>Фото, мысли дня и трек — виден 24 часа и остаётся на стене</small></span></button>`;
  }
  function render(host, username, own) {
    wall = { host, username, own, before: null, hasMore: false, seq: wall.seq + 1 };
    host.innerHTML = `<div class="mx-m-wrap">${own ? composerBar() : ''}<div class="mx-m-list"><div class="mx-f-empty">Загрузка…</div></div><div class="mx-m-more"></div></div>`;
    load(wall.seq, false);
  }
  async function load(seq, more) {
    const host = wall.host; if (!host) return;
    const list = host.querySelector('.mx-m-list'), moreBox = host.querySelector('.mx-m-more');
    try {
      const before = more ? wall.before : undefined;
      const r = await call('moment:list', { username: wall.username, before }, () => MchatAPI.listMoments(wall.username, before));
      if (seq !== wall.seq || !list.isConnected) return;
      r.moments.forEach((m) => { cache[m.id] = m; });
      if (!more) {
        list.innerHTML = r.moments.length ? '' : `<div class="mx-f-empty">${wall.own ? 'Пока нет моментов. Поделись тем, что происходит прямо сейчас' : 'Пока нет моментов'}</div>`;
        if (wall.own) { F.momentLastAt = r.moments.length ? Date.parse(r.moments[0].createdAt) : -1; currentUser.momentActive = !!r.active; F.updateMomentIndicator(); }
      }
      list.insertAdjacentHTML('beforeend', r.moments.map((m, i) => cardHtml(m, i)).join(''));
      if (r.moments.length) wall.before = r.moments[r.moments.length - 1].id;
      wall.hasMore = r.hasMore;
      moreBox.innerHTML = r.hasMore ? '<button class="mx-f-btn ghost" onclick="mxMomentMore()">Показать ещё</button>' : '';
      watch(list);
    } catch (e) { if (list.isConnected) list.innerHTML = '<div class="mx-f-empty">' + esc(F.err(e)) + '</div>'; }
  }
  window.mxMomentMore = function () { if (wall.hasMore) load(wall.seq, true); };
  window.mxMomentRenderOwn = function (cont) { render(cont, currentUser.username, true); };
  window.mxMomentRenderUser = function (grid, username) { render(grid, username, false); };

  /* ───────── меню автора, комментарии вкл/выкл, удаление ───────── */
  window.mxMomentMenu = function (id) {
    const m = cache[id]; if (!m) return;
    F.sheet('mx-m-menu', `<div class="mx-f-grip"></div>
      <div class="mx-f-row static"><span class="mx-f-rico">${CHAT}</span><span class="mx-f-rtxt">Комментарии<small>${m.commentsEnabled ? 'Включены' : 'Отключены'}</small></span>${mxSwitchHtml(m.commentsEnabled, `mxMomentToggleComments(${id})`)}</div>
      <button class="mx-f-row" onclick="mxMomentDelete(${id})"><span class="mx-f-rico danger">${F.svg('x', 18)}</span><span class="mx-f-rtxt danger">Удалить момент</span></button>
      <button class="mx-f-cancel" onclick="mxFClose('mx-m-menu')">Закрыть</button>`, { z: 890 });
  };
  window.mxMomentToggleComments = async function (id) {
    const m = cache[id]; if (!m) return;
    try {
      const r = await MchatAPI.setMomentComments(id, !m.commentsEnabled);
      applyCommentsFlag(id, r.commentsEnabled);
      F.closeSheet('mx-m-menu');
      F.toast(r.commentsEnabled ? 'Комментарии включены' : 'Комментарии отключены');
    } catch (e) { F.toast(F.err(e)); }
  };
  function applyCommentsFlag(id, enabled) {
    if (cache[id]) cache[id].commentsEnabled = enabled;
    document.querySelectorAll(`.mx-m-card[data-mid="${id}"]`).forEach((card) => {
      const off = card.querySelector('.mx-m-coff'); if (off) off.textContent = enabled ? '' : ' · выкл';
      const panel = card.querySelector('.mx-m-comments');
      if (panel && !panel.hidden) renderPanel(card, id);
    });
  }
  window.mxMomentDelete = function (id) {
    F.closeSheet('mx-m-menu');
    showConfirm('Удалить момент?', async () => {
      try { await MchatAPI.deleteMoment(id); removeCards(id); F.toast('Момент удалён'); }
      catch (e) { F.toast(F.err(e)); }
    });
  };
  function removeCards(id) {
    document.querySelectorAll(`.mx-m-card[data-mid="${id}"]`).forEach((c) => { c.classList.add('out'); setTimeout(() => { c.remove(); emptyCheck(); }, 220); });
    delete cache[id];
  }
  function emptyCheck() {
    const host = wall.host; if (!host) return;
    const list = host.querySelector('.mx-m-list');
    if (list && !list.querySelector('.mx-m-card')) list.innerHTML = `<div class="mx-f-empty">${wall.own ? 'Пока нет моментов. Поделись тем, что происходит прямо сейчас' : 'Пока нет моментов'}</div>`;
    if (wall.own) {
      const first = list && list.querySelector('.mx-m-card');
      F.momentLastAt = first && cache[+first.dataset.mid] ? Date.parse(cache[+first.dataset.mid].createdAt) : -1;
      F.updateMomentIndicator();
    }
  }

  /* ───────── комментарии ───────── */
  const panelData = {}; // id → { comments, enabled }
  window.mxMomentComments = async function (id, btn) {
    const card = btn.closest('.mx-m-card'), panel = card.querySelector('.mx-m-comments');
    if (!panel.hidden) { panel.hidden = true; MchatAPI.emit('moment:unsubscribe', { id }).catch(() => {}); return; }
    panel.hidden = false;
    panel.innerHTML = '<div class="mx-f-empty small">Загрузка…</div>';
    try {
      const r = await call('moment:comments', { id }, () => MchatAPI.momentComments(id));
      panelData[id] = { comments: r.comments, enabled: r.enabled };
      renderPanel(card, id);
      MchatAPI.emit('moment:subscribe', { id }).catch(() => {}); // живые комментарии
    } catch (e) { panel.innerHTML = '<div class="mx-f-empty small">' + esc(F.err(e)) + '</div>'; }
  };
  function commentHtml(c, momentMine) {
    return `<div class="mx-mc" data-cid="${c.id}">${F.avatar(c.user, 30)}
      <div class="mx-mc-body"><div class="mx-mc-top"><b>${esc(c.user.name || c.user.username)}</b><span>${esc(F.timeLabel(c.createdAt))}</span></div><div class="mx-mc-text">${esc(c.text)}</div></div>
      ${c.mine || momentMine ? `<button class="mx-mc-del" aria-label="Удалить" onclick="mxMomentDelComment(${c.momentId},${c.id})">${F.svg('x', 14)}</button>` : ''}</div>`;
  }
  function renderPanel(card, id) {
    const panel = card.querySelector('.mx-m-comments'), d = panelData[id] || { comments: [], enabled: !!(cache[id] && cache[id].commentsEnabled) };
    const m = cache[id], enabled = m ? m.commentsEnabled : d.enabled;
    const mine = !!(m && m.mine);
    panel.innerHTML = `<div class="mx-mc-list">${d.comments.length ? d.comments.map((c) => commentHtml(c, mine)).join('') : '<div class="mx-f-empty small">Комментариев пока нет</div>'}</div>
      ${enabled ? `<div class="mx-mc-form"><input class="mx-mc-input" maxlength="500" placeholder="Написать комментарий…" autocomplete="off" onkeydown="if(event.key==='Enter')mxMomentSend(${id},this)"><button class="mx-f-btn" onclick="mxMomentSend(${id},this.previousElementSibling)">Отправить</button></div>`
        : '<div class="mx-f-empty small">Автор отключил комментарии</div>'}`;
  }
  function addCommentToPanels(c, count) {
    const d = panelData[c.momentId]; if (d && !d.comments.some((x) => x.id === c.id)) d.comments.push(c);
    document.querySelectorAll(`.mx-m-card[data-mid="${c.momentId}"]`).forEach((card) => {
      const cnt = card.querySelector('.mx-m-ccount'); if (cnt && count != null) cnt.textContent = count;
      const list = card.querySelector('.mx-mc-list');
      if (list && !card.querySelector('.mx-m-comments').hidden && !list.querySelector(`[data-cid="${c.id}"]`)) {
        const empty = list.querySelector('.mx-f-empty'); if (empty) empty.remove();
        list.insertAdjacentHTML('beforeend', commentHtml(Object.assign({}, c, { mine: !!(currentUser && c.user.id === currentUser.id) }), !!(cache[c.momentId] && cache[c.momentId].mine)));
        list.scrollTop = list.scrollHeight;
      }
    });
    if (cache[c.momentId] && count != null) cache[c.momentId].commentsCount = count;
  }
  window.mxMomentSend = async function (id, input) {
    const text = (input.value || '').trim(); if (!text) return;
    input.value = ''; input.disabled = true;
    try {
      const r = await call('moment:comment', { id, text }, () => MchatAPI.addMomentComment(id, text));
      const c = r.comment;
      const count = ((cache[id] && cache[id].commentsCount) || 0) + 1;
      addCommentToPanels(c, Math.max(count, document.querySelectorAll(`.mx-m-card[data-mid="${id}"] .mx-mc`).length));
    } catch (e) { input.value = text; F.toast(F.err(e)); }
    finally { input.disabled = false; input.focus(); }
  };
  window.mxMomentDelComment = async function (id, cid) {
    try {
      const r = await MchatAPI.deleteMomentComment(id, cid);
      dropComment(id, cid, r.count);
    } catch (e) { F.toast(F.err(e)); }
  };
  function dropComment(id, cid, count) {
    if (panelData[id]) panelData[id].comments = panelData[id].comments.filter((c) => c.id !== cid);
    document.querySelectorAll(`.mx-m-card[data-mid="${id}"]`).forEach((card) => {
      const el = card.querySelector(`.mx-mc[data-cid="${cid}"]`); if (el) el.remove();
      const cnt = card.querySelector('.mx-m-ccount'); if (cnt) cnt.textContent = count;
    });
    if (cache[id]) cache[id].commentsCount = count;
  }

  /* ───────── окно публикации ───────── */
  let cp = null;
  window.mxMomentCompose = function () {
    cp = { file: null, url: null, trackId: null, trackTitle: '', comments: true, busy: false };
    F.sheet('mx-m-compose', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxMomentComposeClose()">${F.svg('x', 22)}</button><div class="mx-f-htitle">Новый момент</div>
        <button class="mx-f-btn" id="mx-m-pub" onclick="mxMomentPublish()">Опубликовать</button></div>
      <div class="mx-f-body">
        <div class="mx-m-pick" id="mx-m-pick" onclick="document.getElementById('mx-m-file').click()">
          <div class="mx-m-pickph">${SPARK}<b>Добавить фото или видео</b><small>Прогулка, тренировка, учёба — что угодно</small></div></div>
        <input type="file" id="mx-m-file" accept="image/*,video/*" hidden onchange="mxMomentPicked(event)">
        <textarea class="mx-m-ta" id="mx-m-text" maxlength="${MAX_TEXT}" rows="3" placeholder="Мысли дня…" oninput="mxMomentCount()"></textarea>
        <div class="mx-m-cnt" id="mx-m-cnt">0 / ${MAX_TEXT}</div>
        <button class="mx-f-row" onclick="mxMomentPickTrack()"><span class="mx-f-rico">♪</span><span class="mx-f-rtxt" id="mx-m-trk">Добавить трек дня<small>Вайб момента — из своих или сохранённых треков</small></span></button>
        <div class="mx-f-row static"><span class="mx-f-rico">${CHAT}</span><span class="mx-f-rtxt">Комментарии<small>Можно отключить</small></span><span id="mx-m-sw">${mxSwitchHtml(true, 'mxMomentSwitch()')}</span></div>
        <div class="mx-m-prog" id="mx-m-prog" hidden><i></i></div>
      </div>`, { full: true, z: 885 });
  };
  window.mxMomentComposeClose = function () { if (cp && cp.busy) return; if (cp && cp.url) URL.revokeObjectURL(cp.url); cp = null; F.closeSheet('mx-m-compose'); };
  window.mxMomentCount = function () { const t = $('mx-m-text'), c = $('mx-m-cnt'); if (t && c) c.textContent = t.value.length + ' / ' + MAX_TEXT; };
  window.mxMomentSwitch = function () { cp.comments = !cp.comments; $('mx-m-sw').innerHTML = mxSwitchHtml(cp.comments, 'mxMomentSwitch()'); };
  window.mxMomentPicked = function (e) {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file || !cp) return;
    const video = file.type.startsWith('video/');
    if (!video && !file.type.startsWith('image/')) { F.toast('Выбери фото или видео'); return; }
    if (file.size > (video ? 60 : 12) * 1024 * 1024) { F.toast(video ? 'Видео слишком большое (до 60 МБ)' : 'Фото слишком большое (до 12 МБ)'); return; }
    if (cp.url) URL.revokeObjectURL(cp.url);
    cp.file = file; cp.url = URL.createObjectURL(file);
    $('mx-m-pick').innerHTML = (video ? `<video src="${cp.url}" muted playsinline autoplay loop></video>` : `<img src="${cp.url}" alt="">`) +
      '<button class="mx-m-pickx" type="button" onclick="event.stopPropagation();mxMomentClearMedia()">✕</button>';
    $('mx-m-pick').classList.add('has');
  };
  window.mxMomentClearMedia = function () {
    if (!cp) return;
    if (cp.url) URL.revokeObjectURL(cp.url);
    cp.file = null; cp.url = null;
    const p = $('mx-m-pick'); p.classList.remove('has');
    p.innerHTML = `<div class="mx-m-pickph">${SPARK}<b>Добавить фото или видео</b><small>Прогулка, тренировка, учёба — что угодно</small></div>`;
  };

  /* трек дня */
  window.mxMomentPickTrack = async function () {
    F.sheet('mx-m-tracks', `<div class="mx-f-head"><button class="mx-f-x" onclick="mxFClose('mx-m-tracks')">${F.svg('back', 22)}</button><div class="mx-f-htitle">Трек дня</div></div>
      <div class="mx-f-body" id="mx-m-tbody"><div class="mx-f-empty">Загрузка…</div></div>`, { full: true, z: 895 });
    let mine = [], saved = [];
    try { mine = (await MchatAPI.myTracks()).tracks; } catch (e) { /* ничего */ }
    try { saved = (await MchatAPI.savedTracks()).tracks; } catch (e) { /* ничего */ }
    const body = $('mx-m-tbody'); if (!body) return;
    const row = (t, artist) => `<button class="mx-f-row ${cp && cp.trackId === t.id ? 'sel' : ''}" onclick="mxMomentSetTrack('${esc(t.id)}','${esc((t.title || 'Без названия').replace(/'/g, ''))}')"><span class="mx-f-rico">♪</span><span class="mx-f-rtxt">${esc(t.title || 'Без названия')}<small>${esc(artist)}</small></span></button>`;
    body.innerHTML = `<button class="mx-f-upload" onclick="document.getElementById('mx-m-audio').click()">Загрузить новый трек</button>
      <input type="file" id="mx-m-audio" accept="audio/*" hidden onchange="mxMomentUploadTrack(event)">
      ${cp && cp.trackId ? '<button class="mx-f-row" onclick="mxMomentSetTrack(null,\'\')"><span class="mx-f-rico danger">✕</span><span class="mx-f-rtxt danger">Убрать трек</span></button>' : ''}
      <div class="mx-f-sect">Мои треки</div>${mine.length ? mine.map((t) => row(t, '@' + currentUser.username)).join('') : '<div class="mx-f-empty small">Нет загруженных треков</div>'}
      <div class="mx-f-sect">Сохранённые</div>${saved.length ? saved.map((t) => row(t, t.artist)).join('') : '<div class="mx-f-empty small">Нет сохранённых треков</div>'}`;
  };
  window.mxMomentSetTrack = function (id, title) {
    if (!cp) return;
    cp.trackId = id; cp.trackTitle = title;
    const l = $('mx-m-trk'); if (l) l.innerHTML = id ? `♪ ${esc(title)}<small>Трек дня · нажми, чтобы изменить</small>` : 'Добавить трек дня<small>Вайб момента — из своих или сохранённых треков</small>';
    F.closeSheet('mx-m-tracks');
  };
  window.mxMomentUploadTrack = async function (e) {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file || !cp) return;
    try {
      F.toast('Загружаю трек…');
      const duration = await mxProbeAudioDuration(file).catch(() => 0);
      const media = await MchatAPI.uploadMedia('track', file, { duration, name: file.name });
      mxMomentSetTrack(media.id, media.title || file.name);
    } catch (err) { F.toast(F.err(err)); }
  };

  window.mxMomentPublish = async function () {
    if (!cp || cp.busy) return;
    const text = ($('mx-m-text').value || '').trim();
    if (!text && !cp.file) { F.toast('Добавь фото или напиши заметку'); return; }
    cp.busy = true;
    const btn = $('mx-m-pub'), prog = $('mx-m-prog');
    btn.disabled = true; btn.textContent = 'Публикуем…';
    try {
      let mediaId = null;
      if (cp.file) {
        prog.hidden = false;
        const kind = cp.file.type.startsWith('video/') ? 'video' : 'image';
        const media = await MchatAPI.uploadMedia(kind, cp.file, { onProgress: (p) => { const i = prog.firstElementChild; if (i) i.style.width = p + '%'; } });
        mediaId = media.id;
      }
      const body = { text, mediaId, trackId: cp.trackId || null, commentsEnabled: cp.comments };
      const r = await call('moment:create', body, () => MchatAPI.createMoment(body));
      const m = r.moment;
      cache[m.id] = m;
      cp.busy = false;
      mxMomentComposeClose();
      currentUser.momentActive = true; F.momentLastAt = Date.parse(m.createdAt); F.updateMomentIndicator();
      if (wall.own && wall.host && wall.host.isConnected) {
        const list = wall.host.querySelector('.mx-m-list');
        const empty = list.querySelector('.mx-f-empty'); if (empty) empty.remove();
        list.insertAdjacentHTML('afterbegin', cardHtml(m, 0));
        watch(list);
      }
      F.toast('Момент опубликован ✨');
    } catch (e) {
      cp.busy = false; btn.disabled = false; btn.textContent = 'Опубликовать'; prog.hidden = true;
      F.toast(F.err(e));
    }
  };

  /* ───────── живые события сокета ───────── */
  MchatAPI.on('moment:views', (p) => { if (p && p.id) setViews(p.id, p.views); });
  MchatAPI.on('moment:comment', (p) => { if (p && p.comment) addCommentToPanels(p.comment, p.count); });
  MchatAPI.on('moment:comment_deleted', (p) => { if (p) dropComment(p.id, p.commentId, p.count); });
  MchatAPI.on('moment:comments_toggle', (p) => { if (p) applyCommentsFlag(p.id, p.enabled); });
  MchatAPI.on('moment:deleted', (p) => { if (p && p.id) removeCards(p.id); });
  MchatAPI.on('moment:new', (p) => {
    if (!p || !currentUser) return;
    if (p.username === currentUser.username) { currentUser.momentActive = true; F.momentLastAt = Date.now(); F.updateMomentIndicator(); }
    if (typeof upViewedUsername !== 'undefined' && upViewedUsername === p.username) {
      if (upProfileInfo) upProfileInfo.momentActive = true;
      const t = $('uptab-moment'); if (t) t.classList.add('mx-moment-live');
    }
    // стена открыта у этого автора — подтягиваем новый момент
    if (wall.host && wall.host.isConnected && wall.username === p.username && !(cp && cp.busy) && !wall.host.querySelector(`.mx-m-card[data-mid="${p.id}"]`)) render(wall.host, wall.username, wall.own);
  });
})();