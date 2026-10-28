/* Mchat · ядро черновиков сообщений (без DOM — чтобы тестироваться в Node).
   Формат хранилища: { [chatId]: { t: текст, ts: мс } }. Пустой текст = «надгробие» (удаление), чтобы старый серверный черновик
   не воскрес при синхронизации. Хранилище — отдельный ключ НА КАЖДОГО пользователя (изоляция данных на одном устройстве). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MxDrafts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(opts) {
    var storage = opts.storage, key = opts.key, now = opts.now || Date.now;
    var data = {};
    function load() { try { var raw = storage.getItem(key); data = raw ? JSON.parse(raw) : {}; if (!data || typeof data !== 'object') data = {}; } catch (e) { data = {}; } }
    function save() { try { storage.setItem(key, JSON.stringify(data)); } catch (e) { /* переполнение/приватный режим: работаем в памяти */ } }
    load();
    return {
      get: function (chatId) { var d = data[chatId]; return d && d.t ? d.t : ''; },
      has: function (chatId) { return !!(data[chatId] && data[chatId].t && data[chatId].t.trim()); },
      set: function (chatId, text) {
        text = String(text == null ? '' : text);
        if (text.trim() === '') { if (data[chatId]) data[chatId] = { t: '', ts: now() }; else return; }   // надгробие только если что-то было
        else data[chatId] = { t: text, ts: now() };
        save();
      },
      clear: function (chatId) { if (data[chatId]) { data[chatId] = { t: '', ts: now() }; save(); } },
      ids: function () { return Object.keys(data).filter(function (id) { return data[id].t && data[id].t.trim(); }); },
      /** Слияние с серверным списком [{chatId,text,at}] — побеждает более свежее. Возвращает chatId, которые надо отправить на сервер. */
      merge: function (serverList) {
        var seen = {}, push = [];
        (serverList || []).forEach(function (d) {
          seen[d.chatId] = true;
          var ts = Date.parse(d.at) || 0, l = data[d.chatId];
          if (!l || ts > l.ts) data[d.chatId] = { t: d.text, ts: ts };
          else if (l.ts > ts && l.t !== d.text) push.push(d.chatId);
        });
        Object.keys(data).forEach(function (id) { if (!seen[id] && data[id].t) push.push(id); });   // есть только у нас — отправим
        save();
        return push;
      },
      /** Убрать надгробия, которые сервер уже подтвердил. */
      prune: function () { Object.keys(data).forEach(function (id) { if (!data[id].t) delete data[id]; }); save(); },
    };
  }
  return { create: create };
});
