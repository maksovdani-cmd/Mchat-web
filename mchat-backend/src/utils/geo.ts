import type { Request } from 'express';

/**
 * Примерное местоположение входа для карточки безопасности.
 *
 * Принципы (по требованиям безопасности):
 *  • ничего не выдумываем: если достоверно определить нельзя — возвращаем null, а в карточке пишем «недоступно»;
 *  • только страна и (если есть) город — без координат и без IP;
 *  • приватные/локальные адреса не определяем;
 *  • внешним сервисам IP не отправляем. Источники: заголовки прокси/CDN (Cloudflare: CF-IPCountry, CF-IPCity)
 *    и необязательный офлайн-модуль geoip-lite, если он установлен (npm i geoip-lite).
 * Из-за VPN и мобильных операторов это всегда ПРИБЛИЗИТЕЛЬНО — так и подписываем.
 */
const PRIVATE = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;

let geoip: { lookup(ip: string): { country?: string; city?: string } | null } | null | undefined;
function loadGeoip() {
  if (geoip !== undefined) return geoip;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    geoip = require('geoip-lite');
  } catch { geoip = null; }
  return geoip;
}

const regionName = (code: string) => {
  try { return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase(); } catch { return code.toUpperCase(); }
};

export function approxLocation(req: Request): string | null {
  const ip = req.ip ?? '';
  if (!ip || PRIVATE.test(ip.replace(/^::ffff:/, ''))) return null;
  // 1) заголовки CDN/прокси (их ставит инфраструктура, но подделать их может и клиент, если прокси не затирает —
  //    поэтому это лишь подсказка для человека, а не основание для решений)
  const cc = (req.get('cf-ipcountry') ?? '').trim();
  const city = (req.get('cf-ipcity') ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(cc) && cc.toUpperCase() !== 'XX' && cc.toUpperCase() !== 'T1') {
    return city && city.length <= 60 ? `${city}, ${regionName(cc)}` : regionName(cc);
  }
  // 2) офлайн-база
  const g = loadGeoip();
  if (g) {
    const r = g.lookup(ip.replace(/^::ffff:/, ''));
    if (r?.country) return r.city ? `${r.city}, ${regionName(r.country)}` : regionName(r.country);
  }
  return null;
}
