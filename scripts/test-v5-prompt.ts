/**
 * test-v5-prompt — gera uma correção fresca com a v5 numa submissão recente
 * (uma que já tem v4 salva no banco) e cospe um arquivo markdown com as
 * duas saídas lado a lado pra comparação visual.
 *
 * Uso:
 *   tsx scripts/test-v5-prompt.ts             # pega a submissão mais recente com correção salva
 *   tsx scripts/test-v5-prompt.ts <id>        # roda numa submissão específica
 *
 * Saída: docs/qa/v5-comparison-<timestamp>.md
 *
 * Custo estimado: ~$0.01 por run (gpt-4o-mini, ~60k tokens in / 4k out).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const envFile = existsSync(resolve(process.cwd(), '.env.local')) ? '.env.local' : '.env';
config({ path: envFile });

if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

interface SubmissionRow {
  id: string;
  github_url: string;
  deployed_url: string | null;
  student_email: string;
  submitted_at: Date;
  course_version: string;
}

interface CorrectionRow {
  grade: string;
  strengths: string[];
  improvements: Array<{
    area: string;
    severity: 'low' | 'medium' | 'high';
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
}

async function main() {
  const submissionIdArg = process.argv[2];
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const subQuery = submissionIdArg
    ? {
        text: `SELECT s.id, s.github_url, s.deployed_url, s.student_email,
                      s.submitted_at, s.course_version
               FROM submissions s WHERE s.id = $1`,
        values: [submissionIdArg],
      }
    : {
        text: `SELECT s.id, s.github_url, s.deployed_url, s.student_email,
                      s.submitted_at, s.course_version
               FROM submissions s
               JOIN corrections c ON c.submission_id = s.id
               ORDER BY s.submitted_at DESC LIMIT 1`,
        values: [],
      };

  const subRes = await pool.query<SubmissionRow>(subQuery.text, subQuery.values);
  if (subRes.rows.length === 0) {
    console.error('Nenhuma submissão encontrada com correção salva.');
    process.exit(1);
  }

  const sub = subRes.rows[0];
  console.log(`[1/3] Submissão escolhida: ${sub.id}`);
  console.log(`      github: ${sub.github_url}`);
  console.log(`      deploy: ${sub.deployed_url || '(none)'}`);
  console.log(`      aluno:  ${sub.student_email}`);
  console.log(`      data:   ${sub.submitted_at.toISOString()}`);
  console.log(`      versão do curso: ${sub.course_version}`);

  const corrRes = await pool.query<CorrectionRow>(
    `SELECT grade, strengths, improvements, narrative_md, model, prompt_version,
            tokens_in, tokens_out, cost_usd, created_at
     FROM corrections WHERE submission_id = $1`,
    [sub.id]
  );
  const existing = corrRes.rows[0] || null;
  console.log(
    `[2/3] Correção existente: ${existing ? `${existing.prompt_version} (nota ${existing.grade})` : '(nenhuma salva)'}`
  );

  console.log(`[3/3] Gerando correção v5 (chamada OpenAI, ~30-60s)...`);
  const { generateCorrectionViaAI } = await import('../lib/ai-correction');
  const t0 = Date.now();
  const result = await generateCorrectionViaAI({
    githubUrl: sub.github_url,
    deployedUrl: sub.deployed_url,
  });
  const elapsedMs = Date.now() - t0;
  console.log(`      Pronto em ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(
    `      Tokens: ${result.usage.tokensIn} in / ${result.usage.tokensOut} out — custo $${result.usage.costUsd.toFixed(6)}`
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(process.cwd(), 'docs/qa');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `v5-comparison-${stamp}.md`);

  const md = renderComparisonMd({
    submission: sub,
    existing,
    v5: result.correction,
    v5Meta: {
      model: result.model,
      promptVersion: result.promptVersion,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut,
      costUsd: result.usage.costUsd,
      elapsedMs,
    },
  });

  writeFileSync(outPath, md);
  console.log(`\n✔ Comparação escrita em: ${outPath}`);

  await pool.end();
}

interface RenderArgs {
  submission: SubmissionRow;
  existing: CorrectionRow | null;
  v5: {
    grade: number;
    strengths: string[];
    improvements: CorrectionRow['improvements'];
    narrativeMd: string;
  };
  v5Meta: {
    model: string;
    promptVersion: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    elapsedMs: number;
  };
}

function renderComparisonMd(args: RenderArgs): string {
  const { submission, existing, v5, v5Meta } = args;
  const out: string[] = [];

  out.push(`# Comparação v4 → v5 — submissão \`${submission.id}\``);
  out.push('');
  out.push(`- **GitHub:** ${submission.github_url}`);
  out.push(`- **Deploy:** ${submission.deployed_url || '(none)'}`);
  out.push(`- **Aluno:** ${submission.student_email}`);
  out.push(`- **Submetido em:** ${submission.submitted_at.toISOString()}`);
  out.push(`- **Versão do curso:** ${submission.course_version}`);
  out.push('');

  out.push(`## 🆕 v5 (recém-gerada)`);
  out.push('');
  out.push(`| Campo | Valor |`);
  out.push(`|---|---|`);
  out.push(`| Model | \`${v5Meta.model}\` |`);
  out.push(`| Prompt version | \`${v5Meta.promptVersion}\` |`);
  out.push(`| Tempo | ${(v5Meta.elapsedMs / 1000).toFixed(1)}s |`);
  out.push(`| Tokens | ${v5Meta.tokensIn} in / ${v5Meta.tokensOut} out |`);
  out.push(`| Custo | $${v5Meta.costUsd.toFixed(6)} |`);
  out.push(`| Nota | **${v5.grade}/10** |`);
  out.push(`| # Improvements | ${v5.improvements.length} |`);
  out.push(`| # Pontos fortes | ${v5.strengths.length} |`);
  out.push('');

  out.push(`### Improvements`);
  out.push('');
  for (const [i, imp] of v5.improvements.entries()) {
    out.push(`#### ${i + 1}. \`[${imp.severity}]\` ${imp.area}`);
    out.push('');
    out.push(imp.suggestion);
    out.push('');
    if (imp.file) {
      const range = imp.lineEnd ? `${imp.lineStart}-${imp.lineEnd}` : `${imp.lineStart}`;
      out.push(`📍 \`${imp.file}:${range}\``);
      out.push('');
    }
    if (imp.codeSnippet) {
      out.push('**Trecho citado:**');
      out.push('');
      out.push('```');
      out.push(imp.codeSnippet);
      out.push('```');
      out.push('');
    }
    if (imp.proposedFix) {
      out.push('**Como ficaria:**');
      out.push('');
      out.push(imp.proposedFix);
      out.push('');
    }
  }

  out.push(`### Pontos fortes`);
  out.push('');
  for (const s of v5.strengths) {
    out.push(`- ${s}`);
  }
  out.push('');

  out.push(`### Narrativa`);
  out.push('');
  out.push(v5.narrativeMd);
  out.push('');

  if (existing) {
    out.push('---');
    out.push('');
    out.push(`## 📜 v4 (já estava salva no banco)`);
    out.push('');
    out.push(`| Campo | Valor |`);
    out.push(`|---|---|`);
    out.push(`| Model | \`${existing.model}\` |`);
    out.push(`| Prompt version | \`${existing.prompt_version}\` |`);
    out.push(`| Tokens | ${existing.tokens_in} in / ${existing.tokens_out} out |`);
    out.push(`| Custo | $${parseFloat(existing.cost_usd).toFixed(6)} |`);
    out.push(`| Nota | **${existing.grade}/10** |`);
    out.push(`| # Improvements | ${existing.improvements.length} |`);
    out.push(`| # Pontos fortes | ${existing.strengths.length} |`);
    out.push(`| Gerada em | ${existing.created_at.toISOString()} |`);
    out.push('');

    out.push(`### Improvements`);
    out.push('');
    for (const [i, imp] of existing.improvements.entries()) {
      out.push(`#### ${i + 1}. \`[${imp.severity}]\` ${imp.area}`);
      out.push('');
      out.push(imp.suggestion);
      out.push('');
      if (imp.file) {
        const range = imp.lineEnd ? `${imp.lineStart}-${imp.lineEnd}` : `${imp.lineStart}`;
        out.push(`📍 \`${imp.file}:${range}\``);
        out.push('');
      }
      if (imp.codeSnippet) {
        out.push('**Trecho citado:**');
        out.push('');
        out.push('```');
        out.push(imp.codeSnippet);
        out.push('```');
        out.push('');
      }
      if (imp.proposedFix) {
        out.push('**Como ficaria:**');
        out.push('');
        out.push(imp.proposedFix);
        out.push('');
      }
    }

    out.push(`### Pontos fortes`);
    out.push('');
    for (const s of existing.strengths) {
      out.push(`- ${s}`);
    }
    out.push('');

    out.push(`### Narrativa`);
    out.push('');
    out.push(existing.narrative_md);
    out.push('');
  } else {
    out.push('---');
    out.push('');
    out.push('_Nenhuma correção v4 salva pra essa submissão — comparação só tem o lado v5._');
  }

  return out.join('\n');
}

main().catch((err) => {
  console.error('\n✘ Erro:');
  console.error(err);
  process.exit(1);
});
