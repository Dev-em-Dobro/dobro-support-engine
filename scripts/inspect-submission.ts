/**
 * Mostra detalhes completos de uma submissão e sua correção pra debug.
 * Uso: tsx scripts/inspect-submission.ts <submissionId>
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const envFile = existsSync(resolve(process.cwd(), '.env.local'))
  ? '.env.local'
  : '.env';
config({ path: envFile });

if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Falta o submissionId. Uso: tsx scripts/inspect-submission.ts <id>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const sub = await pool.query<{
    id: string;
    student_email: string;
    github_url: string;
    deployed_url: string | null;
    submitted_at: Date;
    corrected_at: Date | null;
    status: string;
    course_version: string;
    error_msg: string | null;
  }>(
    `SELECT id, student_email, github_url, deployed_url, submitted_at,
            corrected_at, status, course_version, error_msg
     FROM submissions WHERE id = $1`,
    [id]
  );

  if (sub.rows.length === 0) {
    console.error(`Submissão ${id} não encontrada.`);
    process.exit(1);
  }

  const s = sub.rows[0];
  console.log('=== SUBMISSION ===');
  console.log(`id:              ${s.id}`);
  console.log(`student:         ${s.student_email}`);
  console.log(`github:          ${s.github_url}`);
  console.log(`deploy:          ${s.deployed_url || '(none)'}`);
  console.log(`status:          ${s.status}`);
  console.log(`course version:  ${s.course_version}`);
  console.log(`submitted:       ${s.submitted_at.toISOString()}`);
  console.log(`corrected:       ${s.corrected_at?.toISOString() || '(not yet)'}`);
  console.log(`error_msg:       ${s.error_msg || '(none)'}`);

  const corr = await pool.query<{
    grade: string;
    strengths: string[];
    improvements: Array<{
      area: string;
      severity: string;
      suggestion: string;
      file?: string;
      lineStart?: number;
      lineEnd?: number;
      codeSnippet?: string;
      proposedFix?: string;
    }>;
    narrative_md: string;
    model: string;
    prompt_version: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT grade, strengths, improvements, narrative_md, model, prompt_version,
            tokens_in, tokens_out, cost_usd, created_at, updated_at
     FROM corrections WHERE submission_id = $1`,
    [id]
  );

  if (corr.rows.length === 0) {
    console.log('\n(sem correção salva)');
    await pool.end();
    return;
  }

  const c = corr.rows[0];
  console.log('\n=== CORRECTION ===');
  console.log(`grade:           ${c.grade}`);
  console.log(`model:           ${c.model}`);
  console.log(`prompt_version:  ${c.prompt_version}`);
  console.log(`tokens:          ${c.tokens_in} in / ${c.tokens_out} out`);
  console.log(`cost:            $${parseFloat(c.cost_usd).toFixed(6)}`);
  console.log(`created:         ${c.created_at.toISOString()}`);
  console.log(`updated:         ${c.updated_at.toISOString()}`);
  console.log(`# improvements:  ${c.improvements.length}`);
  console.log(`# strengths:     ${c.strengths.length}`);

  console.log('\n=== IMPROVEMENTS (resumo) ===');
  c.improvements.forEach((imp, i) => {
    const fileRef = imp.file
      ? ` ${imp.file}${imp.lineStart ? `:${imp.lineStart}${imp.lineEnd ? `-${imp.lineEnd}` : ''}` : ''}`
      : '';
    console.log(`${i + 1}. [${imp.severity}] ${imp.area}${fileRef}`);
    console.log(`   ${imp.suggestion.slice(0, 120)}${imp.suggestion.length > 120 ? '...' : ''}`);
  });

  console.log('\n=== STRENGTHS ===');
  c.strengths.forEach((str, i) => {
    console.log(`${i + 1}. ${str.slice(0, 120)}${str.length > 120 ? '...' : ''}`);
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
