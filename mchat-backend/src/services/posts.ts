import { prisma } from '../db';
import { HttpError } from '../utils/errors';
import { gcMedia, mediaUrl } from './media';
import { generalOf } from './titles';
import { sendPushToUser } from './push';

const authorSelect = { id: true, username: true, name: true, avatarUrl: true, verified: true, generalTitle: true, generalStyle: true } as const;

const postInclude = (_viewerId: string) => ({
  author: { select: authorSelect },
  likes: { select: { userId: true } },
  comments: { orderBy: { createdAt: 'asc' as const }, include: { user: { select: { username: true, name: true, avatarUrl: true } }, likes: { select: { userId: true } } } },
  reposts: { select: { user: { select: { username: true } } } },
  _count: { select: { likes: true } },
});


type CommentRow = {
  id: number; text: string; createdAt: Date; replyToId: number | null; replyToUsername: string | null; replyToText: string | null;
  user: { username: string; name: string; avatarUrl: string | null }; likes?: { userId: string }[];
};
const MENTION_RE = /(^|[^a-z0-9_])@([a-z0-9_]{3,20})/gi;
export const mentionsIn = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) out.add(m[2].toLowerCase());
  return [...out].slice(0, 10);
};
/** Комментарий в формате клиента: автор, лайки (с моим состоянием), ответ на другой комментарий. */
export function commentDTO(c: CommentRow, viewerId: string, mentions?: string[]) {
  const likes = c.likes ?? [];
  return {
    id: c.id, username: c.user.username, name: c.user.name, avatar: c.user.avatarUrl, text: c.text, createdAt: c.createdAt.toISOString(),
    likes: likes.length, liked: likes.some((l) => l.userId === viewerId),
    replyTo: c.replyToUsername ? { id: c.replyToId, username: c.replyToUsername, text: c.replyToText ?? '', deleted: c.replyToId == null } : null,
    mentions: mentions ?? mentionsIn(c.text),
  };
}

type PostRow = Awaited<ReturnType<typeof loadPosts>>[number];

/** У каких из этих авторов сейчас есть активная история (для цветного кольца вокруг аватарки в профиле и «Рилс»). */
async function storyAuthorsOf(authorIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(authorIds)];
  if (!ids.length) return new Set();
  const rows = await prisma.story.groupBy({ by: ['authorId'], where: { authorId: { in: ids }, expiresAt: { gt: new Date() } } });
  return new Set(rows.map((r) => r.authorId));
}

