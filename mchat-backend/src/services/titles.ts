import { prisma } from '../db';
import { emitToUser } from '../realtime/hub';
import { HttpError } from '../utils/errors';
import { normalizeUsername } from '../utils/validate';

/** Допустимые настройки звезды. Цвета в списке нет намеренно: цвет фиксированный (пурпурный). */
export const GLOW = ['soft', 'normal', 'bright'] as const;
export const ANIM = ['pulse', 'shimmer', 'sparkle', 'calm'] as const;
export const DEFAULT_STYLE = 'normal.pulse';

export const normStyle = (glow: string, anim: string) => {
  if (!(GLOW as readonly string[]).includes(glow) || !(ANIM as readonly string[]).includes(anim)) throw new HttpError(400, 'bad_style');
  return `${glow}.${anim}`;
};

/** То, что уходит клиентам рядом с verified: null — титула нет, иначе строка оформления «яркость.анимация». */
export const generalOf = (u: { generalTitle?: boolean | null; generalStyle?: string | null }): string | null =>
  u.generalTitle ? (u.generalStyle || DEFAULT_STYLE) : null;

const sel = { id: true, username: true, name: true, avatarUrl: true, generalTitle: true, generalGrantedAt: true } as const;
const shape = (u: { id: string; username: string; name: string; avatarUrl: string | null; generalTitle: boolean; generalGrantedAt: Date | null }) => ({
  id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl, general: u.generalTitle, grantedAt: u.generalGrantedAt?.toISOString() ?? null,
});

/** Панель создателя: все, у кого сейчас есть титул. */
export const listGenerals = async () =>
  (await prisma.user.findMany({ where: { generalTitle: true }, orderBy: { generalGrantedAt: 'desc' }, take: 500, select: sel })).map(shape);

/** Поиск человека по нику/имени, чтобы выдать титул. */
export async function findForTitle(q: string) {
  const term = q.replace(/^@/, '').trim();
  const rows = await prisma.user.findMany({
    where: { OR: [{ username: { contains: term.toLowerCase() } }, { name: { contains: term, mode: 'insensitive' } }] },
    orderBy: { username: 'asc' }, take: 20, select: sel,
  });
  return rows.map(shape);
}

/** Выдать титул навсегда. Повторная выдача ничего не ломает (экран поздравления не повторяется). */
export async function grantGeneral(rawUsername: string) {
  const u = await prisma.user.findUnique({ where: { username: normalizeUsername(rawUsername) }, select: { id: true, generalTitle: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  if (u.generalTitle) return { ok: true, already: true };
  await prisma.user.update({ where: { id: u.id }, data: { generalTitle: true, generalGrantedAt: new Date(), generalCelebratedAt: null } });
  emitToUser(u.id, 'title:granted', { title: 'general' }); // если человек сейчас в сети — праздничный экран появится сразу
  return { ok: true, already: false };
}

/** Забрать титул. При повторной выдаче поздравление покажется снова. */
export async function revokeGeneral(userId: string) {
  const r = await prisma.user.updateMany({ where: { id: userId, generalTitle: true }, data: { generalTitle: false, generalGrantedAt: null, generalCelebratedAt: null, generalStyle: null } });
  if (!r.count) throw new HttpError(404, 'user_not_found');
  emitToUser(userId, 'title:revoked', { title: 'general' });
  return { ok: true };
}

/** Владелец титула меняет ТОЛЬКО яркость свечения и анимацию. Цвет и «убрать звезду» недоступны. */
export async function setGeneralStyle(userId: string, glow: string, anim: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { generalTitle: true } });
  if (!u?.generalTitle) throw new HttpError(403, 'forbidden');
  const style = normStyle(glow, anim);
  await prisma.user.update({ where: { id: userId }, data: { generalStyle: style } });
  return { style };
}

/** Человек увидел праздничный экран — больше не показываем. */
export async function markGeneralSeen(userId: string) {
  await prisma.user.updateMany({ where: { id: userId, generalTitle: true, generalCelebratedAt: null }, data: { generalCelebratedAt: new Date() } });
  return { ok: true };
}
