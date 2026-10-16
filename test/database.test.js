import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createDatabase, postgresOptions } from '../src/database.js';

test('PostgreSQL configuration enforces verified TLS without exposing credentials', () => {
  const options = postgresOptions('postgresql://user:password@db.example.com:5432/postgres?sslmode=disable', {});
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  assert.throws(() => postgresOptions('https://example.com'), /PostgreSQL connection string/);
});

test('certificate bypass is opt-in and forbidden in production', (context) => {
  context.mock.method(console, 'warn', () => {});
  const connection = 'postgresql://user:password@db.example.com/postgres';
  assert.equal(postgresOptions(connection, { DATABASE_TLS_SKIP_VERIFY: 'true' }).ssl.rejectUnauthorized, false);
  assert.equal(postgresOptions(connection, { DATABASE_TLS_SKIP_VERIFY: 'false' }).ssl.rejectUnauthorized, true);
  assert.throws(() => postgresOptions(connection, { DATABASE_TLS_SKIP_VERIFY: 'true', NODE_ENV: 'production' }), /forbidden in production/);
});

test('PostgreSQL adapter binds parameters and converts session expiry timestamps', async (context) => {
  const queries = [];
  context.mock.method(pg.Pool.prototype, 'query', async (sql, parameters) => {
    queries.push({ sql, parameters });
    return { rows: [{ id: '42' }] };
  });
  context.mock.method(pg.Pool.prototype, 'end', async () => {});
  const database = createDatabase({ connectionString: 'postgresql://user:password@db.example.com/postgres' });
  await database.ready();
  const result = await database.prepare('INSERT INTO users (name, email, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('Example', 'example@example.com', 'salt', 'hash', '2026-10-16T00:00:00Z');
  assert.equal(result.lastInsertRowid, '42');
  assert.match(queries.at(-1).sql, /public\.app_users.*\$1, \$2, \$3, \$4, \$5.*RETURNING id/);
  await database.prepare('SELECT * FROM users WHERE email = ?').get("example' OR 1=1 --");
  assert.equal(queries.at(-1).sql, 'SELECT * FROM public.app_users WHERE email = $1');
  assert.deepEqual(queries.at(-1).parameters, ["example' OR 1=1 --"]);
  const expires = Date.now();
  await database.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('token-hash', '42', expires);
  assert.equal(queries.at(-1).parameters[2].getTime(), expires);
  await database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(expires);
  assert.equal(queries.at(-1).parameters[0].getTime(), expires);
  await database.prepare('SELECT users.* FROM users JOIN sessions ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get('hash', expires);
  assert.match(queries.at(-1).sql, /public\.app_sessions.expires_at > \$2/);
  assert.equal(queries.at(-1).parameters[1].getTime(), expires);
  await database.close();
});