export function toPostDTO(p: PostRow, viewerId: string, storyAuthors?: Set<string>) {
  return {
    hasStory: storyAuthors ? storyAuthors.has(p.authorId) : false,
    id: p.id,
    username: p.author.username,
    name: p.author.name,
    avatar: p.author.avatarUrl,
    verified: p.author.verified,
    general: generalOf(p.author),
    text: p.text,
    createdAt: p.createdAt.toISOString(),
    likes: p._count.likes,
    liked: p.likes.some((l) => l.userId === viewerId),
    comments: p.comments.map((c) => commentDTO(c, viewerId)),
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
  const sa = await storyAuthorsOf(rows.map((r) => r.authorId));
  return rows.map((p) => toPostDTO(p, viewerId, sa));
}

/** Посты одного пользователя: чужие — только публичные. */
export async function listUserPosts(viewerId: string, username: string) {
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  const where = u.id === viewerId ? { authorId: u.id } : { authorId: u.id, privacy: 'public' };
  const rows = await loadPosts(viewerId, where, 100);
  const sa = await storyAuthorsOf(rows.map((r) => r.authorId));
  return rows.map((p) => toPostDTO(p, viewerId, sa));
}

export async function getPost(viewerId: string, id: number) {
  const row = await prisma.post.findUnique({ where: { id }, include: postInclude(viewerId) });
  if (!row || (row.privacy === 'private' && row.authorId !== viewerId)) throw new HttpError(404, 'post_not_found');
  return toPostDTO(row, viewerId, await storyAuthorsOf([row.authorId]));
}

export async function searchPosts(viewerId: string, q: string) {
  const rows = await loadPosts(viewerId, {
    privacy: 'public',
    OR: [{ text: { contains: q, mode: 'insensitive' } }, { author: { name: { contains: q, mode: 'insensitive' } } }],
  }, 10);
  const sa = await storyAuthorsOf(rows.map((r) => r.authorId));
  return rows.map((p) => toPostDTO(p, viewerId, sa));
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

export async function addComment(userId: string, id: number, text: string, replyToId?: number | null) {
  const post = await visiblePost(userId, id);
  let reply: { id: number; userId: string; text: string; user: { username: string } } | null = null;
  if (replyToId != null) {
    reply = await prisma.postComment.findFirst({ where: { id: replyToId, postId: id }, select: { id: true, userId: true, text: true, user: { select: { username: true } } } });
    if (!reply) throw new HttpError(404, 'comment_not_found');
  }
  const c = await prisma.postComment.create({
    data: {
      postId: id, userId, text, replyToId: reply ? reply.id : null,
      replyToUsername: reply ? reply.user.username : null, replyToText: reply ? reply.text.slice(0, 160) : null,
    },
    include: { user: { select: { username: true, name: true, avatarUrl: true } }, likes: { select: { userId: true } } },
  });
  // упоминания: только реально существующие пользователи
  const names = mentionsIn(text);
  const found = names.length ? await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true, username: true } }) : [];
  void notifyComment(userId, c.user.username, id, text, found, reply ? reply.userId : null, post.authorId);
  return commentDTO(c, userId, found.map((u) => u.username));
}

/** Push: упомянутым пользователям и автору комментария, на который ответили. Ошибки доставки не влияют на сам комментарий. */
async function notifyComment(actorId: string, actorName: string, postId: number, text: string, mentioned: { id: string; username: string }[], replyOwner: string | null, _postAuthor: string) {
  try {
    const sent = new Set<string>([actorId]);
    for (const u of mentioned) {
      if (sent.has(u.id)) continue; sent.add(u.id);
      await sendPushToUser(u.id, { title: '@' + actorName + ' упомянул(а) вас', body: text.slice(0, 120), tag: 'mention-' + postId, data: { type: 'mention', postId }, urgency: 'normal' });
    }
    if (replyOwner && !sent.has(replyOwner)) await sendPushToUser(replyOwner, { title: '@' + actorName + ' ответил(а) на ваш комментарий', body: text.slice(0, 120), tag: 'reply-' + postId, data: { type: 'reply', postId }, urgency: 'normal' });
  } catch (e) { console.error('comment notify', e); }
}

/** Лайк/снятие лайка комментария: идемпотентно, счётчик считается по таблице (повторный запрос ничего не накручивает). */
export async function setCommentLike(userId: string, postId: number, commentId: number, liked: boolean) {
  await visiblePost(userId, postId);
  const c = await prisma.postComment.findFirst({ where: { id: commentId, postId }, select: { id: true } });
  if (!c) throw new HttpError(404, 'comment_not_found');
  if (liked) await prisma.postCommentLike.upsert({ where: { commentId_userId: { commentId, userId } }, create: { commentId, userId }, update: {} });
  else await prisma.postCommentLike.deleteMany({ where: { commentId, userId } });
  return { id: commentId, likes: await prisma.postCommentLike.count({ where: { commentId } }), liked };
}

