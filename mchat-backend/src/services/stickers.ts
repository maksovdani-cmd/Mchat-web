import { prisma } from '../db';
import { HttpError } from '../utils/errors';
import { isForbidden } from '../utils/moderation';
import { gcMedia, mediaUrl } from './media';

/**
 * Коллекции стикеров.
 *  • Каждый стикер лежит в коллекции (StickerPack). Коллекция принадлежит автору.
 *  • Любой пользователь может сохранить коллекцию себе целиком (StickerPackSave) — «Скачать коллекцию».
 *  • При создании стикера клиент называет коллекцию: существующую (packId / такое же название) или новую.
 */
export const MAX_PACKS_PER_USER = 50;
export const MAX_STICKERS_PER_PACK = 120;
export const MAX_SAVED_PACKS = 200;

const cleanTitle = (raw: string) => raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

type PackRow = {
  id: string; title: string; ownerId: string; createdAt: Date;
  owner: { name: string; username: string };
  stickers: { id: string; mediaId: string }[];
};

const toPackDTO = (p: PackRow, userId: string, saved: boolean) => ({
  id: p.id,
  title: p.title,
  owned: p.ownerId === userId,
  saved: p.ownerId === userId || saved,
  ownerName: p.owner.name,
  ownerUsername: p.owner.username,
  count: p.stickers.length,
  stickers: p.stickers.map((s) => ({ id: s.id, url: mediaUrl(s.mediaId) })),
});

const packInclude = {
  owner: { select: { name: true, username: true } },
  stickers: { select: { id: true, mediaId: true }, orderBy: { createdAt: 'asc' as const } },
};

/** Моя библиотека: свои коллекции + сохранённые чужие. */
export async function listMyPacks(userId: string) {
  const [own, saves] = await Promise.all([
    prisma.stickerPack.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' }, include: packInclude }),
    prisma.stickerPackSave.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { pack: { include: packInclude } } }),
  ]);
  return [
    ...own.map((p) => toPackDTO(p, userId, true)),
    ...saves.filter((s) => s.pack.ownerId !== userId).map((s) => toPackDTO(s.pack, userId, true)),
  ];
}

/** Карточка любой коллекции (открывается по нажатию на стикер в чате). */
export async function getPack(userId: string, packId: string) {
  const p = await prisma.stickerPack.findUnique({ where: { id: packId }, include: packInclude });
  if (!p) throw new HttpError(404, 'pack_not_found');
  const save = p.ownerId === userId ? null : await prisma.stickerPackSave.findUnique({ where: { userId_packId: { userId, packId } }, select: { userId: true } });
  return toPackDTO(p, userId, !!save);
}

async function ownedPack(userId: string, packId: string) {
  const p = await prisma.stickerPack.findUnique({ where: { id: packId } });
  if (!p || p.ownerId !== userId) throw new HttpError(404, 'pack_not_found');
  return p;
}

export async function createPack(userId: string, rawTitle: string) {
  const title = cleanTitle(rawTitle);
  if (!title) throw new HttpError(400, 'bad_request');
  if (isForbidden(title)) throw new HttpError(400, 'name_forbidden');
  const same = await prisma.stickerPack.findFirst({ where: { ownerId: userId, title: { equals: title, mode: 'insensitive' } } });
  if (same) return same; // коллекция с таким названием уже есть — просто используем её
  if ((await prisma.stickerPack.count({ where: { ownerId: userId } })) >= MAX_PACKS_PER_USER) throw new HttpError(409, 'too_many_packs');
  return prisma.stickerPack.create({ data: { ownerId: userId, title } });
}

export async function renamePack(userId: string, packId: string, rawTitle: string) {
  await ownedPack(userId, packId);
  const title = cleanTitle(rawTitle);
  if (!title) throw new HttpError(400, 'bad_request');
  if (isForbidden(title)) throw new HttpError(400, 'name_forbidden');
  await prisma.stickerPack.update({ where: { id: packId }, data: { title } });
}

export async function deletePack(userId: string, packId: string) {
  await ownedPack(userId, packId);
  const media = await prisma.sticker.findMany({ where: { packId }, select: { mediaId: true } });
  await prisma.stickerPack.delete({ where: { id: packId } }); // стикеры и сохранения удаляются каскадом; уже отправленные сообщения остаются
  for (const m of media) await gcMedia(m.mediaId).catch(() => {});
}

/** Добавить стикер: в существующую коллекцию (packId) или в коллекцию с названием packTitle (создаётся, если её нет). */
export async function addSticker(userId: string, input: { mediaId: string; packId?: string; packTitle?: string }) {
  const media = await prisma.media.findUnique({ where: { id: input.mediaId } });
  if (!media || media.ownerId !== userId) throw new HttpError(404, 'media_not_found');
  if (media.kind !== 'IMAGE') throw new HttpError(400, 'media_kind_mismatch');
  const pack = input.packId ? await ownedPack(userId, input.packId) : input.packTitle ? await createPack(userId, input.packTitle) : null;
  if (!pack) throw new HttpError(400, 'pack_required'); // стикер не бывает «ничей»: нужно название коллекции
  if ((await prisma.sticker.count({ where: { packId: pack.id } })) >= MAX_STICKERS_PER_PACK) throw new HttpError(409, 'pack_full');
  const dup = await prisma.sticker.findFirst({ where: { packId: pack.id, mediaId: media.id }, select: { id: true } });
  const sticker = dup ?? (await prisma.sticker.create({ data: { packId: pack.id, mediaId: media.id } }));
  await prisma.stickerPack.update({ where: { id: pack.id }, data: { updatedAt: new Date() } });
  return { sticker: { id: sticker.id, url: mediaUrl(media.id) }, pack: await getPack(userId, pack.id) };
}

export async function deleteSticker(userId: string, stickerId: string) {
  const s = await prisma.sticker.findUnique({ where: { id: stickerId }, include: { pack: { select: { ownerId: true } } } });
  if (!s || s.pack.ownerId !== userId) throw new HttpError(404, 'sticker_not_found');
  await prisma.sticker.delete({ where: { id: stickerId } });
  await gcMedia(s.mediaId).catch(() => {});
}

/** «Скачать коллекцию целиком»: набор появляется в моей библиотеке. */
export async function savePack(userId: string, packId: string) {
  const p = await prisma.stickerPack.findUnique({ where: { id: packId }, select: { ownerId: true } });
  if (!p) throw new HttpError(404, 'pack_not_found');
  if (p.ownerId !== userId) {
    if ((await prisma.stickerPackSave.count({ where: { userId } })) >= MAX_SAVED_PACKS) throw new HttpError(409, 'too_many_packs');
    await prisma.stickerPackSave.upsert({ where: { userId_packId: { userId, packId } }, create: { userId, packId }, update: {} });
  }
  return getPack(userId, packId);
}

export async function unsavePack(userId: string, packId: string) {
  await prisma.stickerPackSave.deleteMany({ where: { userId, packId } });
}
