/**
 * test-correction-by-url — roda o pipeline IA real (generator + polisher)
 * contra uma URL de GitHub, sem mexer no banco. Útil pra dry-run antes de
 * resubmeter em produção.
 *
 * Uso:
 *   npx tsx scripts/test-correction-by-url.ts <githubUrl> [deployedUrl]
 *
 * Saída: docs/qa/dryrun-<timestamp>.md + resumo no console.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const envFile = existsSync(resolve(process.cwd(), '.env.local')) ? '.env.local' : '.env';
config({ path: envFile });

async function main() {
  const githubUrl = process.argv[2];
  const deployedUrl = process.argv[3] ?? null;
  if (!githubUrl) {
    console.error('uso: npx tsx scripts/test-correction-by-url.ts <githubUrl> [deployedUrl]');
    process.exit(1);
  }

  console.log(`URL:    ${githubUrl}`);
  console.log(`Deploy: ${deployedUrl ?? '(none)'}`);
  console.log(`Token GitHub: ${process.env.GITHUB_TOKEN ? 'sim' : 'NÃO (vai bater rate-limit)'}`);
  console.log(`Token OpenAI: ${process.env.OPENAI_API_KEY ? 'sim' : 'AUSENTE — vai falhar'}`);
  console.log('');

  const { generateCorrectionViaAI } = await import('../lib/ai-correction');
  const { polishCorrection } = await import('../lib/ai-reviewer');

  console.log('[1/2] Gerando correção (fetch GitHub + OpenAI)...');
  const tGen0 = Date.now();
  const gen = await generateCorrectionViaAI({ githubUrl, deployedUrl });
  const tGen = Date.now() - tGen0;
  console.log(
    `      OK em ${(tGen / 1000).toFixed(1)}s — ${gen.usage.tokensIn} in / ${gen.usage.tokensOut} out — $${gen.usage.costUsd.toFixed(6)}`
  );

  console.log('[2/2] Polindo (OpenAI 2nd pass, fallback se falhar)...');
  const tPol0 = Date.now();
  const pol = await polishCorrection(gen.correction, {
    githubUrl,
    studentEmail: 'dryrun@dobro-support',
  });
  const tPol = Date.now() - tPol0;
  console.log(
    `      ${pol.fallback ? 'FALLBACK' : 'OK'} em ${(tPol / 1000).toFixed(1)}s — ${pol.usage.tokensIn} in / ${pol.usage.tokensOut} out — $${pol.usage.costUsd.toFixed(6)}`
  );

  const total = pol.polished;
  const bySev = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const i of total.improvements) bySev[i.severity] = (bySev[i.severity] ?? 0) + 1;

  console.log('');
  console.log('=== RESULTADO ===');
  console.log(`Tempo total: ${((tGen + tPol) / 1000).toFixed(1)}s`);
  console.log(`Custo total: $${(gen.usage.costUsd + pol.usage.costUsd).toFixed(6)}`);
  console.log(`Nota:        ${total.grade}/10`);
  console.log(`Strengths:   ${total.strengths.length}`);
  console.log(
    `Improvements: ${total.improvements.length} (high=${bySev.high}, medium=${bySev.medium}, low=${bySev.low})`
  );
  console.log(`Polish changes: ${pol.changes.length}${pol.fallback ? ' (FALLBACK)' : ''}`);
  console.log('');
  console.log('Improvements (resumo):');
  total.improvements.forEach((imp, i) => {
    const ref = imp.file
      ? ` ${imp.file}${imp.lineStart ? `:${imp.lineStart}${imp.lineEnd ? `-${imp.lineEnd}` : ''}` : ''}`
      : '';
    console.log(`  ${i + 1}. [${imp.severity}] ${imp.area}${ref}`);
    console.log(`     ${imp.suggestion.slice(0, 140).replace(/\n/g, ' ')}${imp.suggestion.length > 140 ? '…' : ''}`);
  });

  // Markdown completo
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = resolve(process.cwd(), 'docs/qa');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `dryrun-${stamp}.md`);

  const lines: string[] = [];
  lines.push(`# Dry-run — \`${githubUrl}\``);
  lines.push('');
  lines.push(`- **Tempo:** generator ${(tGen / 1000).toFixed(1)}s + polisher ${(tPol / 1000).toFixed(1)}s = **${((tGen + tPol) / 1000).toFixed(1)}s**`);
  lines.push(`- **Custo:** $${(gen.usage.costUsd + pol.usage.costUsd).toFixed(6)}`);
  lines.push(`- **Nota:** ${total.grade}/10`);
  lines.push(`- **Improvements:** ${total.improvements.length} (high=${bySev.high}, medium=${bySev.medium}, low=${bySev.low})`);
  lines.push(`- **Polish:** ${pol.fallback ? 'FALLBACK (raw mantido)' : `${pol.changes.length} mudanças`}`);
  lines.push('');
  lines.push('## Improvements');
  lines.push('');
  for (const [i, imp] of total.improvements.entries()) {
    lines.push(`### ${i + 1}. \`[${imp.severity}]\` ${imp.area}`);
    lines.push('');
    lines.push(imp.suggestion);
    lines.push('');
    if (imp.file) {
      const range = imp.lineEnd ? `${imp.lineStart}-${imp.lineEnd}` : `${imp.lineStart}`;
      lines.push(`📍 \`${imp.file}:${range}\``);
      lines.push('');
    }
    if (imp.codeSnippet) {
      lines.push('**Trecho:**', '', '```', imp.codeSnippet, '```', '');
    }
    if (imp.proposedFix) {
      lines.push('**Como ficaria:**', '', imp.proposedFix, '');
    }
  }
  lines.push('## Pontos fortes', '');
  for (const s of total.strengths) lines.push(`- ${s}`);
  lines.push('', '## Narrativa', '', total.narrativeMd, '');

  writeFileSync(outPath, lines.join('\n'));
  console.log('');
  console.log(`Markdown completo em: ${outPath}`);
}

main().catch((err) => {
  console.error('\n✘ Erro:');
  console.error(err);
  process.exit(1);
});