/** Кого можно упомянуть под постом: автор, участники обсуждения и мои друзья. Посторонние не предлагаются. */
export async function mentionCandidates(userId: string, postId: number, q: string) {
  const post = await visiblePost(userId, postId);
  const [commenters, author, friends] = await Promise.all([
    prisma.postComment.findMany({ where: { postId }, distinct: ['userId'], select: { user: { select: { id: true, username: true, name: true, avatarUrl: true } } } }),
    prisma.user.findUnique({ where: { id: post.authorId }, select: { id: true, username: true, name: true, avatarUrl: true } }),
    prisma.friendship.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, take: 100,
      select: { requesterId: true, requester: { select: { id: true, username: true, name: true, avatarUrl: true } }, addressee: { select: { id: true, username: true, name: true, avatarUrl: true } } } }),
  ]);
  const map = new Map<string, { id: string; username: string; name: string; avatar: string | null }>();
  const add = (u: { id: string; username: string; name: string; avatarUrl: string | null } | null | undefined) => {
    if (u && u.id !== userId && !map.has(u.id)) map.set(u.id, { id: u.id, username: u.username, name: u.name, avatar: u.avatarUrl });
  };
  add(author); commenters.forEach((c) => add(c.user)); friends.forEach((f) => add(f.requesterId === userId ? f.addressee : f.requester));
  const needle = q.trim().replace(/^@/, '').toLowerCase();
  return [...map.values()].filter((u) => !needle || u.username.includes(needle) || u.name.toLowerCase().includes(needle)).slice(0, 8);
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
  const sa = await storyAuthorsOf(rows.map((r) => r.post.authorId));
  return rows.map((r) => ({ ...toPostDTO(r.post, viewerId, sa), repostedAt: r.createdAt.toISOString() }));
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

/** Истории видят только подписчики автора (и сам автор). */
async function canSeeStories(viewerId: string, authorId: string) {
  if (viewerId === authorId) return true;
  return (await prisma.follow.count({ where: { followerId: viewerId, followingId: authorId } })) > 0;
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

/**
 * Лента историй: активные (не старше 24 часов) истории тех, НА КОГО Я ПОДПИСАН, сгруппированные по автору.
 * Истории видны только подписчикам автора — чужим людям они в ленту не попадают.
 */
export async function listStoriesFeed(viewerId: string) {
  const follows = await prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } });
  const following = new Set(follows.map((f) => f.followingId));
  const rows = await prisma.story.findMany({
    where: { expiresAt: { gt: new Date() }, authorId: { in: [...following] } },
    orderBy: { createdAt: 'asc' },
    include: storyInclude,
    take: 500,
  });
  const groups = new Map<string, {
    username: string; name: string; avatar: string | null; verified: boolean; general: string | null; following: boolean; latestAt: number;
    stories: ReturnType<typeof toStoryDTO>[];
  }>();
  for (const s of rows) {
    let g = groups.get(s.authorId);
    if (!g) {
      g = {
        username: s.author.username, name: s.author.name, avatar: s.author.avatarUrl, verified: s.author.verified, general: generalOf(s.author),
        following: following.has(s.authorId), latestAt: 0, stories: [],
      };
      groups.set(s.authorId, g);
    }
    g.stories.push(toStoryDTO(s, viewerId));
    g.latestAt = Math.max(g.latestAt, s.createdAt.getTime());
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.following) - Number(a.following) || b.latestAt - a.latestAt)
    .slice(0, 60);
}

export async function listUserStories(viewerId: string, username: string) {
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!u) throw new HttpError(404, 'user_not_found');
  if (!(await canSeeStories(viewerId, u.id))) throw new HttpError(403, 'stories_followers_only');
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

async function liveStory(id: number, viewerId: string) {
  const s = await prisma.story.findUnique({ where: { id }, select: { id: true, expiresAt: true, authorId: true } });
  if (!s || s.expiresAt < new Date()) throw new HttpError(404, 'story_not_found');
  if (!(await canSeeStories(viewerId, s.authorId))) throw new HttpError(403, 'stories_followers_only');
}

export async function setStoryLike(userId: string, id: number, liked: boolean) {
  await liveStory(id, userId);
  if (liked) await prisma.storyLike.upsert({ where: { storyId_userId: { storyId: id, userId } }, create: { storyId: id, userId }, update: {} });
  else await prisma.storyLike.deleteMany({ where: { storyId: id, userId } });
  return { likes: await prisma.storyLike.count({ where: { storyId: id } }), liked };
}

export async function addStoryComment(userId: string, id: number, text: string) {
  await liveStory(id, userId);
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