import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/drizzle/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. See .env.local.example.');
}

// HTTP client — one-shot queries, no transactions. Use for service-role reads
// (cron, health checks, migrations-less scripts).
export const sql = neon(process.env.DATABASE_URL);
export const db = drizzleHttp(sql, { schema });

// Pooled client — supports transactions (required for RLS SET LOCAL).
// Use this for every request that needs withUserContext().
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => {
  console.error('[db] pooled connection error', err);
});
export const dbTx = drizzlePool(pool, { schema });

export { schema };
