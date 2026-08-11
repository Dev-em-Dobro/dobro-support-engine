import { neon, Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@/drizzle/schema';
// Side-effect import: instala (em DEV) o handler de uncaughtException pra
// engolir erros transientes do websocket Neon. Em prod o módulo só exporta
// helpers, sem instalar nada.
import './db-retry';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. See .env.local.example.');
}

// O driver serverless do Neon usa WebSocket (porta 443) em vez de TCP puro
// (5432). Nas funções serverless da Vercel o TCP do `pg` para o Neon não
// fecha conexão (login dava 503), enquanto o WebSocket funciona — é o mesmo
// caminho que o script de migração já usa. Em runtimes sem WebSocket global
// (Node serverless) precisamos injetar o constructor `ws`; em runtimes que já
// têm WebSocket global (edge/browser/Node novo) pula.
if (typeof WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

// HTTP client — one-shot queries, no transactions. Use for service-role reads
// (cron, health checks, migrations-less scripts).
export const sql = neon(process.env.DATABASE_URL);
export const db = drizzleHttp(sql, { schema });

// Pooled client — supports transactions (required for RLS SET LOCAL).
// Use this for every request that needs withUserContext().
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => {
  console.error('[db] pooled connection error', err);
});
export const dbTx = drizzlePool(pool, { schema });

export { schema };
