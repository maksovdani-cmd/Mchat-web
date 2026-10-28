/* Mchat · разбиение длинного текста на части ≤ limit символов (UTF-16 единиц, как считает сервер).
   Ничего не теряет: если склеить части, получится исходный текст (кроме пробелов на самом краю частей, которые сервер всё равно trim-ит).
   Не режет суррогатные пары и составные эмодзи (ZWJ, флаги, модификаторы): режет по границе «графемы», когда доступен Intl.Segmenter.
   Подключается и в браузере (window.MxTextSplit), и в Node-тестах (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MxTextSplit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMIT = 4000;

  function graphemeCut(text, limit) {
    // самый поздний разрез ≤ limit по границе графемы; смотрим чуть дальше окна, чтобы длинная графема (семья эмодзи) была видна целиком
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      var seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }), end = 0;
      for (var s of seg.segment(text.slice(0, limit + 64))) { var e = s.index + s.segment.length; if (e <= limit) end = e; else break; }
      if (end > 0) return end;
    }
    var cut = limit, c = text.charCodeAt(cut - 1);
    if (c >= 0xD800 && c <= 0xDBFF) cut--;                  // не оставляем «половинку» суррогатной пары
    return cut;
  }

  function split(text, limit) {
    limit = limit || LIMIT;
    text = String(text == null ? '' : text);
    var out = [];
    while (text.length > limit) {
      var win = text.slice(0, limit), cut = 0;
      var nl = win.lastIndexOf('\n'), sp = Math.max(win.lastIndexOf(' '), win.lastIndexOf('\t'));
      var best = Math.max(nl, sp);
      if (best >= limit * 0.5) cut = best + 1;              // режем после перевода строки/пробела — слова не рвём
      else {
        // нет подходящего пробела: режем по границе графемы в пределах окна
        cut = graphemeCut(text, limit);
        // граница графемы могла «съесть» окно целиком до пары символов — не уходим ниже половины
        if (cut < limit * 0.5) cut = limit - ((win.charCodeAt(limit - 1) >= 0xD800 && win.charCodeAt(limit - 1) <= 0xDBFF) ? 1 : 0);
      }
      out.push(text.slice(0, cut));
      text = text.slice(cut);
    }
    out.push(text);
    return out.filter(function (p) { return p.trim() !== ''; });
  }
  return { split: split, LIMIT: LIMIT };
});
