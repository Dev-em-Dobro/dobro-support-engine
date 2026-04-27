/**
 * Testa o pipeline completo (gerador + polisher) localmente, exatamente
 * como produção faz. Mostra contagem em cada etapa pra debug do "saída
 * com poucos items".
 *
 * Uso: tsx scripts/test-full-pipeline.ts <githubUrl> [iterações]
 *      tsx scripts/test-full-pipeline.ts https://github.com/cristian-souza/studio-ghibli-app 3
 *
 * Roda N iterações pra ver variância. Default: 1.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const envFile = existsSync(resolve(process.cwd(), '.env.local'))
  ? '.env.local'
  : '.env';
config({ path: envFile });

async function main() {
  const githubUrl = process.argv[2];
  const iterations = parseInt(process.argv[3] || '1', 10);

  if (!githubUrl) {
    console.error('Uso: tsx scripts/test-full-pipeline.ts <githubUrl> [iterações]');
    process.exit(1);
  }

  const { generateCorrectionViaAI } = await import('../lib/ai-correction');
  const { polishCorrection } = await import('../lib/ai-reviewer');

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n=== Iteração ${i}/${iterations} ===\n`);

    // Step 1: Generator
    console.log('[1/2] Rodando gerador...');
    const t0 = Date.now();
    const generated = await generateCorrectionViaAI({ githubUrl, deployedUrl: null });
    const genMs = Date.now() - t0;
    console.log(`      ✔ Gerador: ${(genMs / 1000).toFixed(1)}s`);
    console.log(`      Tokens: ${generated.usage.tokensIn} in / ${generated.usage.tokensOut} out`);
    console.log(`      Cost: $${generated.usage.costUsd.toFixed(6)}`);
    console.log(`      Grade: ${generated.correction.grade}`);
    console.log(`      Improvements: ${generated.correction.improvements.length}`);
    console.log(`      Strengths: ${generated.correction.strengths.length}`);

    if (generated.correction.improvements.length > 0) {
      console.log('\n      Improvements (gerador):');
      generated.correction.improvements.forEach((imp, idx) => {
        console.log(
          `      ${idx + 1}. [${imp.severity}] ${imp.area}${imp.file ? ` — ${imp.file}` : ''}`
        );
      });
    }

    // Step 2: Polisher
    console.log('\n[2/2] Rodando polisher...');
    const t1 = Date.now();
    const polished = await polishCorrection(generated.correction, {
      githubUrl,
      studentEmail: 'test@dobro-support',
    });
    const polMs = Date.now() - t1;
    console.log(`      ✔ Polisher: ${(polMs / 1000).toFixed(1)}s`);
    console.log(`      Tokens: ${polished.usage.tokensIn} in / ${polished.usage.tokensOut} out`);
    console.log(`      Cost: $${polished.usage.costUsd.toFixed(6)}`);
    console.log(`      Fallback: ${polished.fallback}`);
    console.log(`      Score: ${polished.score}`);
    console.log(`      Grade: ${polished.polished.grade}`);
    console.log(`      Improvements: ${polished.polished.improvements.length}`);
    console.log(`      Strengths: ${polished.polished.strengths.length}`);

    if (polished.polished.improvements.length > 0) {
      console.log('\n      Improvements (polished):');
      polished.polished.improvements.forEach((imp, idx) => {
        console.log(
          `      ${idx + 1}. [${imp.severity}] ${imp.area}${imp.file ? ` — ${imp.file}` : ''}`
        );
      });
    }

    if (polished.changes.length > 0) {
      console.log('\n      Changes feitas pelo polisher:');
      polished.changes.forEach((c) => console.log(`      - ${c}`));
    }

    // Diagnostic
    const delta = polished.polished.improvements.length - generated.correction.improvements.length;
    console.log(`\n      DELTA polisher: ${delta >= 0 ? '+' : ''}${delta} (gerador → polished)`);
    if (delta < 0) {
      console.log(`      ⚠ Polisher REMOVEU ${Math.abs(delta)} improvement(s).`);
    }
  }
}

main().catch((err) => {
  console.error('\n✘ Erro:', err);
  process.exit(1);
});
