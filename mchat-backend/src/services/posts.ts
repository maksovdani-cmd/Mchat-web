import { prisma } from '../db';
import { HttpError } from '../utils/errors';
import { gcMedia, mediaUrl } from './media';

const authorSelect = { id: true, username: true, name: true, avatarUrl: true, verified: true } as const;

const postInclude = (_viewerId: string) => ({
  author: { select: authorSelect },
  likes: { select: { userId: true } },
  comments: { orderBy: { createdAt: 'asc' as const }, include: { user: { select: { username: true } } } },
  reposts: { select: { user: { select: { username: true } } } },
  _count: { select: { likes: true } },
});

type PostRow = Awaited<ReturnType<typeof loadPosts>>[number];

export function toPostDTO(p: PostRow, viewerId: string) {
  return {
    id: p.id,
    username: p.author.username,
    name: p.author.name,
    avatar: p.author.avatarUrl,
    verified: p.author.verified,
    text: p.text,
    createdAt: p.createdAt.toISOString(),
    likes: p._count.likes,
    liked: p.likes.some((l) => l.userId === viewerId),
    comments: p.comments.map((c) => ({ id: c.id, username: c.user.username, text: c.text, createdAt: c.createdAt.toISOString() })),
    mediaType: p.mediaType,
    mediaUrl: p.mediaId ? mediaUrl(p.mediaId) : null,
    thumbnail: p.thumbId ? mediaUrl(p.thumbId) : null,
    privacy: p.privacy,
    repostedBy: p.reposts.map((r) => r.user.username),
  };
}

function loadPosts(viewerId: string, where: object, take: number) {
  return prisma.post.findMany({ where, orderBy: { createdAt: 'desc' }, take, include: postInclude(viewerId) });
}

/** Лента: мои посты (включая архив) + публичные посты остальных. */
export async function listFeed(viewerId: string) {
  const rows = await loadPosts(viewerId, { OR: [{ authorId: viewerId }, { privacy: 'public' }] }, 100);
  return rows.map((p) => toPostDTO(p, viewerId));
}

/** Посты одного пользователя: чужие — только публичные. */
export async function listUserPosts(viewerId: string, username: string) {
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  const where = u.id === viewerId ? { authorId: u.id } : { authorId: u.id, privacy: 'public' };
  const rows = await loadPosts(viewerId, where, 100);
  return rows.map((p) => toPostDTO(p, viewerId));
}

export async function getPost(viewerId: string, id: number) {
  const row = await prisma.post.findUnique({ where: { id }, include: postInclude(viewerId) });
  if (!row || (row.privacy === 'private' && row.authorId !== viewerId)) throw new HttpError(404, 'post_not_found');
  return toPostDTO(row, viewerId);
}

export async function searchPosts(viewerId: string, q: string) {
  const rows = await loadPosts(viewerId, {
    privacy: 'public',
    OR: [{ text: { contains: q, mode: 'insensitive' } }, { author: { name: { contains: q, mode: 'insensitive' } } }],
  }, 10);
  return rows.map((p) => toPostDTO(p, viewerId));
}

async function ownImage(userId: string, mediaId: string, kinds: string[]) {
  const m = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!m || m.ownerId !== userId || !kinds.includes(m.kind)) throw new HttpError(400, 'bad_media');
  return m;
}

export async function createPost(
  userId: string,
  b: { text: string; mediaId?: string; thumbId?: string; privacy: 'public' | 'private' },
) {
  if (!b.text && !b.mediaId) throw new HttpError(400, 'empty_post');
  let mediaType: string | null = null;
  if (b.mediaId) {
    const m = await ownImage(userId, b.mediaId, ['IMAGE', 'VIDEO']);
    mediaType = m.kind === 'VIDEO' ? 'video' : 'image';
  }
  if (b.thumbId) await ownImage(userId, b.thumbId, ['IMAGE']);
  const row = await prisma.post.create({
    data: { authorId: userId, text: b.text, mediaId: b.mediaId ?? null, mediaType, thumbId: b.thumbId ?? null, privacy: b.privacy },
    include: postInclude(userId),
  });
  return toPostDTO(row, userId);
}

export async function deletePost(userId: string, id: number) {
  const p = await prisma.post.findUnique({ where: { id } });
  if (!p || p.authorId !== userId) throw new HttpError(404, 'post_not_found');
  await prisma.post.delete({ where: { id } });
  for (const m of [p.mediaId, p.thumbId]) if (m) await gcMedia(m);
}

async function visiblePost(userId: string, id: number) {
  const p = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, privacy: true } });
  if (!p || (p.privacy === 'private' && p.authorId !== userId)) throw new HttpError(404, 'post_not_found');
  return p;
}

export async function setLike(userId: string, id: number, liked: boolean) {
  await visiblePost(userId, id);
  if (liked) await prisma.postLike.upsert({ where: { postId_userId: { postId: id, userId } }, create: { postId: id, userId }, update: {} });
  else await prisma.postLike.deleteMany({ where: { postId: id, userId } });
  return { likes: await prisma.postLike.count({ where: { postId: id } }), liked };
}

