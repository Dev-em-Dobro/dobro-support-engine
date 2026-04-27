/**
 * db-init — aplica migrations 0001_init.sql + 0002_rls.sql no DATABASE_URL atual.
 *
 * Uso: pnpm db:init
 *
 * Requer DATABASE_URL em .env.local. NÃO é idempotente — rode 1x em DB vazio.
 * Em reset, dropar o schema manualmente antes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

config({ path: '.env.local' });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida. Copie .env.local.example → .env.local e preencha.');
  process.exit(1);
}

if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const MIGRATIONS = ['drizzle/migrations/0001_init.sql', 'drizzle/migrations/0002_rls.sql'];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const path of MIGRATIONS) {
    const abs = resolve(process.cwd(), path);
    console.log(`→ aplicando ${path}`);
    const sql = readFileSync(abs, 'utf-8');
    await pool.query(sql);
    console.log(`✔ ${path}`);
  }
  await pool.end();
  console.log('\nMigrations aplicadas. Rode `pnpm drizzle:seed` em seguida (opcional).');
}

main().catch((err) => {
  console.error('Erro aplicando migrations:', err);
  process.exit(1);
});
