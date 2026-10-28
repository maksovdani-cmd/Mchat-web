import test from 'node:test';
import assert from 'node:assert';

// минимальное окружение, чтобы config.ts прошёл проверку (в тесте нет ни БД, ни сети)
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/x';
process.env.JWT_SECRET ??= 'a'.repeat(48);
process.env.GOOGLE_CLIENT_ID ??= 'x';
process.env.GOOGLE_CLIENT_SECRET ??= 'y';
process.env.APP_URL ??= 'https://mchat-web.org';
process.env.VAPID_PUBLIC_KEY ??= 'pub';
process.env.VAPID_PRIVATE_KEY ??= 'priv';
process.env.CLOUDINARY_CLOUD_NAME = 'democloud';
process.env.CLOUDINARY_API_KEY = 'key123';
process.env.CLOUDINARY_API_SECRET = 'abcd';

test('Cloudinary: подпись совпадает с примером из документации, режим хранилища — cloudinary', async () => {
  const { __test, storageMode, publicUrlFor } = await import('../src/services/storage');
  assert.strictEqual(storageMode, 'cloudinary');
  // пример из документации Cloudinary: public_id=sample_image, timestamp=1315060510, secret=abcd
  assert.strictEqual(__test.cldSign({ timestamp: '1315060510', public_id: 'sample_image' }), 'b4ad47fb4e25c7bf5f92a20089f9db59bc302313');
  assert.strictEqual(publicUrlFor('a-b.webm'), 'https://res.cloudinary.com/democloud/raw/upload/a-b.webm');
});

test('Cloudinary: загрузка — повтор при 5xx, подписанный multipart, ошибка 413 на лимит тарифа', async () => {
  const { putRemote } = await import('../src/services/storage');
  const calls: Array<{ url: string; form: FormData }> = [];
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (url: string, init: { body: FormData }) => {
    calls.push({ url, form: init.body });
    n++;
    return n === 1 ? new Response('oops', { status: 503 }) : new Response('{"public_id":"x"}', { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await putRemote('f1.bin', 'application/octet-stream', Buffer.from('hello'));
  } finally { globalThis.fetch = realFetch; }
  assert.strictEqual(calls.length, 2, 'после 503 была повторная попытка');
  assert.ok(calls[1].url.endsWith('/v1_1/democloud/raw/upload'));
  const f = calls[1].form;
  assert.strictEqual(f.get('api_key'), 'key123');
  assert.ok(/^[0-9a-f]{40}$/.test(String(f.get('signature'))));
  assert.ok(!String(f.get('signature')).includes('abcd'), 'секрет в запрос не уходит');
  assert.strictEqual(f.get('public_id'), 'f1.bin');

  globalThis.fetch = (async () => new Response('{"error":{"message":"File size too large"}}', { status: 400 })) as unknown as typeof fetch;
  try { await assert.rejects(putRemote('f2.bin', 'x/y', Buffer.from('1')), (e: { status?: number }) => e.status === 413); }
  finally { globalThis.fetch = realFetch; }
});