export async function addComment(userId: string, id: number, text: string) {
  await visiblePost(userId, id);
  const c = await prisma.postComment.create({ data: { postId: id, userId, text }, include: { user: { select: { username: true } } } });
  return { id: c.id, username: c.user.username, text: c.text, createdAt: c.createdAt.toISOString() };
}

export async function addRepost(userId: string, id: number) {
  const p = await visiblePost(userId, id);
  if (p.authorId === userId) throw new HttpError(400, 'own_post');
  await prisma.postRepost.upsert({ where: { postId_userId: { postId: id, userId } }, create: { postId: id, userId }, update: {} });
  return { ok: true };
}

/** Репосты пользователя (как публичные посты других авторов). */
export async function listReposts(viewerId: string, username: string) {
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  const rows = await prisma.postRepost.findMany({
    where: { userId: u.id, post: { OR: [{ privacy: 'public' }, { authorId: viewerId }] } },
    orderBy: { createdAt: 'desc' }, take: 50,
    include: { post: { include: postInclude(viewerId) } },
  });
  return rows.map((r) => ({ ...toPostDTO(r.post, viewerId), repostedAt: r.createdAt.toISOString() }));
}

// ───────────────────────────── истории ─────────────────────────────

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORIES_PER_DAY = 6;

const storyInclude = {
  author: { select: authorSelect },
  likes: { select: { userId: true } },
  comments: { orderBy: { createdAt: 'asc' as const }, include: { user: { select: { username: true } } } },
};
type StoryRow = Awaited<ReturnType<typeof loadStories>>[number];

function loadStories(where: object) {
  return prisma.story.findMany({ where: { expiresAt: { gt: new Date() }, ...where }, orderBy: { createdAt: 'asc' }, include: storyInclude });
}

export function toStoryDTO(s: StoryRow, viewerId: string) {
  const url = s.mediaId ? mediaUrl(s.mediaId) : null;
  return {
    id: s.id,
    username: s.author.username,
    name: s.author.name,
    avatar: s.author.avatarUrl,
    bg: s.bg,
    textBlocks: s.textBlocks,
    img: s.mediaType === 'image' ? url : null,
    video: s.mediaType === 'video' ? url : null,
    publishedAt: s.createdAt.getTime(),
    likes: s.likes.length,
    liked: s.likes.some((l) => l.userId === viewerId),
    comments: s.comments.map((c) => ({ username: c.user.username, text: c.text, createdAt: c.createdAt.toISOString() })),
  };
}

export async function listUserStories(viewerId: string, username: string) {
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  return (await loadStories({ authorId: u.id })).map((s) => toStoryDTO(s, viewerId));
}

export async function createStory(
  userId: string,
  b: { mediaId?: string; bg?: string; textBlocks: unknown },
) {
  const since = new Date(Date.now() - STORY_TTL_MS);
  if ((await prisma.story.count({ where: { authorId: userId, createdAt: { gt: since } } })) >= MAX_STORIES_PER_DAY) {
    throw new HttpError(429, 'story_limit');
  }
  let mediaType: string | null = null;
  if (b.mediaId) {
    const m = await ownImage(userId, b.mediaId, ['IMAGE', 'VIDEO']);
    mediaType = m.kind === 'VIDEO' ? 'video' : 'image';
  }
  const row = await prisma.story.create({
    data: {
      authorId: userId, mediaId: b.mediaId ?? null, mediaType, bg: b.bg ?? null,
      textBlocks: b.textBlocks as object, expiresAt: new Date(Date.now() + STORY_TTL_MS),
    },
    include: storyInclude,
  });
  return toStoryDTO(row, userId);
}

export async function deleteStory(userId: string, id: number) {
  const s = await prisma.story.findUnique({ where: { id } });
  if (!s || s.authorId !== userId) throw new HttpError(404, 'story_not_found');
  await prisma.story.delete({ where: { id } });
  if (s.mediaId) await gcMedia(s.mediaId);
}

async function liveStory(id: number) {
  const s = await prisma.story.findUnique({ where: { id }, select: { id: true, expiresAt: true } });
  if (!s || s.expiresAt < new Date()) throw new HttpError(404, 'story_not_found');
}

export async function setStoryLike(userId: string, id: number, liked: boolean) {
  await liveStory(id);
  if (liked) await prisma.storyLike.upsert({ where: { storyId_userId: { storyId: id, userId } }, create: { storyId: id, userId }, update: {} });
  else await prisma.storyLike.deleteMany({ where: { storyId: id, userId } });
  return { likes: await prisma.storyLike.count({ where: { storyId: id } }), liked };
}

export async function addStoryComment(userId: string, id: number, text: string) {
  await liveStory(id);
  const c = await prisma.storyComment.create({ data: { storyId: id, userId, text }, include: { user: { select: { username: true } } } });
  return { username: c.user.username, text: c.text, createdAt: c.createdAt.toISOString() };
}

/** Просроченные истории и их файлы — раз в час. */
export async function purgeExpiredStories() {
  const old = await prisma.story.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true, mediaId: true } });
  if (!old.length) return;
  await prisma.story.deleteMany({ where: { id: { in: old.map((s) => s.id) } } });
  for (const s of old) if (s.mediaId) await gcMedia(s.mediaId);
}
