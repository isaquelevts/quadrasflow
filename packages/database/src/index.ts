import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
export * from './schema.js';

const databaseUrl = process.env.DATABASE_URL;

export function createDatabase(url = databaseUrl) {
  if (!url) throw new Error('DATABASE_URL is required.');
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
  });
  return { client, db: drizzle(client) };
}
