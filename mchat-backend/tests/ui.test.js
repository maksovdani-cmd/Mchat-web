/* Дымовой UI-тест слоя series8 в jsdom: шапка-острова, пузыри, черновики, разбиение, ОТМЕНА записи. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function boot() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="s-chats" class="screen active"><div id="chats-list"></div></div>
    <div id="s-chat-open" class="screen"><div class="coh">
      <button class="ib" onclick="goTo('s-chats')" id="back"></button>
      <div id="chat-open-av"></div>
      <div style="flex:1"><div id="chat-name">Аня</div><div id="chat-status"></div></div>
      <button class="ib" id="mx-call-btn"></button><button class="ib" id="mx-vcall-btn"></button><button class="ib" id="mx-chat-menu-btn"></button>
    </div><textarea id="message-input"></textarea></div>
    <div id="mx-rec"><button class="ib ghost"></button><div id="mx7-cancel"></div><div id="mx-rec-prev"></div></div>
  </body></html>`, { runScripts: 'outside-only', url: 'https://mchat-web.org/', pretendToBeVisual: true });
  const w = dom.window;
  w.eval(`var currentUser={id:'u1',username:'anya'}; var currentChatId=null; var mxRec=null; var sent=[]; var cancelled=0; var mxIncoming=null; var mxCall=null;
    function mxOnComposeInput(){}
    function renderChats(){ document.getElementById('chats-list').innerHTML='<div class="chat-item" onclick="openChat(\\'c1\\')"><div class="chat-info"><div class="chat-name">Аня</div><div class="chat-last">привет</div></div></div>'; }
    function openChat(id){ currentChatId=id; return Promise.resolve(); }
    async function sendMessage(){ var i=document.getElementById('message-input'); var t=i.value.trim(); if(!t) return; sent.push(t); i.value=''; mxOnComposeInput(); }
    function mxVoiceCancel(){ cancelled++; mxRec=null; }
    function mxVoiceSend(){ sent.push('VOICE'); }
    window.showToast=function(){};
  `);
  const saved = {};
  w.MchatAPI = { listDrafts: async () => ({ drafts: [] }), saveDraft: async (id, text) => { saved[id] = text; } };
  w.eval(pub('mchat-textsplit.js')); w.eval(pub('mchat-drafts.js')); w.eval(pub('mchat-series8.js'));
  return { w, saved };
}

test('шапка чата собирается в три острова, id кнопок сохранены', () => {
  const { w } = boot();
  w.__mx8tick();
  const d = w.document;
  assert.ok(d.querySelector('.mx8-isl-back #back'));
  assert.ok(d.querySelector('.mx8-isl-main #chat-name'));
  assert.ok(d.querySelector('.mx8-isl-act #mx-call-btn') && d.querySelector('.mx8-isl-act #mx-chat-menu-btn'));
});

test('оформление пузырей применяется и хранится на пользователя', () => {
  const { w } = boot();
  w.mxSetBubbleStyle('glass');
  assert.strictEqual(w.document.documentElement.getAttribute('data-mx-bubble'), 'glass');
  assert.strictEqual(w.localStorage.getItem('mx8_bubble_u1'), 'glass');
  w.mxSetBubbleStyle('classic');
  assert.strictEqual(w.document.documentElement.hasAttribute('data-mx-bubble'), false);
});

test('черновик: сохраняется при уходе из чата, восстанавливается, «Черновик» в списке, отправка очищает', async () => {
  const { w, saved } = boot();
  const inp = w.document.getElementById('message-input');
  w.eval("currentChatId='c1'");
  inp.value = 'недописанное'; w.mxOnComposeInput();
  w.eval("window.openChat('c2')");                       // переключились в другой чат
  assert.strictEqual(inp.value, '', 'в другом чате поле пустое');
  w.eval("window.openChat('c1')");
  assert.strictEqual(inp.value, 'недописанное', 'текст вернулся');
  w.eval("document.querySelector('#s-chat-open').classList.remove('active'); currentChatId='c2'; renderChats();");
  const tag = w.document.querySelector('.chat-last .mx8-draft');
  assert.ok(tag, 'метка в списке чатов'); assert.strictEqual(tag.textContent, 'Черновик:');
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(saved.c1, 'недописанное', 'ушло на сервер');
  w.eval("currentChatId='c1'; document.querySelector('#s-chat-open').classList.add('active');");
  await w.sendMessage();
  assert.strictEqual(w.eval("sent.join('|')"), 'недописанное');
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(saved.c1, '', 'после отправки черновик очищен и на сервере');
});

test('длинное сообщение уходит частями по порядку, без потерь', async () => {
  const { w } = boot();
  w.eval("currentChatId='c1'");
  const text = Array.from({ length: 1500 }, (_, i) => 'слово' + i).join(' ');   // > 4000 символов
  w.document.getElementById('message-input').value = text;
  await w.sendMessage();
  const sent = JSON.parse(w.eval('JSON.stringify(sent)'));
  assert.ok(sent.length >= 2);
  sent.forEach((p) => assert.ok(p.length <= 4000));
  assert.strictEqual(sent.join(' ').replace(/\s+/g, ' '), text);
});

test('«ОТМЕНА» — кнопка: прекращает запись без отправки', () => {
  const { w } = boot();
  w.__mx8tick();
  w.eval("mxRec={blob:null}");
  const c = w.document.getElementById('mx7-cancel');
  assert.strictEqual(c.textContent, 'ОТМЕНА');
  c.click();
  assert.strictEqual(w.eval('cancelled'), 1);
  assert.strictEqual(w.eval("sent.includes('VOICE')"), false);
});
