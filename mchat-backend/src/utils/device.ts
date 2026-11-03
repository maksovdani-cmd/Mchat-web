import type { Request } from 'express';

/** Короткое человекочитаемое описание устройства из User-Agent: «Chrome · Windows». */
export function deviceLabel(req: Request): string {
  const ua = req.get('user-agent') ?? '';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /YaBrowser\//.test(ua) ? 'Yandex' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /(Chrome|CriOS)\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'Браузер';
  const os =
    /Android/.test(ua) ? 'Android' :
    /(iPhone|iPad|iPod)/.test(ua) ? 'iOS' :
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export const clientIp = (req: Request) => req.ip ?? '';

export interface ClientInfo {
  /** phone | tablet | desktop | unknown */
  type: 'phone' | 'tablet' | 'desktop' | 'unknown';
  /** «Android 14», «Windows», «iOS 17.2» … (версия — только если она есть в User-Agent) */
  os: string;
  /** «Chrome», «Safari»… или «Приложение Mchat (Android)» */
  client: string;
}

/**
 * Подробное описание устройства для уведомления о входе: тип, ОС, браузер или приложение.
 * Источник — только User-Agent, поэтому это «примерно»: подменить его может кто угодно, и на подтверждение входа
 * он не влияет (решение принимает владелец аккаунта, а не эти строки).
 */
export function describeClient(req: Request): ClientInfo {
  const ua = req.get('user-agent') ?? '';
  const android = /Android/.exec(ua);
  const ios = /(iPhone|iPad|iPod)/.exec(ua);
  let os = '';
  if (android) os = 'Android' + (/Android ([\d.]+)/.exec(ua)?.[1] ? ' ' + /Android ([\d.]+)/.exec(ua)![1].split('.')[0] : '');
  else if (ios) os = 'iOS' + (/OS (\d+)[_\d]*/.exec(ua)?.[1] ? ' ' + /OS (\d+)[_\d]*/.exec(ua)![1] : '');
  else if (/Windows NT 10/.test(ua)) os = 'Windows';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let type: ClientInfo['type'] = 'unknown';
  if (/iPad/.test(ua) || (android && !/Mobile/.test(ua))) type = 'tablet';
  else if (/iPhone|iPod/.test(ua) || (android && /Mobile/.test(ua))) type = 'phone';
  else if (os) type = 'desktop';

  // WebView Android-приложения (Capacitor/обёртка) помечается «; wv)»: это не браузер, а приложение
  const webview = !!android && /; wv\)/.test(ua);
  const base = deviceLabel(req).split(' · ')[0];
  const client = webview ? 'Приложение Mchat (Android)' : base;
  return { type, os, client };
}
