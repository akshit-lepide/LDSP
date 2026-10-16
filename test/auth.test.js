import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

async function start(options = {}) {
  const server = createApp({ databasePath: ':memory:', connectionString: '', ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, data, headers = {}) => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data)
  });
  return { server, url, post, stop: () => new Promise((resolve) => server.close(resolve)) };
}

const account = { name: 'Alex Morgan', email: 'alex@example.com', password: 'A sufficiently long password', confirmPassword: 'A sufficiently long password' };

test('signup, protected account, login, remember me, rotation and logout', async () => {
  const app = await start();
  try {
    assert.equal((await fetch(app.url + '/api/me')).status, 401);
    const guarded = await fetch(app.url + '/account', { redirect: 'manual' });
    assert.equal(guarded.headers.get('location'), '/login');
    const signup = await app.post('/api/signup', account);
    assert.equal(signup.status, 201);
    const user = (await signup.json()).user;
    assert.equal(user.name, account.name);
    assert.equal(user.password_hash, undefined);
    const firstCookie = signup.headers.get('set-cookie').split(';')[0];
    assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal((await fetch(app.url + '/api/me', { headers: { Cookie: firstCookie } })).status, 200);
    assert.equal((await app.post('/api/signup', { ...account, email: 'ALEX@example.com' })).status, 409);
    assert.equal((await app.post('/api/login', { ...account, password: 'wrong password' })).status, 401);
    assert.equal((await app.post('/api/login', { ...account, email: 'absent@example.com' })).status, 401);
    const login = await app.post('/api/login', { ...account, remember: true }, { Cookie: firstCookie });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /Max-Age=2592000/);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.notEqual(cookie, firstCookie);
    assert.equal((await fetch(app.url + '/api/me', { headers: { Cookie: firstCookie } })).status, 401);
    assert.equal((await app.post('/api/logout', {}, { Cookie: cookie })).status, 200);
    assert.equal((await fetch(app.url + '/api/me', { headers: { Cookie: cookie } })).status, 401);
  } finally { await app.stop(); }
});

test('invalid inputs, malformed JSON, cross-origin writes and throttling', async () => {
  const app = await start({ rateLimit: 3 });
  try {
    const invalid = await app.post('/api/signup', { name: '', email: 'bad', password: 'short', confirmPassword: 'different' });
    assert.equal(invalid.status, 400);
    assert.equal(Object.keys((await invalid.json()).fields).length, 4);
    assert.equal((await app.post('/api/signup', account, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await app.post('/api/signup', account, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await fetch(app.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await app.post('/api/login', {})).status, 400);
    assert.equal((await app.post('/api/login', account)).status, 429);
  } finally { await app.stop(); }
});

test('accounts and sessions survive a server restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lepide-test-'));
  const databasePath = join(directory, 'accounts.sqlite');
  let app = await start({ databasePath });
  try {
    const response = await app.post('/api/signup', account);
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    await app.stop();
    app = await start({ databasePath });
    const current = await fetch(app.url + '/api/me', { headers: { Cookie: cookie } });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).user.email, account.email);
  } finally {
    await app.stop();
    await rm(directory, { recursive: true, force: true });
  }
});