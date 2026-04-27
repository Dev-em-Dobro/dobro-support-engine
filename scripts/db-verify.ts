/**
 * db-verify — confirma que as migrations recentes (0003+0004) foram aplicadas.
 * Descartável; útil pra sanity check após pnpm db:migrate.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const envFile = existsSync(resolve(process.cwd(), '.env.local')) ? '.env.local' : '.env';
config({ path: envFile });

if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const checks = [
    {
      name: 'submissions.course_version',
      sql: `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='submissions' AND column_name='course_version'`,
    },
    {
      name: 'submissions_course_version_chk',
      sql: `SELECT conname FROM pg_constraint WHERE conname='submissions_course_version_chk'`,
    },
    {
      name: 'submissions_course_version_idx',
      sql: `SELECT indexname FROM pg_indexes WHERE indexname='submissions_course_version_idx'`,
    },
    {
      name: 'corrections.tokens_in / tokens_out / cost_usd',
      sql: `SELECT column_name FROM information_schema.columns WHERE table_name='corrections' AND column_name IN ('tokens_in','tokens_out','cost_usd') ORDER BY column_name`,
    },
    {
      name: 'corrections_created_cost_idx',
      sql: `SELECT indexname FROM pg_indexes WHERE indexname='corrections_created_cost_idx'`,
    },
    {
      name: 'submissions sample (course_version distribuição)',
      sql: `SELECT course_version, count(*) FROM submissions GROUP BY course_version ORDER BY course_version`,
    },
  ];

  for (const check of checks) {
    const result = await pool.query(check.sql);
    console.log(`\n[${check.name}]`);
    if (result.rows.length === 0) {
      console.log('  ✘ nada encontrado');
    } else {
      result.rows.forEach((r) => console.log(`  ✔ ${JSON.stringify(r)}`));
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
