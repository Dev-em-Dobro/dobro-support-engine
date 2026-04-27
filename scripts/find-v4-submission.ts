/**
 * Lista submissões que têm correção v4-2026-04 salva, pra comparação contra v5.
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

  const counts = await pool.query<{ prompt_version: string; count: string }>(
    `SELECT prompt_version, count(*)::text FROM corrections GROUP BY prompt_version ORDER BY prompt_version`
  );
  console.log('Distribuição de prompt_version no banco:');
  for (const r of counts.rows) {
    console.log(`  ${r.prompt_version}: ${r.count}`);
  }
  console.log('');

  const v4 = await pool.query<{
    id: string;
    github_url: string;
    grade: string;
    submitted_at: Date;
  }>(
    `SELECT s.id, s.github_url, c.grade, s.submitted_at
     FROM submissions s JOIN corrections c ON c.submission_id = s.id
     WHERE c.prompt_version = 'v4-2026-04'
     ORDER BY s.submitted_at DESC LIMIT 5`
  );
  console.log(`5 submissões mais recentes com v4-2026-04 salva:`);
  for (const r of v4.rows) {
    console.log(`  ${r.id}  nota ${r.grade}  ${r.github_url}  (${r.submitted_at.toISOString()})`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
