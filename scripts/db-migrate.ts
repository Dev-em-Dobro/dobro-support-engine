/**
 * db-migrate — aplica migrations idempotentes (0003+) no DATABASE_URL atual.
 *
 * Diferente do db-init (que assume DB vazio e roda 0001+0002), este script
 * pode ser rodado múltiplas vezes com segurança porque cada migration usa
 * `IF NOT EXISTS` em colunas, índices e constraints.
 *
 * Uso:
 *   pnpm db:migrate             → aplica todas as MIGRATIONS abaixo
 *   pnpm db:migrate 0003        → aplica só a 0003
 *
 * Lê .env.local primeiro (se existir), senão .env. DATABASE_URL é obrigatório.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

// Carrega .env.local se existir, senão .env
const envFile = existsSync(resolve(process.cwd(), '.env.local')) ? '.env.local' : '.env';
config({ path: envFile });

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL não definida em ${envFile}.`);
  process.exit(1);
}

if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

// Migrations idempotentes — adicionar novas aqui em ordem cronológica.
const MIGRATIONS = [
  'drizzle/migrations/0003_course_version.sql',
  'drizzle/migrations/0004_correction_costs.sql',
];

async function main() {
  // Filtro opcional via argv: pnpm db:migrate 0003
  const filter = process.argv[2];
  const toRun = filter
    ? MIGRATIONS.filter((m) => m.includes(filter))
    : MIGRATIONS;

  if (toRun.length === 0) {
    console.error(`Nenhuma migration corresponde a "${filter}".`);
    process.exit(1);
  }

  // Mostra qual host antes de rodar — defesa contra rodar em prod por engano
  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? 'desconhecido';
  console.log(`Conectando em: ${host}`);
  console.log(`Aplicando ${toRun.length} migration(s) (idempotente):\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const path of toRun) {
    const abs = resolve(process.cwd(), path);
    const sql = readFileSync(abs, 'utf-8');
    process.stdout.write(`→ ${path} ... `);
    try {
      await pool.query(sql);
      console.log('✔');
    } catch (err) {
      console.log('✘');
      console.error(`\n[erro em ${path}]`);
      console.error(err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    }
  }
  await pool.end();
  console.log('\n✓ Migrations aplicadas com sucesso.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
