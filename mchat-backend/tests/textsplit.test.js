const test = require('node:test');
const assert = require('node:assert');
const { split, LIMIT } = require('../public/mchat-textsplit.js');

const strip = (s) => s.replace(/\s+/g, '');

test('короткий текст не режется', () => {
  assert.deepStrictEqual(split('привет'), ['привет']);
});
test('ровно лимит — одна часть, лимит+1 — две', () => {
  assert.strictEqual(split('a'.repeat(LIMIT)).length, 1);
  assert.strictEqual(split('a'.repeat(LIMIT + 1)).length, 2);
});
test('порядок сохранён и ничего не потеряно (слова, переносы строк)', () => {
  const text = Array.from({ length: 3000 }, (_, i) => 'слово' + i + (i % 7 === 0 ? '\n' : ' ')).join('');
  const parts = split(text);
  assert.ok(parts.length > 1);
  parts.forEach((p) => assert.ok(p.length <= LIMIT));
  assert.strictEqual(strip(parts.join('')), strip(text));
});
test('сплошной текст без пробелов режется жёстко, длина ≤ лимита', () => {
  const text = 'x'.repeat(LIMIT * 2 + 17);
  const parts = split(text);
  assert.strictEqual(parts.join(''), text);
  parts.forEach((p) => assert.ok(p.length <= LIMIT));
});
test('эмодзи (суррогатные пары) не разрываются', () => {
  const text = '😀'.repeat(LIMIT); // 2 UTF-16 единицы на символ → 8000 единиц
  const parts = split(text);
  assert.strictEqual(parts.join(''), text);
  parts.forEach((p) => { assert.ok(p.length <= LIMIT); assert.ok(!/^[\udc00-\udfff]/.test(p) && !/[\ud800-\udbff]$/.test(p)); });
});
test('составные эмодзи (ZWJ) не разрываются, если доступен Intl.Segmenter', { skip: typeof Intl.Segmenter === 'undefined' }, () => {
  const fam = '👨‍👩‍👧‍👦'; // 11 единиц
  const text = fam.repeat(1000);
  const parts = split(text);
  assert.strictEqual(parts.join(''), text);
  parts.forEach((p) => assert.ok(p.length % fam.length === 0));
});
test('пустые и пробельные части отбрасываются', () => {
  assert.deepStrictEqual(split('   \n  '), []);
});
