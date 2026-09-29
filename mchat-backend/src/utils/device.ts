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
