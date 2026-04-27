# Dobro Support — Database Layer

Drizzle ORM + Neon Postgres. PRD: `docs/prd/dobro-support.md`.

## Estrutura

```
drizzle/
├── schema.ts              # Single source of truth (TypeScript types + Drizzle tables)
├── migrations/
│   ├── 0001_init.sql      # DDL: extensions, enums, tables, indexes, triggers
│   └── 0002_rls.sql       # Row-Level Security policies
├── seed.ts                # Seed idempotente pra dev local
└── README.md              # Este arquivo
```

## Setup local

1. Criar branch de dev no Neon console e pegar a `DATABASE_URL` (connection pooling habilitado)
2. Criar `.env.local` em `dobro-support/`:
   ```
   DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dobro_support?sslmode=require
   ```
3. Aplicar migrations:
   ```bash
   psql $DATABASE_URL -f drizzle/migrations/0001_init.sql
   psql $DATABASE_URL -f drizzle/migrations/0002_rls.sql
   ```
4. Seed (opcional):
   ```bash
   pnpm tsx drizzle/seed.ts
   ```
5. Inspecionar com Drizzle Studio:
   ```bash
   pnpm drizzle-kit studio
   ```

## Conexão na aplicação

```typescript
// dobro-support/lib/db.ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '@/drizzle/schema';

export const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

**Sempre** envolva queries com o helper `withUserContext`:

```typescript
// dobro-support/lib/db-context.ts
export async function withUserContext<T>(
  ctx: { email?: string; role: 'student' | 'monitor' | 'service' | 'anonymous' },
  fn: () => Promise<T>
): Promise<T> {
  await sql`SELECT set_config('app.user_email', ${ctx.email ?? ''}, true)`;
  await sql`SELECT set_config('app.user_role', ${ctx.role}, true)`;
  try {
    return await fn();
  } finally {
    await sql`SELECT set_config('app.user_email', '', true)`;
    await sql`SELECT set_config('app.user_role', '', true)`;
  }
}

// Uso:
await withUserContext({ email: 'aluno@x.com', role: 'student' }, async () => {
  return db.select().from(submissions); // RLS aplica automaticamente
});
```

## Decisões travadas (respostas às 7 open questions)

### 1. RLS strategy: `set_config` (per-request)
**Decisão:** session variables via `SET LOCAL app.user_email` + `app.user_role`, políticas consultam via `current_setting()`.

**Alternativa descartada:** Neon roles per-user. Seria mais granular mas exigiria proliferação de roles Postgres e pool de conexões por usuário — incompatível com Neon HTTP driver (conexão por request).

**Vantagens:**
- Single connection pool (HTTP driver)
- Grants simples (uma role neon_authenticated)
- Debuggable (`SELECT current_setting('app.user_email', true)` em psql)
- Pattern recomendado pela própria Neon em exemplos multi-tenant

### 2. Indexes
Todos os índices sobem em `0001_init.sql`:

| Tabela | Índice | Finalidade |
|---|---|---|
| submissions | `(student_email, submitted_at DESC)` | Listagem do aluno em `/minhas-correcoes` |
| submissions | `(status, submitted_at)` | Filtros do dashboard monitor |
| submissions | **partial** `(status, submitted_at) WHERE status IN ('queued','processing','draft','approved')` | Cron pickup + overdue. Índice tiny pois 99% das rows terminam em estados finais |
| submissions | **partial** `(delivered_at) WHERE delivered_at IS NOT NULL` | Métricas v2 |
| auth_tokens | `(token_hash)` UNIQUE | Lookup no click do magic link |
| auth_tokens | `(email, created_at DESC)` | Rate limiting (últimos N tokens por email) |
| auth_events | `(email_hash, created_at DESC)` | Audit trail por usuário |
| auth_events | `(created_at DESC)` | Admin overview recente |
| screenshots | `(submission_id, viewport)` UNIQUE | Max 1 desktop + 1 mobile por submission |
| corrections | `(submission_id)` UNIQUE | Já implícito pela UNIQUE constraint |
| monitor_actions | `(submission_id, created_at DESC)` | Timeline no detalhe do monitor |
| pdfs | `(submission_id, version DESC)` UNIQUE | Última versão do PDF |

### 3. Bytea size limits
- **Hard cap no DB via CHECK:** screenshots ≤ 512KB, PDFs ≤ 2MB.
- **App layer:** Playwright gera screenshots em WebP qualidade 80 (~300-400KB reais).
- **TOAST:** Postgres armazena bytea >2KB em storage externo automaticamente, transparente pra aplicação. Até 1GB por row tecnicamente suportado, mas limitamos agressivamente pra manter o DB magro.

### 4. pgvector em v1 ou v2?
**Decisão:** `CREATE EXTENSION vector` **já em v1**. Zero custo (extensão ociosa). Cria `corrections_index` só em v2 quando o RAG for implementado. Evita migração futura com risco de rebuild.

### 5. Rate-limit store: **Upstash Redis**
- Free tier: 10k comandos/dia — sobra pra v1
- Sliding window rate-limiter tem SDK oficial (`@upstash/ratelimit`)
- Pattern já usado no Scudo — consistência com resto da infra Dobro
- Alternativa Vercel KV: mesma DX mas quota menor no free tier

### 6. Partial indexes: **sim, onde faz sentido**
- `submissions_active_status_idx`: apenas rows não-terminais. Índice 10-50× menor que full.
- `submissions_delivered_at_idx`: apenas rows entregues (para métricas v2).

### 7. Connection pooling: **Neon HTTP driver**
`@neondatabase/serverless` (HTTP) + `drizzle-orm/neon-http`.

**Por quê:**
- Serverless-native (zero cold connection overhead na Vercel)
- Zero config de pooler
- Transações de statement único são rápidas
- **Caveat:** transações multi-statement exigem `neon()` com `.transaction()` wrapper OU trocar pra `postgres-js` + Neon Pooler connection string em rotas específicas. Documentar no dev onboarding.

**Quando usar `postgres-js` + Pooler:** operações longas ou com múltiplas queries atômicas (raro em v1). O cron de processamento pode usar isso se precisar.

---

## Máquina de status (submissions)

```
pending_auth ──(magic link click)──> queued
    │                                   │
    │                                   ▼
    │                              processing
    │                                   │
    │                                   ├──(pipeline ok)──> draft ──(monitor aprova)──> approved ──(PDF+email sent)──> delivered
    │                                   │                      │
    │                                   │                      └──(monitor reprova)─> rejected
    │                                   │
    │                                   └──(pipeline erro)──> failed
    │
    └──(token expira 15min)──> (nunca sai de pending_auth, pode ser limpo por cron)
