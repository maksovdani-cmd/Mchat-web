import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../middleware/auth';
import {
  addComment, addRepost, addStoryComment, createPost, createStory, deletePost, deleteStory, getPost, listFeed, listReposts,
  listUserPosts, listUserStories, searchPosts, setLike, setStoryLike,
} from '../services/posts';
import { wrap } from '../utils/errors';

const mediaId = z.string().min(1).max(40);
const intId = z.coerce.number().int().positive();
const clean = z.string().trim().regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/);

export const postsRouter = Router();
postsRouter.use(requireAuth);

/** Лента: мои посты + публичные посты остальных. ?username=… — посты одного человека. */
postsRouter.get('/', wrap(async (req, res) => {
  const { userId } = authOf(req);
  const username = typeof req.query.username === 'string' ? req.query.username : '';
  res.json({ posts: username ? await listUserPosts(userId, username) : await listFeed(userId) });
}));

postsRouter.get('/search', wrap(async (req, res) => {
  const q = z.string().trim().min(1).max(60).parse(req.query.q);
  res.json({ posts: await searchPosts(authOf(req).userId, q) });
}));

postsRouter.get('/reposts', wrap(async (req, res) => {
  const username = z.string().min(1).max(40).parse(req.query.username);
  res.json({ posts: await listReposts(authOf(req).userId, username) });
}));

postsRouter.post('/', wrap(async (req, res) => {
  const b = z.object({
    text: clean.pipe(z.string().max(2000)).default(''),
    mediaId: mediaId.optional(),
    thumbId: mediaId.optional(),
    privacy: z.enum(['public', 'private']).default('public'),
  }).parse(req.body);
  res.json({ post: await createPost(authOf(req).userId, b) });
}));

postsRouter.get('/:id', wrap(async (req, res) => {
  res.json({ post: await getPost(authOf(req).userId, intId.parse(req.params.id)) });
}));

postsRouter.delete('/:id', wrap(async (req, res) => {
  await deletePost(authOf(req).userId, intId.parse(req.params.id));
  res.json({ ok: true });
}));

postsRouter.put('/:id/like', wrap(async (req, res) => {
  const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
  res.json(await setLike(authOf(req).userId, intId.parse(req.params.id), liked));
}));

postsRouter.post('/:id/comments', wrap(async (req, res) => {
  const { text } = z.object({ text: clean.pipe(z.string().min(1).max(500)) }).parse(req.body);
  res.json({ comment: await addComment(authOf(req).userId, intId.parse(req.params.id), text) });
}));

postsRouter.post('/:id/repost', wrap(async (req, res) => {
  res.json(await addRepost(authOf(req).userId, intId.parse(req.params.id)));
}));

// ───────── истории ─────────
export const storiesRouter = Router();
storiesRouter.use(requireAuth);

storiesRouter.get('/', wrap(async (req, res) => {
  const username = z.string().min(1).max(40).parse(req.query.username);
  res.json({ stories: await listUserStories(authOf(req).userId, username) });
}));

storiesRouter.post('/', wrap(async (req, res) => {
  const b = z.object({
    mediaId: mediaId.optional(),
    bg: z.string().regex(/^[\w#(),.%\s-]{1,200}$/).optional(),
    textBlocks: z.array(z.object({
      text: clean.pipe(z.string().max(300)),
      color: z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-z]{3,20})$/).default('#ffffff'),
      font: z.string().regex(/^[\w ,'"-]{1,80}$/).default('Syne'),
      left: z.string().regex(/^\d{1,3}(\.\d{1,4})?%$/).default('50%'),
      top: z.string().regex(/^\d{1,3}(\.\d{1,4})?%$/).default('45%'),
      fontSize: z.number().min(8).max(120).default(26),
    })).max(20).default([]),
  }).parse(req.body);
  res.json({ story: await createStory(authOf(req).userId, b) });
}));

storiesRouter.delete('/:id', wrap(async (req, res) => {
  await deleteStory(authOf(req).userId, intId.parse(req.params.id));
  res.json({ ok: true });
}));

storiesRouter.put('/:id/like', wrap(async (req, res) => {
  const { liked } = z.object({ liked: z.boolean() }).parse(req.body);
  res.json(await setStoryLike(authOf(req).userId, intId.parse(req.params.id), liked));
}));

storiesRouter.post('/:id/comments', wrap(async (req, res) => {
  const { text } = z.object({ text: clean.pipe(z.string().min(1).max(300)) }).parse(req.body);
  res.json({ comment: await addStoryComment(authOf(req).userId, intId.parse(req.params.id), text) });
}));
