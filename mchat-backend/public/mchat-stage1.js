/* Stage 1 additions. Keep these interactions isolated from the existing chat renderer. */
(function () {
  'use strict';
  const esc = (s) => typeof window.esc === 'function' ? window.esc(String(s || '')) : String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pressTimer = null, longPressed = false, requestSeq = 0;

  function closePreview() { const n = document.getElementById('mx-chat-preview'); if (n) n.remove(); }
  function previewHtml(m) {
    if (m.viewOnce || m.kind === 'SYSTEM_CARD' || m.kind === 'CALL') return '';
    let body = m.text ? '<div class="mx1-prev-text">' + esc(m.text) + '</div>' : '';
    if (m.kind === 'POLL' && m.poll) body = '<div class="mx1-prev-text">📊 ' + esc(m.poll.question) + '</div>';
    if (m.kind === 'LOCATION') body = '<div class="mx1-prev-text">📍 Геопозиция</div>';
    if (m.mediaUrl && m.kind === 'IMAGE') body += '<img class="mx1-prev-media" src="' + esc(m.mediaUrl) + '" alt="">';
    if (m.mediaUrl && (m.kind === 'VIDEO' || m.kind === 'VIDEO_NOTE')) body += '<video class="mx1-prev-media" src="' + esc(m.mediaUrl) + '" muted playsinline preload="metadata"></video>';
    if (m.kind === 'FILE') body += '<div class="mx1-prev-file">' + esc(m.fileName || 'Файл') + '</div>';
    if (!body) return '';
    const mine = typeof currentUser !== 'undefined' && currentUser && m.senderId === currentUser.id;
    let time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return '<article class="mx1-prev-msg' + (mine ? ' mine' : '') + '">' + body + '<time>' + esc(time) + '</time></article>';
  }
  async function showPreview(chatId, anchor) {
    const seq = ++requestSeq;
    closePreview();
    const box = document.createElement('section'); box.id = 'mx-chat-preview'; box.className = 'mx1-preview';
    box.innerHTML = '<header><b>Предварительный просмотр</b><button type="button" aria-label="Закрыть">×</button></header><div class="mx1-preview-body">Загрузка…</div>';
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(10, Math.min(innerWidth - 330, r.left + r.width / 2 - 150)) + 'px';
    box.style.top = Math.max(10, Math.min(innerHeight - 380, r.top - 12)) + 'px';
    box.querySelector('header button').onclick = closePreview;
    try {
      // listMessages is a read-only endpoint; this deliberately does not call markRead/openChat.
      const data = await MchatAPI.listMessages(chatId);
      if (seq !== requestSeq || !document.getElementById('mx-chat-preview')) return;
      const rows = (data.messages || []).filter((m) => !m.viewOnce).slice(-12);
      box.querySelector('.mx1-preview-body').innerHTML = rows.map(previewHtml).join('') || '<div class="mx1-prev-empty">Сообщений пока нет</div>';
      const body = box.querySelector('.mx1-preview-body'); body.scrollTop = body.scrollHeight;
    } catch (e) { if (seq === requestSeq && box.isConnected) box.querySelector('.mx1-preview-body').textContent = 'Не удалось загрузить переписку'; }
  }

  function startPress(e) {
    const avatar = e.target.closest('#chats-list .chat-item .chat-avatar');
    if (!avatar) return;
    const row = avatar.closest('.chat-item'), id = row && row.dataset.chatId;
    const chat = typeof chats !== 'undefined' ? chats.find((c) => c.id === id) : null;
    if (!chat || chat.type !== 'DIRECT') return;
    longPressed = false; clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressed = true; if (navigator.vibrate) navigator.vibrate(12); showPreview(id, avatar); }, 500);
  }
  function cancelPress() { clearTimeout(pressTimer); }
  document.addEventListener('pointerdown', startPress, true);
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('pointermove', cancelPress, true);
  document.addEventListener('click', (e) => {
    if (longPressed) { e.preventDefault(); e.stopImmediatePropagation(); longPressed = false; return; }
    if (e.target.closest('#mx-chat-preview')) return;
    if (document.getElementById('mx-chat-preview')) closePreview();
    if (document.getElementById('mx1-attach-island') && !e.target.closest('#mx1-attach-island') && !e.target.closest('#mx-clip-btn')) closeAttachPanel();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePreview(); closeAttachPanel(); document.querySelectorAll('.mx1-modal').forEach((m) => m.remove()); } });

  function closeAttachPanel() { const n = document.getElementById('mx1-attach-island'); if (n) n.remove(); }
  window.mxAttachOpen = function () {
    if (typeof currentChatId === 'undefined' || !currentChatId) return;
    closeAttachPanel();
    const panel = document.createElement('nav'); panel.id = 'mx1-attach-island'; panel.className = 'mx1-attach-island';
    panel.innerHTML = '<button data-action="gallery"><span>▧</span>Галерея</button><button data-action="file"><span>⌕</span>Файл</button><button data-action="location"><span>⌖</span>Геопозиция</button><button data-action="poll"><span>☷</span>Опрос</button>';
    document.body.appendChild(panel);
    panel.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]'); if (!action) return;
      const key = action.dataset.action;
      if (key === 'gallery') {
        closeAttachPanel();
        showGallerySource();
      } else if (key === 'file') { closeAttachPanel(); const input = document.getElementById('mx-file-input'); if (input) { input.accept = '*/*'; input.click(); } }
      else if (key === 'location') { closeAttachPanel(); showLocationChoices(); }
      else if (key === 'poll') { closeAttachPanel(); showPollComposer(); }
    });
  };

  function showGallerySource() {
    const modal = document.createElement('div'); modal.className = 'mx1-modal';
    modal.innerHTML = '<div class="mx1-modal-card"><b>Галерея</b><button class="mx1-durations" data-pick>Выбрать фото и видео</button><button class="mx1-durations" data-camera>Открыть камеру</button><button class="mx1-cancel">Отмена</button></div>';
    document.body.appendChild(modal); modal.onclick = (e) => { if (e.target === modal) modal.remove(); }; modal.querySelector('.mx1-cancel').onclick = () => modal.remove();
    modal.querySelector('[data-pick]').onclick = () => {
      modal.remove(); let input = document.getElementById('mx1-gallery-input');
      if (!input) { input = document.createElement('input'); input.id = 'mx1-gallery-input'; input.type = 'file'; input.accept = 'image/*,video/*'; input.multiple = true; input.hidden = true; input.onchange = window.mxAttachChosen; document.body.appendChild(input); }
      input.click();
    };
    modal.querySelector('[data-camera]').onclick = async () => {
      modal.remove(); await window.mxCameraOpen();
      if (typeof mxCam !== 'undefined' && mxCam) { mxCam.attachAsVideo = true; mxCam.mode = 'photo'; document.getElementById('mx-camera').classList.add('photo'); }
    };
  }

  function showLocationChoices() {
    const modal = document.createElement('div'); modal.className = 'mx1-modal';
    modal.innerHTML = '<div class="mx1-modal-card"><b>Передать геопозицию</b><p>Продолжительность передачи</p><div class="mx1-durations"><button data-min="30">30 минут</button><button data-min="60">1 час</button><button data-min="480">8 часов</button></div><button class="mx1-cancel">Отмена</button></div>';
    document.body.appendChild(modal); modal.onclick = (e) => { if (e.target === modal) modal.remove(); }; modal.querySelector('.mx1-cancel').onclick = () => modal.remove();
    modal.querySelectorAll('[data-min]').forEach((b) => b.onclick = () => {
      if (!navigator.geolocation) { if (window.showToast) showToast('Геопозиция недоступна'); return; }
      b.disabled = true; b.textContent = 'Определяем…';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const durationMinutes = Number(b.dataset.min);
          const msg = await MchatAPI.createLocation(currentChatId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, durationMinutes });
          if (typeof window.onIncomingMessage === 'function') window.onIncomingMessage(msg);
          startLocationUpdates(msg.id, durationMinutes); modal.remove();
        } catch (err) { b.disabled = false; b.textContent = 'Повторить'; if (window.showToast) showToast(MchatAPI.errorText(err)); }
      }, () => { b.disabled = false; b.textContent = 'Не удалось определить'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  const locationWatchers = new Map();
  function startLocationUpdates(messageId, durationMinutes) {
    if (!navigator.geolocation || locationWatchers.has(messageId)) return;
    const stopAt = Date.now() + durationMinutes * 60000; let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() >= stopAt) { stop(); return; }
      if (Date.now() - lastSent < 10000) return;
      lastSent = Date.now();
      try {
        const updated = await MchatAPI.updateLocation(messageId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        if (typeof window.onIncomingMessage === 'function') window.onIncomingMessage(updated);
      } catch (err) { stop(); if (window.showToast) showToast('Передача геопозиции завершена'); }
    }, async (err) => {
      stop();
      try { const ended = await MchatAPI.stopLocation(messageId); if (typeof window.onIncomingMessage === 'function') window.onIncomingMessage(ended); } catch (e) { /* server expiry remains the upper bound */ }
      if (window.showToast) showToast(err.code === 1 ? 'Нет доступа к геопозиции' : 'Не удалось обновить геопозицию');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    const timer = setTimeout(stop, durationMinutes * 60000);
    function stop() { navigator.geolocation.clearWatch(watchId); clearTimeout(timer); locationWatchers.delete(messageId); }
    locationWatchers.set(messageId, stop);
  }
  window._mx1StopLocationWatcher = (id) => { const stop = locationWatchers.get(id); if (stop) stop(); };

  function showPollComposer() {
    const modal = document.createElement('div'); modal.className = 'mx1-modal mx1-poll-modal';
    modal.innerHTML = `<section class="mx1-poll-composer">
      <header class="mx1-poll-head"><button type="button" class="mx1-poll-close" aria-label="Назад">‹</button><div><small>Вопрос</small><h2>Новый опрос</h2></div><button type="button" class="mx1-send">Создать</button></header>
      <div class="mx1-poll-scroll">
        <div class="mx1-poll-section mx1-poll-question-section"><label class="mx1-section-title" for="mx1-poll-question">Вопрос</label><input id="mx1-poll-question" class="mx1-poll-question" maxlength="240" placeholder="Текст вопроса"><textarea class="mx1-poll-description" maxlength="500" placeholder="Описание (необязательно)"></textarea></div>
        <div class="mx1-poll-section"><label class="mx1-section-title">Варианты ответа</label><div class="mx1-poll-options"></div><button type="button" class="mx1-add-option"><span>＋</span> Добавить ответ...</button><small class="mx1-option-counter"></small></div>
        <div class="mx1-poll-section mx1-poll-settings"><label class="mx1-section-title">Настройки</label>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon blue">◉</span><span class="mx1-setting-copy"><b>Имена участников</b><small>Рядом с ответами отображаются имена всех голосовавших</small></span><input type="checkbox" data-setting="showVoters" checked><i></i></label>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon amber">▦</span><span class="mx1-setting-copy"><b>Несколько ответов</b><small>Участники могут выбрать более одного варианта</small></span><input type="checkbox" data-setting="multiple" checked><i></i></label>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon cyan">＋</span><span class="mx1-setting-copy"><b>Добавление вариантов</b><small>Участники могут предлагать новые варианты</small></span><input type="checkbox" data-setting="allowAdding" checked><i></i></label>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon violet">⟳</span><span class="mx1-setting-copy"><b>Изменение ответа</b><small>Участники могут изменить выбранный ответ</small></span><input type="checkbox" data-setting="allowRevote" checked><i></i></label>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon orange">⤨</span><span class="mx1-setting-copy"><b>Случайный порядок</b><small>Ответы отображаются в случайном порядке</small></span><input type="checkbox" data-setting="shuffleOptions" checked><i></i></label>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon green">✓</span><span class="mx1-setting-copy"><b>Правильный ответ</b><small>Отметьте правильный вариант</small></span><input type="checkbox" data-setting="quiz"><i></i></label>
          <div class="mx1-poll-extra" data-extra="quiz" hidden><select class="mx1-correct-option" aria-label="Правильный вариант"></select></div>
          <label class="mx1-poll-setting"><span class="mx1-setting-icon rose">◴</span><span class="mx1-setting-copy"><b>Ограничение срока</b><small>Опрос завершится в заданное время</small></span><input type="checkbox" data-setting="deadline"><i></i></label>
          <div class="mx1-poll-extra" data-extra="deadline" hidden><input class="mx1-poll-deadline" type="datetime-local" aria-label="Дата и время завершения опроса"></div>
        </div>
      </div>
    </section>`;
    document.body.appendChild(modal);
    const rows = modal.querySelector('.mx1-poll-options');
    let nextKey = 0;
    const addRow = (value = '') => {
      if (rows.children.length >= 12) return;
      const row = document.createElement('div'); row.className = 'mx1-poll-option-row'; row.dataset.key = String(nextKey++);
      row.innerHTML = '<span class="mx1-option-grip" aria-hidden="true">☰</span><input maxlength="100" placeholder="Ответ" value=""><button type="button" data-move="up" aria-label="Переместить вверх">↑</button><button type="button" data-move="down" aria-label="Переместить вниз">↓</button><button type="button" data-remove aria-label="Удалить вариант">×</button>';
      row.querySelector('input').value = value;
      rows.appendChild(row); updateOptions();
    };
    const updateOptions = () => {
      const count = rows.children.length;
      modal.querySelector('.mx1-option-counter').textContent = count < 12 ? `Можно добавить ещё ${12 - count} вариантов ответа.` : 'Достигнут лимит: 12 вариантов.';
      modal.querySelector('.mx1-add-option').disabled = count >= 12;
      const select = modal.querySelector('.mx1-correct-option'), previous = select.value;
      const optionRows = [...rows.children].filter((row) => row.querySelector('input').value.trim());
      select.innerHTML = optionRows.map((row, index) => `<option value="${esc(row.dataset.key)}">${esc(row.querySelector('input').value.trim() || `Вариант ${index + 1}`)}</option>`).join('');
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    };
    addRow(); addRow();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.querySelector('.mx1-poll-close').onclick = () => modal.remove();
    modal.querySelector('.mx1-add-option').onclick = () => addRow();
    rows.addEventListener('input', updateOptions);
    rows.addEventListener('click', (e) => {
      const row = e.target.closest('.mx1-poll-option-row'); if (!row) return;
      if (e.target.closest('[data-remove]')) { if (rows.children.length <= 2) { if (window.showToast) showToast('Нужно оставить минимум два ответа'); return; } row.remove(); updateOptions(); return; }
      const move = e.target.closest('[data-move]')?.dataset.move;
      if (move === 'up' && row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
      if (move === 'down' && row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row);
      updateOptions();
    });
    modal.querySelectorAll('[data-setting]').forEach((toggle) => toggle.addEventListener('change', () => {
      const key = toggle.dataset.setting;
      if (key === 'quiz') modal.querySelector('[data-extra="quiz"]').hidden = !toggle.checked;
      if (key === 'deadline') modal.querySelector('[data-extra="deadline"]').hidden = !toggle.checked;
      const multiple = modal.querySelector('[data-setting="multiple"]');
      const quiz = modal.querySelector('[data-setting="quiz"]');
      if (key === 'quiz' && toggle.checked) { multiple.checked = false; multiple.disabled = true; }
      if (key === 'quiz' && !toggle.checked) multiple.disabled = false;
      if (key === 'multiple' && toggle.checked && quiz.checked) { quiz.checked = false; quiz.disabled = false; modal.querySelector('[data-extra="quiz"]').hidden = true; }
    }));
    modal.querySelectorAll('.mx1-send').forEach((button) => button.onclick = async function () {
      const question = modal.querySelector('.mx1-poll-question').value.trim();
      const optionRows = [...rows.children].map((row) => ({ key: row.dataset.key, text: row.querySelector('input').value.trim() })).filter((row) => row.text);
      const options = optionRows.map((row) => row.text);
      const values = Object.fromEntries([...modal.querySelectorAll('[data-setting]')].map((input) => [input.dataset.setting, input.checked]));
      if (!question || options.length < 2) { if (window.showToast) showToast('Добавьте вопрос и минимум два варианта'); return; }
      if (new Set(options.map((text) => text.toLocaleLowerCase())).size !== options.length) { if (window.showToast) showToast('Варианты ответа должны отличаться'); return; }
      let closesAt = null;
      if (values.deadline) {
        const deadlineValue = modal.querySelector('.mx1-poll-deadline').value;
        const deadline = deadlineValue ? new Date(deadlineValue) : null;
        if (!deadline || deadline.getTime() < Date.now() + 60_000) { if (window.showToast) showToast('Выберите время завершения позже чем через минуту'); return; }
        closesAt = deadline.toISOString();
      }
      const selectedCorrectKey = modal.querySelector('.mx1-correct-option').value;
      const correctOptionPosition = values.quiz ? optionRows.findIndex((row) => row.key === selectedCorrectKey) : null;
      if (values.quiz && correctOptionPosition < 0) { if (window.showToast) showToast('Заполните варианты ответа'); return; }
      modal.querySelectorAll('.mx1-send').forEach((item) => { item.disabled = true; });
      try {
        const msg = await MchatAPI.createPoll(currentChatId, {
          question,
          description: modal.querySelector('.mx1-poll-description').value.trim(),
          options,
          multiple: values.multiple,
          anonymous: !values.showVoters,
          allowAdding: values.allowAdding,
          allowRevote: values.allowRevote,
          shuffleOptions: values.shuffleOptions,
          quiz: values.quiz,
          correctOptionPosition,
          closesAt,
        });
        if (typeof window.onIncomingMessage === 'function') window.onIncomingMessage(msg);
        modal.remove();
      } catch (err) { modal.querySelectorAll('.mx1-send').forEach((item) => { item.disabled = false; }); if (window.showToast) showToast(MchatAPI.errorText(err)); }
    });
  }

  window.mx1AddPollOption = function (messageId) {
    const modal = document.createElement('div'); modal.className = 'mx1-modal';
    modal.innerHTML = '<section class="mx1-poll-add-option"><b>Добавить ответ</b><input maxlength="100" placeholder="Новый вариант"><footer><button type="button" data-cancel>Отмена</button><button type="button" data-save>Добавить</button></footer></section>';
    document.body.appendChild(modal); modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.querySelector('[data-cancel]').onclick = () => modal.remove();
    modal.querySelector('[data-save]').onclick = async function () {
      const text = modal.querySelector('input').value.trim();
      if (!text) { modal.querySelector('input').focus(); return; }
      this.disabled = true;
      try {
        const message = await MchatAPI.addPollOption(messageId, text);
        const list = messages[message.chatId] || [], index = list.findIndex((item) => item.id === message.id);
        if (index >= 0) {
          list[index] = msgFromServer(message);
          if (currentChatId === message.chatId) renderMessages(message.chatId);
        }
        modal.remove();
      } catch (err) { this.disabled = false; if (window.showToast) showToast(MchatAPI.errorText(err)); }
    };
    modal.querySelector('input').focus();
  };

  // Enable tap-to-photo and press-to-record when the camera is opened from Gallery.
  document.addEventListener('click', (e) => { if (e.target.closest('#mx-camera')) closeAttachPanel(); }, true);
  const sendCamOriginal = window.mxCameraSend;
  window.mxCameraSend = async function () {
    const cam = typeof mxCam !== 'undefined' ? mxCam : null;
    if (!cam || !cam.attachAsVideo) return sendCamOriginal.apply(this, arguments);
    const chatId = currentChatId;
    if (cam.photoBlob) {
      const file = new File([cam.photoBlob], 'photo.jpg', { type: cam.photoBlob.type || 'image/jpeg' });
      window.mxCameraClose();
      const edited = await window.mxPreviewOpen(file);
      if (edited) await window.mxSendAttachment(chatId, edited.file, { caption: edited.caption, hd: edited.hd });
      return;
    }
    if (cam.blob) {
      const file = new File([cam.blob], 'video.webm', { type: cam.blob.type || 'video/webm' });
      window.mxCameraClose();
      const edited = await window.mxVideoPreviewOpen(file);
      if (edited) await window.mxSendAttachment(chatId, edited.file, { caption: edited.caption, hd: edited.hd });
    }
  };
  let shutterTimer = null, shutterRecording = false, shutterHeld = false;
  document.addEventListener('pointerdown', (e) => {
    const shutter = e.target.closest('#mx-shutter'); if (!shutter) return;
    shutterHeld = false; shutterRecording = false; clearTimeout(shutterTimer);
    shutterTimer = setTimeout(() => {
      shutterHeld = true;
      if (typeof mxCam === 'undefined' || !mxCam || mxCam.recording) return;
      shutterRecording = true;
      mxCam.mode = 'circle'; document.getElementById('mx-camera').classList.remove('photo');
      setTimeout(() => { if (shutterRecording && typeof mxCam !== 'undefined' && mxCam && !mxCam.recording) window.mxCameraStartRecording(); }, 120);
    }, 350);
  }, true);
  document.addEventListener('pointerup', (e) => {
    if (!e.target.closest('#mx-shutter')) return;
    clearTimeout(shutterTimer);
    if (shutterRecording) {
      const stop = () => { if (typeof mxCam !== 'undefined' && mxCam && mxCam.recording) window.mxCameraStopRecording(); };
      setTimeout(stop, 500);
      e.preventDefault();
    }
  }, true);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#mx-shutter') || !shutterHeld) return;
    e.preventDefault(); e.stopImmediatePropagation(); shutterHeld = false; shutterRecording = false;
  }, true);
})();
