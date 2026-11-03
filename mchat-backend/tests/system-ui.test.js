/* UI-тесты в jsdom: единый плеер (голосовые + кружки + остров), карточка входа, архив чатов.
 * jsdom не воспроизводит звук/видео, поэтому play()/pause() у медиа-элементов подменены простыми заглушками:
 * проверяется ЛОГИКА контроллера и разметка, а не реальное воспроизведение на устройстве. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
// let/const из window.eval не «просачиваются» между вызовами; script-level (как в браузере) даёт vm.runInContext
const run = (dom, code) => vm.runInContext(code, dom.getInternalVMContext());

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const frame = (w) => new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));

function bootPlayer() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="messages-container">
      <div class="msg" data-id="m1"><div class="mx-voice" data-audio-url="/api/media/a1" data-mid="m1"><button class="mx-vplay"></button><div class="mx-prog"><div class="mx-prog-fill"></div></div></div></div>
      <div class="msg" data-id="m2"><div class="mx-voice" data-audio-url="/api/media/a2" data-mid="m2"><button class="mx-vplay"></button><div class="mx-prog"><div class="mx-prog-fill"></div></div></div></div>
      <div class="mx-vn-wrap mx-vn-pending" id="vn-pending" data-mid="v0"><video src="blob:x"></video></div>
      <div class="mx-vn-wrap" id="vn-ready" data-mid="v1"><video src="/api/media/v1"></video></div>
    </div></body></html>`, { runScripts: 'outside-only', url: 'https://mchat-web.org/', pretendToBeVisual: true });
  const w = dom.window;
  // заглушки воспроизведения
  const P = w.HTMLMediaElement.prototype;
  Object.defineProperty(P, 'paused', { configurable: true, get() { return this._p !== false; } });
  P.play = function () { this._p = false; this.dispatchEvent(new w.Event('play')); return Promise.resolve(); };
  P.pause = function () { if (this._p === false) { this._p = true; this.dispatchEvent(new w.Event('pause')); } };
  P.load = function () {};
  w.eval(`var messages={}, chats=[], currentChatId='c1'; window.showToast=function(m){ (window.__toasts=window.__toasts||[]).push(m); };
    function goTo(id){ window.__screen=id; } function openChat(){ return Promise.resolve(); } function mxFixWebmDuration(){}`);
  w.eval(pub('mchat-player.js'));
  return w;
}
const btn = (w, id) => w.document.querySelector(`.mx-voice[data-mid="${id}"] .mx-vplay`);

test('голосовое: старт, остров появляется, единственный аудио-элемент', async () => {
  const w = bootPlayer();
  w.mxVoicePlayToggle(btn(w, 'm1'), 'm1');
  await frame(w);
  assert.equal(w.MxPlayer.current.id, 'm1');
  assert.ok(w._mxVoiceAudio.src.endsWith('/api/media/a1'));
  const isl = w.document.getElementById('mx-island');
  assert.ok(isl && !isl.hidden, 'остров показан');
  assert.equal(btn(w, 'm1').getAttribute('data-st'), 'p', 'у играющего кнопка «пауза»');
  const el1 = w._mxVoiceAudio;
  w.mxVoicePlayToggle(btn(w, 'm2'), 'm2'); await frame(w);
  assert.strictEqual(w._mxVoiceAudio, el1, 'элемент один и тот же — второго плеера нет');
  assert.equal(w.MxPlayer.current.id, 'm2');
  assert.ok(el1.src.endsWith('/api/media/a2'));
  assert.equal(btn(w, 'm1').getAttribute('data-st'), 'l', 'первое сообщение снова «играть»');
});

test('голосовое: пауза/продолжить тем же нажатием; остров переживает смену чата', async () => {
  const w = bootPlayer();
  w.mxVoicePlayToggle(btn(w, 'm1'), 'm1'); await frame(w);
  w.mxVoicePlayToggle(btn(w, 'm1'), 'm1'); await frame(w);
  assert.equal(w._mxVoiceAudio.paused, true);
  assert.equal(w.document.getElementById('mx-island').hidden, false, 'на паузе остров остаётся');
  w.goTo('s-chats'); w.eval("currentChatId='c2'"); await frame(w);
  assert.equal(w.document.getElementById('mx-island').hidden, false, 'после перехода в другой чат остров на месте');
  assert.equal(w.MxPlayer.current.id, 'm1');
});

test('скорость 0.5/1/1.5/2: применяется к аудио, чип у играющего, мусор игнорируется', async () => {
  const w = bootPlayer();
  w.mxVoicePlayToggle(btn(w, 'm1'), 'm1'); await frame(w);
  for (const r of [0.5, 1.5, 2, 1]) { w.MxPlayer.setRate(r); assert.equal(w._mxVoiceAudio.playbackRate, r); }
  w.MxPlayer.setRate(3); assert.equal(w.MxPlayer.rate, 1, 'недопустимая скорость игнорируется');
  w.MxPlayer.setRate(1.5); await frame(w);
  assert.equal(w.document.querySelector('.mx-voice[data-mid="m1"] .mx-vrate').textContent, '1.5x');
  assert.equal(w.document.querySelector('.mx-voice[data-mid="m2"] .mx-vrate'), null, 'чип только у играющего');
  assert.equal(w.document.querySelector('#mx-island .mx-isl-rate').textContent, '1.5x');
  // выбор скорости в острове
  w.document.querySelector('#mx-island [data-act="rates"]').click(); await frame(w);
  w.document.querySelector('#mx-island [data-rate="2"]').click(); await frame(w);
  assert.equal(w._mxVoiceAudio.playbackRate, 2);
});

test('посторонний звук (трек) ставит голосовое на паузу; короткие системные звуки — нет', async () => {
  const w = bootPlayer();
  w.mxVoicePlayToggle(btn(w, 'm1'), 'm1'); await frame(w);
  const beep = new w.Audio(); beep.src = '/sounds/ding.mp3'; beep.play();
  assert.equal(w._mxVoiceAudio.paused, false, 'системный звук голосовое не прерывает');
  const track = new w.Audio(); track.src = '/api/media/track9'; track.play();
  assert.equal(w._mxVoiceAudio.paused, true, 'трек остановил голосовое');
});

test('кружок: пока не готов — не открывается; готовый — увеличенный просмотр со скоростями, пауза закрывает', async () => {
  const w = bootPlayer();
  w.mxVideoNoteToggle(w.document.getElementById('vn-pending'));
  assert.equal(w.document.getElementById('mx-vn-zoom'), null, 'неготовый кружок не воспроизводится');
  w.mxVoicePlayToggle(btn(w, 'm1'), 'm1'); await frame(w);
  w.mxVideoNoteToggle(w.document.getElementById('vn-ready'));
  const z = w.document.getElementById('mx-vn-zoom');
  assert.ok(z, 'увеличенный просмотр открыт');
  assert.deepEqual([...z.querySelectorAll('.mx-vnz-rates [data-rate]')].map((b) => b.textContent), ['0.5x', '1x', '1.5x', '2x']);
  assert.equal(w._mxVoiceAudio.paused, true, 'голосовое поставлено на паузу — звук один');
  assert.equal(w.MxPlayer.current.kind, 'video');
  z.querySelector('[data-rate="2"]').click();
  assert.equal(z.querySelector('video').playbackRate, 2);
  z.querySelector('.mx-vnz-pause').click();
  assert.equal(w.document.getElementById('mx-vn-zoom'), null, 'пауза возвращает кружок к малому виду');
  assert.equal(w.MxPlayer.current, null);
});

test('CSS: кружок остаётся круглым при любой теме облаков', () => {
  const css = pub('mchat-player.css');
  assert.match(css, /\.mx-vn-wrap\s*\{[^}]*border-radius:\s*50%\s*!important/);
  for (const t of ['soft', 'sharp', 'glass', 'gradient', 'outline']) assert.ok(pub('mchat-series8.css').includes(`data-mx-bubble="${t}"`), `тема ${t} существует`);
  assert.match(css, /html\[data-mx-bubble\] \.msg\.mx-vn[\s\S]*?border: 0 !important/);
  assert.match(css, /backdrop-filter: none !important/);
});

// ───────── карточка безопасности ─────────
function bootSystem() {
  const dom = new JSDOM('<!doctype html><html><body><div id="messages-container"></div></body></html>', { runScripts: 'outside-only', url: 'https://mchat-web.org/', pretendToBeVisual: true });
  const w = dom.window;
  const calls = [];
  w.eval(`var messages={c1:[{id:'s1',card:{alertId:'al1',state:'PENDING'}}]}, chats=[], currentChatId='c1'; function renderMessages(){ window.__rendered=(window.__rendered||0)+1; } window.showToast=function(m){(window.__toasts=window.__toasts||[]).push(m)};`);
  w.MchatAPI = {
    securityConfirm: async (id) => { calls.push(['confirm', id]); return { state: 'CONFIRMED' }; },
    securityDeny: async (id) => { calls.push(['deny', id]); return { state: 'DENIED' }; },
    errorText: (e) => 'ERR:' + (e.code || e.message),
  };
  w.eval(pub('mchat-system.js'));
  return { w, calls };
}
const card = (o) => Object.assign({ type: 'login_alert', alertId: 'al1', state: 'PENDING', deviceType: 'phone', os: 'Android 14', client: 'Chrome', location: null, at: '2026-11-03T10:00:00Z', expiresAt: new Date(Date.now() + 600000).toISOString(), resolvedVia: null }, o);

test('карточка входа: данные устройства, две кнопки, местоположение «недоступно», если не определено', () => {
  const { w } = bootSystem();
  const html = w.mxSystemCardHtml({ card: card() });
  for (const t of ['Телефон · Android 14', 'Chrome', 'Местоположение недоступно', 'Время входа', 'Это я', 'Это не я']) assert.ok(html.includes(t), t);
  assert.ok(html.includes("mxSecurityAnswer('al1','confirm'") && html.includes("mxSecurityAnswer('al1','deny'"), 'кнопки привязаны к конкретному запросу');
  assert.ok(w.mxSystemCardHtml({ card: card({ location: 'Бишкек, Кыргызстан' }) }).includes('Бишкек, Кыргызстан'));
});
test('карточка входа: после решения/просрочки кнопок нет, тексты честные', () => {
  const { w } = bootSystem();
  const ok = w.mxSystemCardHtml({ card: card({ state: 'CONFIRMED', resolvedVia: 'EMAIL' }) });
  assert.ok(ok.includes('Вход подтверждён кодом из письма') && !ok.includes('Это я'));
  const no = w.mxSystemCardHtml({ card: card({ state: 'DENIED' }) });
  assert.ok(no.includes('отозван на сервере') && !no.includes('mx-sec-btns'));
  const exp = w.mxSystemCardHtml({ card: card({ expiresAt: new Date(Date.now() - 1000).toISOString() }) });
  assert.ok(exp.includes('Время подтверждения истекло') && !exp.includes('mx-sec-btns'));
});
test('карточка входа: чужой текст экранируется (нет XSS через User-Agent)', () => {
  const { w } = bootSystem();
  const html = w.mxSystemCardHtml({ card: card({ client: '<img src=x onerror=alert(1)>', os: '"><script>1</script>' }) });
  assert.ok(!html.includes('<img src=x') && !html.includes('<script>'));
});
test('кнопки: «Это не я» вызывает именно deny с id запроса и обновляет карточку', async () => {
  const { w, calls } = bootSystem();
  w.document.body.insertAdjacentHTML('beforeend', '<div class="mx-sec-btns"><button id="b1"></button><button id="b2"></button></div>');
  await w.mxSecurityAnswer('al1', 'deny', w.document.getElementById('b2'));
  assert.deepEqual(calls, [['deny', 'al1']]);
  assert.equal(w.eval("messages.c1[0].card.state"), 'DENIED');
  assert.ok(w.__rendered >= 1);
});

// ───────── архив чатов (реальный код из mchat-ext.js, вырезанный по маркерам) ─────────
function bootArchive(chats, hidden) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="chats-list"></div><input id="chat-search"></body></html>', { runScripts: 'outside-only', url: 'https://mchat-web.org/', pretendToBeVisual: true });
  const w = dom.window; w.__dom = dom;
  const src = pub('mchat-ext.js');
  const a = src.indexOf('/* ── АРХИВ ──');
  const b = src.indexOf('// Закрепить/открепить: ПКМ');
  assert.ok(a > 0 && b > a, 'блок архива найден');
  const block = src.slice(a, b);
  // как в реальном приложении: chats и currentUser — let (не свойства window)
  run(dom, `let chats=${JSON.stringify(chats)}, currentUser={settings:{archiveHidden:${!!hidden}}};
    var $=function(id){return document.getElementById(id)}, esc=function(s){return String(s==null?'':s)}, PIN_SVG='', toast=function(m){(window.__t=window.__t||[]).push(m)},
    chatAvatarHtml=function(){return ''}, updateNavBadge=function(){}, mxCloseFloating=function(){}, mxCtxItem=function(){return ''}, mxPositionNear=function(){};
    var MchatAPI={ updateMe: async function(p){ window.__me=p; return {} }, archiveChat: async function(id,a){ return {archived:a} }, errorText:function(e){return String(e)} };
    function renderChats(q){ window._renderChatsInner(q||'') }
    (function(){ ${block} })();`);
  return w;
}
const mk = (id, name, extra) => Object.assign({ id, name, type: 'DIRECT', unread: 0, lastMessage: '', time: '' }, extra);
const ids = (w) => [...w.document.querySelectorAll('#chats-list .chat-item')].map((e) => e.getAttribute('data-chat-id'));

test('архив: архивные чаты не в основном списке, строка «Архив» самая верхняя', () => {
  const w = bootArchive([mk('a', 'Аня'), mk('b', 'Борис', { archived: true }), mk('c', 'Вера', { archived: true, unread: 3 })], false);
  w.renderChats();
  assert.deepEqual(ids(w), ['__archive', 'a']);
  assert.ok(w.document.querySelector('.mx-archive-count').textContent === '3', 'непрочитанные архивных — в счётчике архива');
  w.mxOpenArchive();
  assert.deepEqual(ids(w), ['__archive-back', 'b', 'c'], 'внутри архива — архивные чаты и «назад»');
  w.mxCloseArchive();
  assert.deepEqual(ids(w), ['__archive', 'a']);
});
test('архив скрыт: строки нет, пока не потянуть вниз; содержимое не потеряно', () => {
  const w = bootArchive([mk('a', 'Аня'), mk('b', 'Борис', { archived: true })], true);
  w.renderChats();
  assert.deepEqual(ids(w), ['a'], 'скрытый архив не виден');
  const list = w.document.getElementById('chats-list');
  const ev = (t, y) => { const e = new w.Event(t, { bubbles: true }); e.touches = [{ clientY: y }]; list.dispatchEvent(e); };
  ev('touchstart', 10); ev('touchmove', 120);   // протянули вниз от самого верха (scrollTop = 0)
  assert.deepEqual(ids(w), ['__archive', 'a'], 'после жеста архив появился');
  assert.equal(run(w.__dom, 'chats.filter(function(c){return c.archived}).length'), 1, 'архивный чат сохранён');
});
test('архив скрыт, но список не у верха — жест не срабатывает', () => {
  const w = bootArchive([mk('a', 'Аня'), mk('b', 'Борис', { archived: true })], true);
  w.renderChats();
  const list = w.document.getElementById('chats-list');
  Object.defineProperty(list, 'scrollTop', { value: 200, configurable: true });
  const ev = (t, y) => { const e = new w.Event(t, { bubbles: true }); e.touches = [{ clientY: y }]; list.dispatchEvent(e); };
  ev('touchstart', 10); ev('touchmove', 150);
  assert.deepEqual(ids(w), ['a']);
});
test('«Скрыть архив» сохраняется на сервере и прячет строку, чаты остаются', async () => {
  const w = bootArchive([mk('a', 'Аня'), mk('b', 'Борис', { archived: true })], false);
  w.renderChats();
  await w.mxSetArchiveHidden(true);
  assert.deepEqual(w.__me, { archiveHidden: true });
  assert.deepEqual(ids(w), ['a']);
  assert.equal(run(w.__dom, 'chats.length'), 2);
  await w.mxSetArchiveHidden(false);
  assert.deepEqual(ids(w), ['__archive', 'a']);
});
test('«Добавить в архив» / «Вернуть» и поиск находит архивные чаты', async () => {
  const w = bootArchive([mk('a', 'Аня'), mk('b', 'Борис')], false);
  w.renderChats();
  await w.mxToggleArchiveChat('b');
  assert.deepEqual(ids(w), ['__archive', 'a']);
  w.document.getElementById('chat-search').value = 'бор';
  w.renderChats('бор');
  assert.deepEqual(ids(w), ['b'], 'поиск ищет и среди архивных');
  await w.mxToggleArchiveChat('b');
  w.document.getElementById('chat-search').value = '';
  w.renderChats('');
  assert.deepEqual(ids(w), ['a', 'b']);
});

test('официальный аккаунт: логотип и значок в списке чатов, значок ставится по данным сервера (peer.official)', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="chats-list"></div><div id="chat-name"></div><div id="chat-open-av"></div><div id="chat-status"></div></body></html>', { runScripts: 'outside-only', url: 'https://mchat-web.org/', pretendToBeVisual: true });
  const w = dom.window;
  run(dom, `let chats=[{id:'c1',name:'Аня',peer:{}},{id:'c2',name:'Mchat',peer:{official:'SECURITY'}},{id:'c3',name:'Mchat',peer:{official:'NEWS'}},{id:'c4',name:'Mchat',peer:{}}];
    function chatAvatarHtml(){ return '<i class="plain"></i>' }
    function renderChats(){ document.getElementById('chats-list').innerHTML = chats.map(function(c){ return '<div class="chat-item" data-chat-id="'+c.id+'"><div class="chat-avatar">'+chatAvatarHtml(c)+'</div><div class="chat-name">'+c.name+'</div></div>' }).join('') }`);
  run(dom, pub('mchat-system.js'));
  w.renderChats();
  const row = (id) => w.document.querySelector(`[data-chat-id="${id}"]`);
  assert.ok(row('c2').querySelector('.mx-official-badge') && row('c2').querySelector('.mx-off-logo'));
  assert.ok(row('c3').querySelector('.mx-official-badge'));
  assert.equal(row('c2').querySelector('.mx-official-sub').textContent, 'Безопасность');
  assert.equal(row('c3').querySelector('.mx-official-sub').textContent, 'Новости');
  assert.equal(row('c4').querySelector('.mx-official-badge'), null, 'обычный пользователь с именем «Mchat» значка не получает — его выдаёт только сервер');
  assert.equal(row('c1').querySelector('.mx-official-badge'), null);
});
