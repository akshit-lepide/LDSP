import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import handler from '../src/server.js';

test('Vercel default handler refuses SQLite fallback and serves bundled pages and assets', async (context) => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_TLS_SKIP_VERIFY: process.env.DATABASE_TLS_SKIP_VERIFY };
  context.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.DATABASE_URL = '';
  process.env.DATABASE_TLS_SKIP_VERIFY = 'false';
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const unavailable = await fetch(origin + '/login');
    assert.equal(unavailable.status, 503);
    assert.match((await unavailable.json()).error, /DATABASE_URL/);
    process.env.DATABASE_URL = 'postgresql://user:password@db.example.com/postgres';
    const login = await fetch(origin + '/login');
    assert.equal(login.status, 200);
    assert.match(await login.text(), /Sign in to Lepide/);
    for (const path of ['/signup', '/assets/app.css', '/assets/app.js']) {
      assert.equal((await fetch(origin + path)).status, 200, path);
    }
    assert.equal((await fetch(origin + '/api/me')).status, 401);
    assert.equal((await fetch(origin + '/account', { redirect: 'manual' })).headers.get('location'), '/login');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});