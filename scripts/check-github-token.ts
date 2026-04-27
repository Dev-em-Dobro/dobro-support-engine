/**
 * Diagnóstico de GitHub token: verifica se o token carrega do .env e bate
 * na API com auth funcionando.
 *
 * Uso: tsx scripts/check-github-token.ts
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

const envFile = existsSync(resolve(process.cwd(), '.env.local'))
  ? '.env.local'
  : '.env';
config({ path: envFile });

console.log(`Carregando env de: ${envFile}\n`);

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('✘ GITHUB_TOKEN não foi carregado do env.');
  process.exit(1);
}

console.log(`✔ GITHUB_TOKEN presente (${token.length} chars, começa com "${token.slice(0, 4)}")`);

// Trim whitespace check
if (token !== token.trim()) {
  console.error(`⚠ Token tem whitespace nas pontas! Original: "${token}", Trimado: "${token.trim()}"`);
}

// Call /rate_limit endpoint — does NOT count against rate limit
async function check(useAuth: boolean) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (useAuth) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('https://api.github.com/rate_limit', { headers });
  const data = await res.json();

  console.log(`\n--- ${useAuth ? 'COM' : 'SEM'} token ---`);
  console.log(`HTTP ${res.status}`);

  if (data.resources) {
    const core = data.resources.core;
    console.log(`Core API:`);
    console.log(`  limit:     ${core.limit}`);
    console.log(`  remaining: ${core.remaining}`);
    console.log(`  reset:     ${new Date(core.reset * 1000).toISOString()} (em ${Math.round((core.reset * 1000 - Date.now()) / 60000)} min)`);
  } else {
    console.log(`Resposta inesperada:`, JSON.stringify(data, null, 2).slice(0, 500));
  }

  return data;
}

async function main() {
  const withoutAuth = await check(false);
  const withAuth = await check(true);

  console.log('\n--- Veredito ---');
  if (!withAuth.resources) {
    console.log('✘ A chamada COM token não retornou dados de rate limit. Token pode ser inválido, expirado ou revogado.');
    console.log('   Resposta crua:', JSON.stringify(withAuth, null, 2).slice(0, 800));
    return;
  }
  const authLimit = withAuth.resources.core.limit;
  if (authLimit === 60) {
    console.log('✘ Limite COM token = 60. A API NÃO está autenticando. Causa provável: token inválido, expirado, ou sem o scope public_repo.');
  } else if (authLimit >= 5000) {
    console.log(`✔ Limite COM token = ${authLimit}. Autenticação funcionando — limite alto.`);
    console.log('  Se ainda dá erro de rate limit em produção:');
    console.log('  1. Vercel não tem GITHUB_TOKEN configurado (Settings → Environment Variables)');
    console.log('  2. Dev server local não foi reiniciado depois de adicionar o token');
    console.log('  3. Erro é de uma run anterior já cacheada no banco (status=failed)');
  } else {
    console.log(`⚠ Limite COM token = ${authLimit}. Inesperado — investigar manualmente.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
