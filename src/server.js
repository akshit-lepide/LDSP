import http from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createDatabase } from './database.js';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === 'production';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, createdAt: user.created_at });

export function createApp({ databasePath = join(root, '../data/accounts.sqlite'), connectionString = process.env.DATABASE_URL, rateLimit = 30 } = {}) {
  const database = createDatabase({ databasePath, connectionString });
  const attempts = new Map();
  const dummySalt = randomBytes(16).toString('hex');

  function send(response, status, payload) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  }

  function sessionToken(request) {
    return request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('session='))?.slice(8);
  }

  async function currentUser(request) {
    const token = sessionToken(request);
    if (!token) return null;
    return database.prepare(`SELECT users.* FROM users JOIN sessions ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(digest(token), Date.now());
  }

  async function issueSession(request, response, userId, remember) {
    const previous = sessionToken(request);
    if (previous) await database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(previous));
    await database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    const seconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
    await database.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), userId, Date.now() + seconds * 1000);
    response.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax${remember ? `; Max-Age=${seconds}` : ''}${production ? '; Secure' : ''}`);
  }

  async function body(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) {
      throw Object.assign(new Error('Send the request as JSON.'), { status: 415 });
    }
    let content = '';
    for await (const chunk of request) {
      content += chunk;
      if (Buffer.byteLength(content) > 8192) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    }
    try {
      const value = JSON.parse(content);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw Object.assign(new Error('Enter valid account information.'), { status: 400 });
    }
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://lepide-design-system.vercel.app; style-src 'self' https://lepide-design-system.vercel.app https://fonts.googleapis.com; font-src 'self' https: data:; img-src 'self' https://lepide-design-system.vercel.app; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const pathname = new URL(request.url, 'http://localhost').pathname;
    try {
      if (request.method === 'POST' && pathname.startsWith('/api/')) {
        const origin = request.headers.origin;
        const allowedOrigin = process.env.APP_ORIGIN || `${production ? 'https' : 'http'}://${request.headers.host}`;
        if (origin && origin !== allowedOrigin) return send(response, 403, { error: 'Request origin is not allowed.' });
        if (request.headers['sec-fetch-site'] === 'cross-site') return send(response, 403, { error: 'Cross-site request is not allowed.' });
        if (pathname === '/api/signup' || pathname === '/api/login') {
          const now = Date.now();
          for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
          const key = request.socket.remoteAddress;
          const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
          attempts.set(key, entry);
          if (++entry.count > rateLimit) {
            response.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
            return send(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
          }
          const input = await body(request);
          const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
          const password = typeof input.password === 'string' ? input.password : '';
          const fields = {};
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fields.email = 'Enter a valid email address.';
          if (!password || password.length > 128) fields.password = 'Enter a password of up to 128 characters.';
          if (pathname === '/api/signup') {
            const name = typeof input.name === 'string' ? input.name.trim() : '';
            if (name.length < 2 || name.length > 80) fields.name = 'Enter your name using 2 to 80 characters.';
            if (password.length < 12) fields.password = 'Use at least 12 characters.';
            if (password !== input.confirmPassword) fields.confirmPassword = 'Passwords do not match.';
            if (Object.keys(fields).length) return send(response, 400, { error: 'Check the highlighted fields.', fields });
            const salt = randomBytes(16).toString('hex');
            const hash = (await scrypt(password, salt, 64)).toString('hex');
            let userId;
            try {
              userId = (await database.prepare('INSERT INTO users (name, email, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(name, email, salt, hash, new Date().toISOString())).lastInsertRowid;
            } catch (error) {
              if (error.code === '23505' || (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE'))) return send(response, 409, { error: 'An account already uses this email. Sign in instead.', fields: { email: 'This email is already registered.' } });
              throw error;
            }
            await issueSession(request, response, userId, false);
            return send(response, 201, { user: publicUser(await database.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
          }
          if (Object.keys(fields).length) return send(response, 400, { error: 'Check the highlighted fields.', fields });
          const user = await database.prepare('SELECT * FROM users WHERE email = ?').get(email);
          const hash = await scrypt(password, user?.salt || dummySalt, 64);
          if (!user || !timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex'))) return send(response, 401, { error: 'Email or password is incorrect.' });
          await issueSession(request, response, user.id, input.remember === true);
          return send(response, 200, { user: publicUser(user) });
        }
        if (pathname === '/api/logout') {
          const token = sessionToken(request);
          if (token) await database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
          response.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? '; Secure' : ''}`);
          return send(response, 200, { ok: true });
        }
      }
      if (request.method === 'GET' && pathname === '/api/me') {
        const user = await currentUser(request);
        return user ? send(response, 200, { user: publicUser(user) }) : send(response, 401, { error: 'Sign in to continue.' });
      }
      if (request.method === 'GET') {
        const pages = { '/': 'login', '/login': 'login', '/signup': 'signup', '/account': 'account' };
        if (pages[pathname]) {
          const user = await currentUser(request);
          if (pathname === '/account' && !user) {
            response.writeHead(302, { Location: '/login' });
            return response.end();
          }
          if (pathname !== '/account' && user) {
            response.writeHead(302, { Location: '/account' });
            return response.end();
          }
          const html = await readFile(join(root, `pages/${pages[pathname]}.html`));
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return response.end(html);
        }
        const assets = { '/assets/app.css': ['app.css', 'text/css'], '/assets/app.js': ['app.js', 'text/javascript'] };
        if (assets[pathname]) {
          const [file, type] = assets[pathname];
          const content = await readFile(join(root, 'public', file));
          response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
          return response.end(content);
        }
        if (pathname === '/favicon.ico') {
          response.writeHead(204);
          return response.end();
        }
      }
      send(response, 404, { error: 'Page not found.' });
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name);
      if (!response.headersSent) send(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Try again.' });
      else response.end();
    }
  });
  server.ready = () => database.ready();
  server.on('close', () => Promise.resolve(database.close()).catch(() => console.error('Database shutdown failed.')));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`))) {
  const port = Number(process.env.PORT || 5180);
  const server = createApp();
  try {
    await server.ready();
    server.on('error', (error) => {
      console.error(`Cannot start server (${error.code}). Choose another PORT in .env.`);
      process.exit(1);
    });
    server.listen(port, '127.0.0.1', () => console.log(`Lepide is running at http://localhost:${port} (${process.env.DATABASE_URL ? 'Supabase PostgreSQL' : 'local SQLite'})`));
  } catch (error) {
    console.error(`Database connection failed (${error.code || error.name}). Check DATABASE_URL and run npm run db:setup.`);
    process.exit(1);
  }
}