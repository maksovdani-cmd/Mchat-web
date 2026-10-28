import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '../config';
import { HttpError } from '../utils/errors';
import { sniffMatchesMime } from '../utils/sniff';

/**
 * Хранилище файлов. Два режима:
 *  • S3 (если заданы S3_BUCKET и ключи) — файлы живут вне сервера и не пропадают при перезапуске;
 *  • диск (по умолчанию) — просто и бесплатно, но на бесплатном Render диск стирается при каждом перезапуске.
 */
const useCloudinary = !!(config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET);
const useS3 = !useCloudinary && !!(config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
/** cloudinary → S3-совместимое (Supabase/R2/B2) → диск сервера. Cloudinary главнее, если его ключи заданы. */
export const storageMode: 'cloudinary' | 's3' | 'disk' = useCloudinary ? 'cloudinary' : useS3 ? 's3' : 'disk';
const remote = useCloudinary || useS3;

/* ───────── Cloudinary (REST, без SDK: ключи остаются на сервере, файлы идут потоком в облако, диск Render не нужен) ─────────
   Все файлы грузим как resource_type=raw: ровно те же байты, без перекодирования; public_id = имя файла (uuid.расширение). */
const CLD = 'https://api.cloudinary.com/v1_1';
const cldUrl = (file: string) => `https://res.cloudinary.com/${config.CLOUDINARY_CLOUD_NAME}/raw/upload/${encodeURIComponent(path.basename(file))}`;
const cldSign = (params: Record<string, string>) =>
  crypto.createHash('sha1').update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + config.CLOUDINARY_API_SECRET).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cldUpload(file: string, mime: string, body: Buffer) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const params = { public_id: file, timestamp: String(Math.floor(Date.now() / 1000)), overwrite: 'false' };
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) form.append(k, v);
      form.append('api_key', config.CLOUDINARY_API_KEY!);
      form.append('signature', cldSign(params));
      form.append('file', new Blob([new Uint8Array(body)], { type: mime }), file);
      const res = await fetch(`${CLD}/${config.CLOUDINARY_CLOUD_NAME}/raw/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
      if (res.ok) return;
      const text = await res.text().catch(() => '');
      if (res.status === 400 && /too large|file size/i.test(text)) throw new HttpError(413, 'too_large'); // лимит тарифа Cloudinary
      if (res.status === 400 && /already exists/i.test(text)) return;                                      // повтор после обрыва: файл уже там
      if (res.status < 500 && res.status !== 429) { console.error('[storage] cloudinary', res.status, text.slice(0, 200)); throw new HttpError(502, 'storage_unavailable'); }
      lastErr = new Error(`cloudinary ${res.status}`);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = e;
    }
    await sleep(400 * attempt);
  }
  console.error('[storage] cloudinary недоступен:', lastErr);
  throw new HttpError(502, 'storage_unavailable');
}

async function cldDestroy(file: string) {
  const params = { public_id: file, timestamp: String(Math.floor(Date.now() / 1000)) };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', config.CLOUDINARY_API_KEY!);
  form.append('signature', cldSign(params));
  await fetch(`${CLD}/${config.CLOUDINARY_CLOUD_NAME}/raw/destroy`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) }).catch(() => {});
}

/** Постоянный публичный адрес файла в облаке (null — диск или S3_PUBLIC_URL не задан). Именно он хранится в БД (Media.url). */
export const publicUrlFor = (file: string): string | null =>
  useCloudinary ? cldUrl(file) :
  useS3 && config.s3PublicBase ? `${config.s3PublicBase}/${encodeURIComponent(file)}` : null;

const s3 = useS3
  ? new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT || undefined,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! },
    })
  : null;

export const ensureUploadDir = () => { if (!remote) fs.mkdirSync(config.uploadDir, { recursive: true }); };
/** basename защищает от выхода из папки, даже если в БД окажется «../» */
const diskPath = (file: string) => path.join(config.uploadDir, path.basename(file));

/** Читает тело запроса с жёстким потолком размера. Возвращает число байт. */
export async function saveUpload(req: Request, file: string, mime: string, maxBytes: number): Promise<number> {
  if (remote) {
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new HttpError(413, 'too_large')); return; }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('aborted')));
    });
    if (size === 0) throw new HttpError(400, 'empty_file');
    const body = Buffer.concat(chunks);
    if (!sniffMatchesMime(mime, body.subarray(0, 16))) throw new HttpError(415, 'unsupported_type'); // содержимое не соответствует заявленному типу
    if (useCloudinary) await cldUpload(file, mime, body);
    else await s3!.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: file, Body: body, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
    return size;
  }
  const full = diskPath(file);
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(full, { flags: 'wx', mode: 0o640 });
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { req.unpipe(ws); ws.destroy(); reject(new HttpError(413, 'too_large')); }
      });
      req.on('error', reject);
      req.on('aborted', () => reject(new Error('aborted')));
      ws.on('error', reject);
      ws.on('finish', resolve);
      req.pipe(ws);
    });
    if (size === 0) throw new HttpError(400, 'empty_file');
    // проверяем настоящее начало файла (магические байты), а не только заявленный тип
    const fh = await fs.promises.open(full, 'r');
    try {
      const head = Buffer.alloc(16);
      const { bytesRead } = await fh.read(head, 0, 16, 0);
      if (!sniffMatchesMime(mime, head.subarray(0, bytesRead))) throw new HttpError(415, 'unsupported_type');
    } finally { await fh.close(); }
  } catch (e) {
    fs.promises.unlink(full).catch(() => {});
    throw e;
  }
  return size;
}

export async function removeFile(file: string) {
  if (useCloudinary) { await cldDestroy(path.basename(file)); return; }
  if (useS3) { await s3!.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: file })).catch(() => {}); return; }
  await fs.promises.unlink(diskPath(file)).catch(() => {});
}

/** Отдаёт файл клиенту (с поддержкой Range — перемотка аудио/видео). */
export async function sendFile(req: Request, res: Response, file: string, headers: Record<string, string>) {
  if (useCloudinary) {
    try {
      const range = req.get('range');
      const up = await fetch(cldUrl(file), { headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(30_000) });
      if (!up.ok && up.status !== 206) { if (!res.headersSent) res.status(404).json({ error: 'media_not_found' }); return; }
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.setHeader('Accept-Ranges', 'bytes');
      const len = up.headers.get('content-length'); if (len) res.setHeader('Content-Length', len);
      const cr = up.headers.get('content-range'); if (cr) res.setHeader('Content-Range', cr);
      res.status(up.status === 206 ? 206 : 200);
      if (!up.body) { res.end(); return; }
      Readable.fromWeb(up.body as never).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).json({ error: 'storage_unavailable' });
    }
    return;
  }
  if (!useS3) {
    res.sendFile(diskPath(file), { headers }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'media_not_found' }); });
    return;
  }
  try {
    const range = req.get('range');
    const out = await s3!.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: file, Range: range || undefined }));
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('Accept-Ranges', 'bytes');
    if (out.ContentLength != null) res.setHeader('Content-Length', String(out.ContentLength));
    if (out.ContentRange) { res.status(206); res.setHeader('Content-Range', out.ContentRange); }
    (out.Body as Readable).on('error', () => res.destroy()).pipe(res);
  } catch {
    if (!res.headersSent) res.status(404).json({ error: 'media_not_found' });
  }
}

/** Положить готовый буфер в облако (для скрипта переноса старых файлов с диска). На диске ничего не делает. */
export async function putRemote(file: string, mime: string, body: Buffer): Promise<void> {
  if (useCloudinary) return cldUpload(file, mime, body);
  if (useS3) { await s3!.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: file, Body: body, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' })); return; }
  throw new Error('Облачное хранилище не настроено (CLOUDINARY_* или S3_*)');
}
export const localPathFor = diskPath;
export const __test = { cldSign, cldUrl };
