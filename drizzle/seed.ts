/**
 * Dobro Support — Seed data for local development
 *
 * Usage:
 *   pnpm tsx dobro-support/drizzle/seed.ts
 *
 * Idempotent: safe to run multiple times. Uses ON CONFLICT DO NOTHING semantics.
 *
 * NOTE: Seed runs with service-role session (RLS bypass) so it can insert
 * across students without switching contexts.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { createHash } from 'node:crypto';
import { hashPassword } from '../lib/password';

// Credenciais de DEV pra exercitar login de vendedor e gestor localmente.
// Tudo vem do .env.local (SEED_DEV_*) — nada hardcoded. Se as variáveis não
// estiverem definidas, a criação é pulada. NUNCA roda em produção (guard
// abaixo). Pra prod, use scripts/add-sales-user.ts e scripts/add-monitor.ts
// com senha forte e única.
async function seedDevUsers() {
  if (process.env.NODE_ENV === 'production') {
    console.log('⏭️  Pulando usuários de DEV (NODE_ENV=production).');
    return;
  }

  const gestorEmail = process.env.SEED_DEV_GESTOR_EMAIL?.toLowerCase().trim();
  const vendedorEmail = process.env.SEED_DEV_VENDEDOR_EMAIL?.toLowerCase().trim();
  // SEED_DEV_PASSWORD é a senha base (compartilhada). Cada papel pode ter a sua
  // própria via SEED_DEV_GESTOR_PASSWORD / SEED_DEV_VENDEDOR_PASSWORD.
  const basePassword = process.env.SEED_DEV_PASSWORD;
  const gestorPassword = process.env.SEED_DEV_GESTOR_PASSWORD ?? basePassword;
  const vendedorPassword = process.env.SEED_DEV_VENDEDOR_PASSWORD ?? basePassword;

  if (!gestorEmail || !vendedorEmail || !gestorPassword || !vendedorPassword) {
    console.log(
      '⏭️  Pulando usuários de DEV: defina SEED_DEV_GESTOR_EMAIL, ' +
        'SEED_DEV_VENDEDOR_EMAIL e SEED_DEV_PASSWORD no .env.local.'
    );
    return;
  }

  // Gestor de vendas == role 'monitor' (mesma conta que controla o agente).
  // Login dev em /gestor-vendas/login.
  const gestorHash = await hashPassword(gestorPassword);
  await db
    .insert(schema.monitorUsers)
    .values({ email: gestorEmail, passwordHash: gestorHash })
    .onConflictDoUpdate({ target: schema.monitorUsers.email, set: { passwordHash: gestorHash } });

  // Vendedor (role 'sales'). Login dev em /vendas/login.
  const vendedorHash = await hashPassword(vendedorPassword);
  await db
    .insert(schema.salesUsers)
    .values({ email: vendedorEmail, passwordHash: vendedorHash })
    .onConflictDoUpdate({ target: schema.salesUsers.email, set: { passwordHash: vendedorHash } });

  console.log('👤 Usuários DEV prontos:');
  console.log(`   • Gestor   → ${gestorEmail}   (/gestor-vendas/login)`);
  console.log(`   • Vendedor → ${vendedorEmail}  (/vendas/login)`);
}

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const DATABASE_URL = assertEnv('DATABASE_URL');
const client = neon(DATABASE_URL);
const db = drizzle(client, { schema });

async function seed() {
  // Set service role for RLS bypass
  await client`SELECT set_config('app.user_role', 'service', true)`;

  console.log('🌱 Seeding dobro-support...');

  await seedDevUsers();

  // ---------- Sample submissions (1 per status to exercise UI) ----------
  const aliceEmail = 'aluno.alice@devemdobro.dev';
  const bobEmail = 'aluno.bob@devemdobro.dev';

  const [pendingAuth, queued, draft, approved, delivered] = await db
    .insert(schema.submissions)
    .values([
      {
        studentEmail: aliceEmail,
        githubUrl: 'https://github.com/alice-dev/desafio-landing-restaurante',
        status: 'pending_auth',
      },
      {
        studentEmail: aliceEmail,
        githubUrl: 'https://github.com/alice-dev/desafio-tela-login',
        deployedUrl: 'https://alice-tela-login.vercel.app',
        status: 'queued',
      },
      {
        studentEmail: bobEmail,
        githubUrl: 'https://github.com/bob-dev/desafio-portfolio',
        deployedUrl: 'https://bob-portfolio.vercel.app',
        status: 'draft',
      },
      {
        studentEmail: bobEmail,
        githubUrl: 'https://github.com/bob-dev/desafio-todo-app',
        deployedUrl: 'https://bob-todo.vercel.app',
        status: 'approved',
        correctedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        studentEmail: aliceEmail,
        githubUrl: 'https://github.com/alice-dev/desafio-blog',
        deployedUrl: 'https://alice-blog.vercel.app',
        status: 'delivered',
        correctedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        deliveredAt: new Date(Date.now() - 47 * 60 * 60 * 1000),
      },
    ])
    .onConflictDoNothing()
    .returning();

  // ---------- Correction for draft + approved + delivered ----------
  if (draft) {
    await db
      .insert(schema.corrections)
      .values({
        submissionId: draft.id,
        grade: '7.5',
        strengths: [
          'Estrutura HTML semântica',
          'CSS usando variáveis e responsividade no mobile',
        ],
        improvements: [
          {
            area: 'acessibilidade',
            severity: 'high',
            suggestion:
              'As imagens do portfolio não têm atributo alt. Pra quem usa leitor de tela, esse bloco vira um buraco — adiciona um alt descrevendo cada projeto.',
            file: 'index.html',
            lineStart: 42,
            lineEnd: 45,
            codeSnippet:
              '<div class="card">\n  <img src="projeto-1.png">\n  <h3>Projeto 1</h3>\n</div>',
            proposedFix:
              '```html\n<div class="card">\n  <img src="projeto-1.png" alt="Landing page de restaurante com menu interativo">\n  <h3>Projeto 1</h3>\n</div>\n```',
          },
          {
            area: 'design',
            severity: 'medium',
            suggestion:
              'O contraste do texto cinza sobre fundo branco tá abaixo do WCAG AA. Escurece pra #555 (ou mais) e já resolve.',
            file: 'style.css',
            lineStart: 28,
            codeSnippet: 'p { color: #999; }',
            proposedFix: '```css\np { color: #555; }\n```',
          },
        ],
        narrativeMd:
          'Mano, curtimos muito como você estruturou o portfolio! Semântica tá em ponto de bala e o mobile ficou levinho. Os ajustes abaixo são mais sobre polimento e acessibilidade — nada que derrube o trabalho, mas que deixa ele pronto pra ir pro portfolio profissional. Segue firme, tá no caminho. Abraço.',
        model: 'claude-opus-4-7',
        promptVersion: 'v1.0.0',
      })
      .onConflictDoNothing();
  }

  // ---------- Sample auth_event for audit trail ----------
  await db
    .insert(schema.authEvents)
    .values({
      eventType: 'magic_link_issued',
      emailHash: createHash('sha256').update(aliceEmail.toLowerCase()).digest('hex'),
      ip: '127.0.0.1',
      userAgent: 'seed-script',
    })
    .onConflictDoNothing();

  console.log('✅ Seeded. Summary:');
  const counts = await db.execute(sql`
    SELECT 'submissions' AS t, count(*) FROM submissions UNION ALL
    SELECT 'corrections',       count(*) FROM corrections UNION ALL
    SELECT 'auth_events',       count(*) FROM auth_events
  `);
  console.table(counts.rows);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
