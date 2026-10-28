/**
 * Перенос ранее загруженных файлов с диска сервера в облако (Cloudinary или S3/Supabase).
 *   1) задай CLOUDINARY_* (или S3_*) в окружении;
 *   2) положи старые файлы в UPLOAD_DIR (на Render — запусти скрипт в Shell сервиса, пока диск ещё жив);
 *   3) npx tsx scripts/migrate-media-to-cloud.ts          (пробный прогон: ничего не меняет)
 *      npx tsx scripts/migrate-media-to-cloud.ts --apply  (загрузить и записать url в БД)
 * Повторный запуск безопасен: уже перенесённые записи (url != null) пропускаются.
 */
import fs from 'node:fs';
import { prisma } from '../src/db';
import { localPathFor, publicUrlFor, putRemote, storageMode } from '../src/services/storage';

async function main() {
  const apply = process.argv.includes('--apply');
  if (storageMode === 'disk') throw new Error('Облако не настроено: задай CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET');
  const rows = await prisma.media.findMany({ where: { url: null }, select: { id: true, file: true, mime: true } });
  let moved = 0, missing = 0, failed = 0;
  for (const m of rows) {
    const p = localPathFor(m.file);
    if (!fs.existsSync(p)) { missing++; continue; }
    if (!apply) { moved++; continue; }
    try {
      await putRemote(m.file, m.mime, await fs.promises.readFile(p));
      await prisma.media.update({ where: { id: m.id }, data: { url: publicUrlFor(m.file) } });
      moved++;
    } catch (e) { failed++; console.error('не удалось перенести', m.id, (e as Error).message); }
  }
  console.log(`${apply ? 'Перенесено' : 'Можно перенести'}: ${moved}; файла нет на диске: ${missing}; ошибок: ${failed}; всего без url: ${rows.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
