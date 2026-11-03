/*
 * Mchat — официальные системные аккаунты («Mchat — Безопасность» и «Mchat — Новости»).
 *
 * Здесь ТОЛЬКО отображение. Что аккаунт официальный, решает сервер (поле official в данных пользователя/чата);
 * подделать это изменением интерфейса нельзя: писать в такой аккаунт, подтверждать/отклонять вход и публиковать новости
 * сервер всё равно проверяет сам.
 *
 * Логотипы: положите файлы в public/img/mchat-security.png (буква M со щитом и замком) и public/img/mchat-news.png
 * (обычная буква M). Пока файлов нет, показываются встроенные запасные значки.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var toast = function (m) { try { window.showToast(m); } catch (e) { /* ничего */ } };
  var LOGO = { SECURITY: '/img/mchat-security.png', NEWS: '/img/mchat-news.png' };
  var LABEL = { SECURITY: 'Безопасность', NEWS: 'Новости' };   // подписи переводятся словарём i18n

  // Запасные значки, пока нет файлов логотипов
  var FALLBACK = {
    SECURITY: '<svg viewBox="0 0 48 48" width="100%" height="100%"><rect width="48" height="48" fill="#1f2a6b"/><path d="M24 6l14 5v11c0 9-6 16-14 20C16 38 10 31 10 22V11z" fill="#4a4af0"/><path d="M15 31V20l5 6 4-8 4 8 5-6v11" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" transform="translate(0 -4) scale(1 .9) translate(0 4)"/><rect x="19.5" y="29" width="9" height="7" rx="1.6" fill="#fff"/><path d="M21.5 29v-2a2.5 2.5 0 015 0v2" fill="none" stroke="#fff" stroke-width="1.8"/></svg>',
    NEWS: '<svg viewBox="0 0 48 48" width="100%" height="100%"><rect width="48" height="48" fill="#4a4af0"/><path d="M11 36V13l13 14 13-14v23" fill="none" stroke="#fff" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  };

  var kindOfChat = function (ch) { return ch && ch.peer && ch.peer.official || null; };
  var OFFICIAL_BADGE = '<span class="mx-official-badge" title="Официальный аккаунт Mchat" aria-label="Официальный аккаунт Mchat"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';

  /** Круглый логотип официального аккаунта (если файла нет — запасной значок под ним). */
  window.mxOfficialLogoHtml = function (kind) {
    if (!LOGO[kind]) return '';
    return '<span class="mx-off-logo">' + FALLBACK[kind] + '<img src="' + LOGO[kind] + '" alt="" onerror="this.remove()"></span>';
  };

  // ── аватар в списке чатов ──
  (function () {
    var _av = window.chatAvatarHtml;
    if (typeof _av !== 'function') return;
    window.chatAvatarHtml = function (ch) { var k = kindOfChat(ch); return k ? window.mxOfficialLogoHtml(k) : _av.apply(this, arguments); };
  })();

  // ── значок и подпись «Безопасность / Новости» рядом с именем в списке ──
  function decorateList() {
    var list = $('chats-list'); if (!list || typeof chats === 'undefined') return;
    list.querySelectorAll('.chat-item[data-chat-id]').forEach(function (it) {
      var ch = chats.find(function (c) { return c.id === it.getAttribute('data-chat-id'); });
      var k = kindOfChat(ch);
      var nm = it.querySelector('.chat-name');
      if (!k || !nm || nm.querySelector('.mx-official-badge')) return;
      nm.insertAdjacentHTML('beforeend', OFFICIAL_BADGE + '<span class="mx-official-sub">' + esc(LABEL[k]) + '</span>');
    });
  }
  (function () {
    var _rc = window.renderChats;
    if (typeof _rc !== 'function') return;
    window.renderChats = function () { var r = _rc.apply(this, arguments); try { decorateList(); } catch (e) { /* ничего */ } return r; };
  })();

  // ── шапка открытого чата ──
  (function () {
    var _ap = window.mxApplyChatInputState;
    if (typeof _ap !== 'function') return;
    window.mxApplyChatInputState = function (ch) {
      var r = _ap.apply(this, arguments);
      try {
        var k = kindOfChat(ch);
        if (k) {
          $('chat-name').innerHTML = esc(ch.name) + OFFICIAL_BADGE + '<span class="mx-official-sub">' + esc(LABEL[k]) + '</span>';
          $('chat-open-av').innerHTML = window.mxOfficialLogoHtml(k);
          var st = $('chat-status'); if (st) { st.textContent = 'Официальный аккаунт Mchat'; st.style.color = 'var(--text2)'; }
        }
      } catch (e) { /* ничего */ }
      return r;
    };
  })();
  (function () {
    var _us = window.updateChatStatus;
    if (typeof _us !== 'function') return;
    window.updateChatStatus = function (ch) {
      var r = _us.apply(this, arguments);
      if (kindOfChat(ch)) { var st = $('chat-status'); if (st) { st.textContent = 'Официальный аккаунт Mchat'; st.style.color = 'var(--text2)'; } }
      return r;
    };
  })();
  // вместо поля ввода — подсказка, что писать в официальный аккаунт нельзя (сервер это тоже проверяет)
  (function () {
    var _ro = window.mxReadonlyHtml;
    if (typeof _ro !== 'function') return;
    window.mxReadonlyHtml = function (ch) {
      if (ch && ch.dm && ch.dm.reason === 'system_readonly') return 'Это официальный аккаунт Mchat — писать в него нельзя';
      return _ro.apply(this, arguments);
    };
  })();

  // ── карточка «Вход с нового устройства» ──
  var DEVICE = { phone: 'Телефон', tablet: 'Планшет', desktop: 'Компьютер', unknown: 'Неизвестно' };
  function fmtAt(iso) {
    try { return new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  window.mxSystemCardHtml = function (m) {
    var c = m.card;
    if (!c || c.type !== 'login_alert') return '<div class="mx-txt">Служебное сообщение Mchat</div>';
    var expired = c.state === 'PENDING' && c.expiresAt && Date.now() > Date.parse(c.expiresAt);
    var state = expired ? 'EXPIRED' : c.state;
    var device = [DEVICE[c.deviceType] || DEVICE.unknown, c.os].filter(Boolean).join(' · ');
    var rows = '<div class="mx-sec-row"><span>Устройство</span><b>' + esc(device) + '</b></div>'
      + '<div class="mx-sec-row"><span>Браузер или приложение</span><b>' + esc(c.client || '—') + '</b></div>'
      // местоположение — только если сервер смог определить достоверно; иначе честно «недоступно», ничего не придумываем
      + '<div class="mx-sec-row"><span>Местоположение (примерно)</span><b>' + (c.location ? esc(c.location) : '<i>Местоположение недоступно</i>') + '</b></div>'
      + '<div class="mx-sec-row"><span>Время входа</span><b>' + esc(fmtAt(c.at)) + '</b></div>';
    var foot;
    if (state === 'PENDING') {
      foot = '<div class="mx-sec-btns" data-alert="' + esc(c.alertId) + '">'
        + '<button class="mx-sec-yes" onclick="event.stopPropagation();mxSecurityAnswer(\'' + esc(c.alertId) + '\',\'confirm\',this)">Это я</button>'
        + '<button class="mx-sec-no" onclick="event.stopPropagation();mxSecurityAnswer(\'' + esc(c.alertId) + '\',\'deny\',this)">Это не я</button></div>'
        + '<div class="mx-sec-note">Пока вы не ответите, новое устройство не получит доступ к аккаунту.</div>';
    } else if (state === 'CONFIRMED') {
      foot = '<div class="mx-sec-state ok">✓ Вход подтверждён' + (c.resolvedVia === 'EMAIL' ? ' кодом из письма' : '') + '</div>';
    } else if (state === 'DENIED') {
      foot = '<div class="mx-sec-state no">✕ Вход отклонён — этот сеанс отозван на сервере</div>';
    } else {
      foot = '<div class="mx-sec-state">Время подтверждения истекло — вход отменён</div>';
    }
    return '<div class="mx-sec-card"><div class="mx-sec-title">🔐 Вход в аккаунт с нового устройства</div>' + rows + foot + '</div>';
  };

  window.mxSecurityAnswer = async function (alertId, action, btn) {
    var box = btn && btn.closest('.mx-sec-btns');
    if (box) box.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    try {
      var r = await (action === 'confirm' ? MchatAPI.securityConfirm(alertId) : MchatAPI.securityDeny(alertId));
      applyAlertState(alertId, r && r.state);
      toast(action === 'confirm' ? 'Вход подтверждён' : 'Вход отклонён, новый сеанс отозван');
    } catch (e) {
      toast(MchatAPI.errorText(e));
      if (e && (e.status === 409 || e.status === 410)) { applyAlertState(alertId, e.code === 'alert_expired' ? 'EXPIRED' : null); try { if (typeof currentChatId !== 'undefined' && currentChatId) await loadChatHistory(currentChatId); } catch (x) { /* ничего */ } }
      else if (box) box.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    }
  };
  function applyAlertState(alertId, state) {
    if (!state) return;
    try {
      Object.keys(messages).forEach(function (k) {
        (messages[k] || []).forEach(function (m) { if (m.card && m.card.alertId === alertId) m.card.state = state; });
        if (typeof currentChatId !== 'undefined' && currentChatId === k) renderMessages(k);
      });
    } catch (e) { /* ничего */ }
  }

  // ── экран нового устройства: «ждём подтверждения на другом устройстве» ──
  var poll = null;
  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }
  function showApprove(p) {
    var hint = $('code-hint'), codeRow = document.querySelector('#s-code .irow'), codeBtn = $('code-btn'), emailRow = $('code-email-row');
    var mins = p.expiresAt ? Math.max(1, Math.round((Date.parse(p.expiresAt) - Date.now()) / 60000)) : 10;
    hint.textContent = 'Подтвердите вход на другом устройстве, где вы уже вошли в Mchat: откройте чат «Mchat — Безопасность» и нажмите «Это я». Запрос действует ещё около ' + mins + ' мин.';
    var showCode = !!p.emailSent;
    if (codeRow) codeRow.style.display = showCode ? '' : 'none';
    if (codeBtn) codeBtn.style.display = showCode ? '' : 'none';
    if (emailRow) emailRow.style.display = p.canSendEmail ? 'block' : 'none';
    stopPoll();
    poll = setInterval(async function () {
      var active = document.getElementById('s-code');
      if (!active || !active.classList.contains('active')) return stopPoll();
      try {
        var s = await MchatAPI.pending();
        if (s.mode !== 'approve' || s.state === 'PENDING') return;
        stopPoll();
        if (s.state === 'CONFIRMED') { var me = await MchatAPI.me(); await onLoggedIn(me); return; }
        cancelCodeLogin();
        $('auth-err').textContent = s.state === 'DENIED' ? 'Вход отклонён: другое ваше устройство ответило «Это не я»' : MchatAPI.errorText('approval_expired');
      } catch (e) {
        stopPoll();
        // вход мог завершиться кодом из письма (cookie ожидания уже снята) — тогда сессия есть
        try { var me2 = await MchatAPI.me(); await onLoggedIn(me2); } catch (x) { cancelCodeLogin(); $('auth-err').textContent = MchatAPI.errorText('approval_expired'); }
      }
    }, 2500);
  }
  (function () {
    var _show = window.showCodeScreen;
    if (typeof _show !== 'function') return;
    window.showCodeScreen = async function () {
      var p = null;
      try { goTo('s-code'); p = await MchatAPI.pending(); } catch (e) { p = null; }
      if (p && p.mode === 'approve') {
        if (p.state !== 'PENDING') { cancelCodeLogin(); return; }
        var err = $('code-err'), input = $('code-input'); if (err) err.textContent = ''; if (input) input.value = '';
        return showApprove(p);
      }
      return _show.apply(this, arguments);
    };
    var _send = window.sendCodeByEmail;
    if (typeof _send === 'function') window.sendCodeByEmail = async function () {
      var r = await _send.apply(this, arguments);
      // код из письма — запасной способ: показываем поле ввода
      var codeRow = document.querySelector('#s-code .irow'), codeBtn = $('code-btn');
      if (poll && codeRow) { codeRow.style.display = ''; if (codeBtn) codeBtn.style.display = ''; var h = $('code-hint'); if (h) h.textContent = 'Мы отправили код на вашу почту из Google-аккаунта. Введите его, если нет доступа к другому устройству.'; }
      return r;
    };
    var _cancel = window.cancelCodeLogin;
    if (typeof _cancel === 'function') window.cancelCodeLogin = function () { stopPoll(); return _cancel.apply(this, arguments); };
  })();

  // ── админ-панель: публикация новостей и историй от имени «Mchat — Новости» (права проверяет сервер) ──
  (function () {
    var _admin = window.openAdminPanel;
    if (typeof _admin !== 'function') return;
    window.openAdminPanel = async function () {
      var r = await _admin.apply(this, arguments);
      try { mountNews(); } catch (e) { console.warn('news admin', e); }
      return r;
    };
  })();
  function mountNews() {
    var modal = document.querySelector('.modal.mx-admin'); if (!modal || modal.querySelector('#adm-news')) return;
    var scroller = modal.querySelector('.modal-box > div'); if (!scroller) return;
    var sec = document.createElement('div');
    sec.id = 'adm-news'; sec.style.cssText = 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)';
    sec.innerHTML = '<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Mchat — Новости</div>'
      + '<textarea id="adm-news-text" maxlength="4000" placeholder="Текст новости" style="width:100%;box-sizing:border-box;min-height:70px;padding:10px 12px;border-radius:10px;border:none;background:var(--surf);color:var(--text);font-family:var(--font);font-size:13px;resize:vertical;margin-bottom:6px"></textarea>'
      + '<input type="file" id="adm-news-file" accept="image/*" style="font-size:12px;margin-bottom:8px;max-width:100%">'
      + '<div style="display:flex;gap:6px;margin-bottom:8px"><button id="adm-news-pub" class="mx-adm-btn" style="background:var(--accent)">Опубликовать новость</button><button id="adm-news-story" class="mx-adm-btn" style="background:#a21caf">В истории (нужно фото)</button></div>'
      + '<div id="adm-news-list" style="font-size:12px;color:var(--text2)">Загрузка…</div>';
    scroller.insertBefore(sec, scroller.firstChild);
    var list = sec.querySelector('#adm-news-list');
    async function upload() {
      var f = sec.querySelector('#adm-news-file').files[0]; if (!f) return null;
      var file = typeof window.mxCompressImage === 'function' ? await window.mxCompressImage(f, true) : f;
      return (await MchatAPI.uploadMedia('image', file, { hd: true })).id;
    }
    async function load() {
      try {
        var d = await MchatAPI.newsList();
        list.innerHTML = d.posts.length ? d.posts.map(function (p) {
          return '<div style="background:var(--surf);border-radius:10px;padding:8px 10px;margin-bottom:6px;display:flex;gap:8px;align-items:center"><div style="flex:1;min-width:0;color:var(--text)">' + esc((p.text || (p.kind === 'IMAGE' ? '📷 Фото' : '')).slice(0, 90)) + '<div style="color:var(--text2);font-size:11px">' + esc(fmtAt(p.createdAt)) + ' · получателей: ' + p.recipients + '</div></div><button data-del="' + esc(p.id) + '" class="mx-adm-btn" style="background:#dc2626">Удалить</button></div>';
        }).join('') : 'Публикаций пока нет';
        list.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = async function () { if (!confirm('Удалить эту новость у всех пользователей?')) return; try { await MchatAPI.newsDelete(b.getAttribute('data-del')); toast('Новость удалена'); load(); } catch (e) { toast(MchatAPI.errorText(e)); } }; });
      } catch (e) { list.textContent = MchatAPI.errorText(e); }
    }
    sec.querySelector('#adm-news-pub').onclick = async function () {
      var text = sec.querySelector('#adm-news-text').value.trim();
      try {
        var mediaId = await upload();
        if (!text && !mediaId) { toast('Напишите текст или добавьте фото'); return; }
        await MchatAPI.newsPublish(text, mediaId);
        sec.querySelector('#adm-news-text').value = ''; sec.querySelector('#adm-news-file').value = '';
        toast('Новость отправляется всем пользователям'); load();
      } catch (e) { toast(MchatAPI.errorText(e)); }
    };
    sec.querySelector('#adm-news-story').onclick = async function () {
      try {
        var mediaId = await upload();
        if (!mediaId) { toast('Для истории нужно фото'); return; }
        await MchatAPI.newsStory({ mediaId: mediaId, textBlocks: [] });
        sec.querySelector('#adm-news-file').value = ''; toast('История опубликована');
      } catch (e) { toast(MchatAPI.errorText(e)); }
    };
    load();
  }
})();
