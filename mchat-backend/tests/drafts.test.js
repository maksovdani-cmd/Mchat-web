const test = require('node:test');
const assert = require('node:assert');
const { create } = require('../public/mchat-drafts.js');

const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; };

test('сохраняет и возвращает черновик, переживает «перезагрузку»', () => {
  const st = mem();
  const a = create({ storage: st, key: 'u1' });
  a.set('chat1', 'привет');
  const b = create({ storage: st, key: 'u1' });          // новая загрузка страницы
  assert.strictEqual(b.get('chat1'), 'привет');
  assert.ok(b.has('chat1'));
});
test('изоляция пользователей: у другого ключа черновика нет', () => {
  const st = mem();
  create({ storage: st, key: 'u1' }).set('c', 'секрет');
  assert.strictEqual(create({ storage: st, key: 'u2' }).get('c'), '');
});
test('пустой/пробельный текст очищает черновик', () => {
  const d = create({ storage: mem(), key: 'k' });
  d.set('c', 'abc'); d.set('c', '   ');
  assert.ok(!d.has('c')); assert.strictEqual(d.get('c'), '');
});
test('после отправки (clear) черновика нет, и серверный старый не воскресает', () => {
  const d = create({ storage: mem(), key: 'k', now: (() => { let t = 1000; return () => (t += 10); })() });
  d.set('c', 'текст');
  d.clear('c');
  d.merge([{ chatId: 'c', text: 'текст', at: new Date(1005).toISOString() }]);   // сервер старше надгробия
  assert.ok(!d.has('c'));
});
test('слияние: более свежий серверный побеждает, локальный новее — уходит на сервер', () => {
  const d = create({ storage: mem(), key: 'k', now: () => 5000 });
  d.set('a', 'локальный');
  const push = d.merge([{ chatId: 'a', text: 'старый серверный', at: new Date(1000).toISOString() }, { chatId: 'b', text: 'с сервера', at: new Date(9000).toISOString() }]);
  assert.deepStrictEqual(push, ['a']);
  assert.strictEqual(d.get('a'), 'локальный');
  assert.strictEqual(d.get('b'), 'с сервера');
});
test('повреждённое хранилище не ломает работу', () => {
  const st = mem(); st.setItem('k', '{не json');
  const d = create({ storage: st, key: 'k' });
  d.set('c', 'x'); assert.strictEqual(d.get('c'), 'x');
});
