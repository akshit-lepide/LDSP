import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { postgresOptions } from '../src/database.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL in .env using Supabase > Connect > Session pooler, then run npm run db:setup again.');
  process.exitCode = 1;
} else {
  let client;
  try {
    client = new pg.Client(postgresOptions(process.env.DATABASE_URL));
    await client.connect();
    await client.query(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    console.log('Supabase tables are ready: app_users and app_sessions. Supabase Auth is not used.');
  } catch (error) {
    console.error(`Database setup failed (${error.code || error.name}). Verify the connection string, database password, network access and TLS certificate trust.`);
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}