```

Transições permitidas enforcadas no app layer (função `advanceSubmission(id, from, to)`) — não no DB, porque CHECK constraints em transições são verbosas e pouco flexíveis.

## Testes de isolamento (RLS)

Rodar após migrations e seed pra validar que o isolamento funciona. Ver bloco comentado no final de `0002_rls.sql`. Resumo:

- ✅ Aluno A só vê próprias submissions
- ✅ Aluno A não vê submissions do Aluno B
- ✅ Monitor vê todas
- ✅ Anonymous não vê nada
- ✅ UPDATE em monitor_actions falha (append-only via trigger)

## Operações comuns

### Aplicar nova migration
```bash
pnpm tsx drizzle/apply-migration.ts drizzle/migrations/000N_xxx.sql
```

### Snapshot antes de migração destrutiva
```bash
pg_dump $DATABASE_URL --schema-only > snapshots/pre-000N-$(date +%Y%m%d-%H%M).sql
```

### LGPD: direito ao esquecimento (manual v1)
```sql
-- Como monitor logado:
DELETE FROM submissions WHERE student_email = 'aluno@x.com';
-- Cascade derruba screenshots, corrections, monitor_actions, pdfs
-- Depois anonimizar auth_events (hash já é ok, mas pode deletar se quiser):
DELETE FROM auth_events WHERE email_hash = encode(sha256(lower('aluno@x.com')::bytea), 'hex');
```

## Troubleshooting

**"permission denied for table X"**
→ Session variables não estão setadas. Rode via `withUserContext()` ou chame `SELECT set_config('app.user_role','service',true)` antes.

**"duplicate key value violates unique constraint screenshots_submission_viewport_idx"**
→ Já existe screenshot pra essa submission+viewport. Delete antes de reinserir ou use UPSERT.

**Transação multi-statement não comita com HTTP driver**
→ Usar `await sql.transaction(async (tx) => { ... })` do `@neondatabase/serverless`, OU usar Pooler connection string com `postgres-js` em rotas que precisam de transação longa.
