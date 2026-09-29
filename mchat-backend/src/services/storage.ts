import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { config } from '../config';
import { HttpError } from '../utils/errors';

/**
 * Хранилище файлов. Два режима:
 *  • S3 (если заданы S3_BUCKET и ключи) — файлы живут вне сервера и не пропадают при перезапуске;
 *  • диск (по умолчанию) — просто и бесплатно, но на бесплатном Render диск стирается при каждом перезапуске.
 */
const useS3 = !!(config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
export const storageMode = useS3 ? 's3' : 'disk';

const s3 = useS3
  ? new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT || undefined,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! },
    })
  : null;

export const ensureUploadDir = () => { if (!useS3) fs.mkdirSync(config.uploadDir, { recursive: true }); };
/** basename защищает от выхода из папки, даже если в БД окажется «../» */
const diskPath = (file: string) => path.join(config.uploadDir, path.basename(file));

/** Читает тело запроса с жёстким потолком размера. Возвращает число байт. */
export async function saveUpload(req: Request, file: string, mime: string, maxBytes: number): Promise<number> {
  if (useS3) {
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
    await s3!.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: file, Body: Buffer.concat(chunks), ContentType: mime }));
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
  } catch (e) {
    fs.promises.unlink(full).catch(() => {});
    throw e;
  }
  return size;
}

export async function removeFile(file: string) {
  if (useS3) { await s3!.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: file })).catch(() => {}); return; }
  await fs.promises.unlink(diskPath(file)).catch(() => {});
}

/** Отдаёт файл клиенту (с поддержкой Range — перемотка аудио/видео). */
export async function sendFile(req: Request, res: Response, file: string, headers: Record<string, string>) {
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
