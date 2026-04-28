/**
 * add-monitor — bootstrap / rotação de credenciais de monitor.
 *
 * Substitui o antigo MONITOR_EMAILS + MONITOR_PASSWORD do env. Cada monitor
 * agora tem credencial própria armazenada em monitor_users com hash scrypt.
 *
 * Uso:
 *   npm run monitor:add -- --email=carlos@devemdobro.com --password='senhaForte123'
 *
 *   # Desativar (sem deletar — preserva audit em monitor_actions):
 *   npm run monitor:add -- --email=carlos@devemdobro.com --deactivate
 *
 *   # Reativar:
 *   npm run monitor:add -- --email=carlos@devemdobro.com --activate
 *
 * Re-rodar com mesmo email + nova senha → atualiza o hash (rotação).
 *
 * Lê .env.local primeiro (se existir), senão .env. DATABASE_URL é obrigatório.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { hashPassword } from '../lib/password';

const envFile = existsSync(resolve(process.cwd(), '.env.local')) ? '.env.local' : '.env';
config({ path: envFile });

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL não definida em ${envFile}.`);
  process.exit(1);
}

if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

interface Args {
  email?: string;
  password?: string;
  deactivate?: boolean;
  activate?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const arg of argv.slice(2)) {
    const [k, ...rest] = arg.replace(/^--/, '').split('=');
    const v = rest.join('=');
    if (k === 'email') out.email = v.toLowerCase().trim();
    else if (k === 'password') out.password = v;
    else if (k === 'deactivate') out.deactivate = true;
    else if (k === 'activate') out.activate = true;
  }
  return out;
}

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.email || !isValidEmail(args.email)) {
    console.error('Erro: --email=<endereco> é obrigatório e precisa ser válido.');
    process.exit(1);
  }

  const host = process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] ?? 'desconhecido';
  console.log(`Conectando em: ${host}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    if (args.deactivate || args.activate) {
      const active = !args.deactivate;
      const r = await pool.query(
        `UPDATE monitor_users SET active = $1 WHERE email = $2 RETURNING email, active`,
        [active, args.email]
      );
      if (r.rowCount === 0) {
        console.error(`Monitor não encontrado: ${args.email}`);
        process.exit(1);
      }
      console.log(`✔ ${args.email} ${active ? 'ativado' : 'desativado'}.`);
      return;
    }

    if (!args.password) {
      console.error('Erro: --password=<senha> é obrigatório (mínimo 8 caracteres).');
      process.exit(1);
    }
    if (args.password.length < 8) {
      console.error('Erro: senha precisa ter pelo menos 8 caracteres.');
      process.exit(1);
    }

    const hash = await hashPassword(args.password);

    // UPSERT — primeiro insert cria; insert subsequente atualiza o hash
    // (rotação de senha). Active fica true por padrão; pra desativar use
    // --deactivate explicitamente em call separada.
    const r = await pool.query(
      `INSERT INTO monitor_users (email, password_hash)
         VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING email, created_at, last_login_at`,
      [args.email, hash]
    );
    const row = r.rows[0];
    console.log(`✔ Monitor cadastrado/atualizado: ${row.email}`);
    console.log(`  Criado: ${row.created_at}`);
    console.log(`  Último login: ${row.last_login_at ?? '(nunca)'}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
