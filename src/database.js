import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export function postgresOptions(connectionString, environment = process.env) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
  const skipVerification = environment.DATABASE_TLS_SKIP_VERIFY === 'true';
  if (skipVerification && environment.NODE_ENV === 'production') throw new Error('Database certificate bypass is forbidden in production.');
  if (skipVerification) console.warn('WARNING: Database TLS certificate verification is disabled for local development.');
  for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(parameter);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: !skipVerification }, max: 5, connectionTimeoutMillis: 10000 };
}

export function createDatabase({ databasePath, connectionString }) {
  if (connectionString) {
    const pool = new pg.Pool(postgresOptions(connectionString));
    pool.on('error', () => console.error('An idle PostgreSQL connection failed. Check database availability.'));
    function prepare(sql) {
      let parameter = 0;
      let statement = sql.replace(/\?/g, () => `$${++parameter}`).replace(/\busers\b/g, 'public.app_users').replace(/\bsessions\b/g, 'public.app_sessions');
      const createsUser = /^INSERT INTO public\.app_users\b/.test(statement);
      if (createsUser) statement += ' RETURNING id';
      function values(parameters) {
        const result = [...parameters];
        if (sql.includes('sessions.expires_at >') || sql.startsWith('DELETE FROM sessions WHERE expires_at') || sql.startsWith('INSERT INTO sessions')) {
          result[result.length - 1] = new Date(result[result.length - 1]);
        }
        return result;
      }
      return {
        async get(...parameters) { return (await pool.query(statement, values(parameters))).rows[0]; },
        async run(...parameters) {
          const result = await pool.query(statement, values(parameters));
          return { lastInsertRowid: createsUser ? result.rows[0].id : undefined };
        }
      };
    }
    return { prepare, close: () => pool.end(), ready: async () => {
      await pool.query('SELECT id, name, email, salt, password_hash, created_at FROM public.app_users LIMIT 0');
      await pool.query('SELECT token_hash, user_id, expires_at FROM public.app_sessions LIMIT 0');
    } };
  }
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
  `);
  return { prepare: (sql) => database.prepare(sql), close: () => database.close(), ready: async () => {} };
}