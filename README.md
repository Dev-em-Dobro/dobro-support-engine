# Dobro Support

Plataforma de suporte ao aluno DevQuest. Agregador de correções de desafios, tickets, histórico do aluno e base de conhecimento. Também armazena dados de aprendizado pra fazer um adptative learning pro aluno.

**PRD:** `../docs/prd/dobro-support.md`
**Stories:** `../docs/stories/dobro-support/`

## Módulos

| Módulo | Status |
|---|---|
| Correção de Desafios | v1 (MVP manual — testável localmente) |
| Tickets | futuro |
| Histórico do Aluno | futuro |
| Base de Conhecimento | futuro |

## Stack

- Next.js 14 (App Router, TypeScript strict)
- Tailwind CSS (tokens do design system Dev em Dobro)
- Drizzle ORM — cliente duplo: `neon-http` (reads) + `neon-serverless/Pool+WebSocket` (transações RLS)
- `@react-pdf/renderer` pra gerar PDF em Node
- `jose` pra JWT de sessão (24h, httpOnly)
- Deploy: Vercel Pro, região `gru1`

## O que roda hoje (v1 MVP)

**Pipeline manual end-to-end**, testável em `localhost`:

1. Aluno abre `/entrar`, coloca email → recebe magic link (no **DEV_MODE** o link volta direto na tela)
2. Aluno envia URL do GitHub em `/correcoes/submit` → status `queued`
3. Monitor abre `/monitor/login` → dashboard mostra a submissão pendente
4. Monitor edita nota + feedback → clica "Aprovar e entregar"
5. Back-end gera PDF (React PDF) e marca `delivered`
6. Aluno vê "Entregue" em `/correcoes/minhas-correcoes` e baixa o PDF

**Deferido pra v1.1** (já tem lugar na arquitetura):
- DS-007 cron de pickup automático
- DS-008 resolver GitHub + Playwright screenshots
- DS-009 correção automática via Claude Sonnet

## Setup local (do zero ao teste)

### 1. Dependências

```bash
cd dobro-support
pnpm install
```

### 2. Banco de dados (Neon)

Crie um projeto em [neon.tech](https://neon.tech) (free tier serve), pegue a **pooler connection string** com `sslmode=require`.

```bash
cp .env.local.example .env.local
# edite .env.local:
#   DATABASE_URL=postgresql://...pooler...sslmode=require
#   AUTH_SECRET=<gere com `openssl rand -base64 32`>
#   MONITOR_EMAILS=voce@devemdobro.com
#   MONITOR_PASSWORD=qualquer-senha-forte
```

### 3. Aplicar migrations + seed opcional

```bash
pnpm db:init        # cria enums, tabelas, RLS (não-idempotente; rode em DB vazio)
pnpm drizzle:seed   # popula 3 submissões de exemplo
```

### 4. Subir o app

```bash
pnpm dev
# http://localhost:3000
```

Healthcheck: `GET http://localhost:3000/api/health` → `{status:"ok", db:"ok"}`.

## Testando o fluxo

### Aluno

1. `http://localhost:3000/entrar`
2. Digita um email qualquer (ex.: `aluno@teste.com`) → clica **"Receber link"**
3. Com `DEV_MODE=true`, a tela mostra um botão **"Abrir link (dev)"** — clica nele
4. Vai pra `/correcoes` já logado → clica em **"Enviar correção"**
5. Cola uma URL GitHub válida (`https://github.com/usuario/repo`) e envia

### Monitor

1. Em outra aba (ou janela anônima): `http://localhost:3000/monitor/login`
2. Usa `MONITOR_EMAILS[0]` + `MONITOR_PASSWORD`
3. Dashboard mostra a submissão na aba **Pendentes**
4. Clica **Abrir →**, preenche nota/pontos/feedback
5. **Aprovar e entregar** → PDF é gerado e status vira `delivered`

### Aluno (de volta)

1. Em `/correcoes/minhas-correcoes` o status agora é **Entregue**
2. Clica na submissão → vê o feedback completo + botão **Baixar PDF**

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | Dev server em `localhost:3000` |
| `pnpm build` | Build de produção |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:init` | Aplica `0001_init.sql` + `0002_rls.sql` no `DATABASE_URL` |
| `pnpm drizzle:seed` | Seed local (3 submissões em status variados) |
| `pnpm drizzle:studio` | Drizzle Studio pra inspecionar DB |

## Variáveis de ambiente essenciais

| Var | Default | Obrigatória? |
|---|---|---|
| `DATABASE_URL` | — | **Sim** (Neon pooler com SSL) |
| `AUTH_SECRET` | — | **Sim** (gere com `openssl rand -base64 32`) |
| `APP_URL` | `http://localhost:3000` | Não |
| `DEV_MODE` | `true` se `NODE_ENV != production` | Não |
| `MONITOR_EMAILS` | — | **Sim** pra logar como monitor (csv) |
| `MONITOR_PASSWORD` | — | **Sim** pra logar como monitor |
| `RESEND_API_KEY` | — | Só em produção (DEV_MODE ignora) |
| `FROM_EMAIL` | — | Só em produção |

Detalhes completos: `.env.local.example`.

## Estrutura

```
dobro-support/
├── app/
│   ├── layout.tsx / page.tsx          # landing + header
│   ├── entrar/                        # login aluno (magic link)
│   ├── monitor/
│   │   ├── login/                     # login monitor (allowlist + senha)
│   │   ├── dashboard/                 # lista filtrada
│   │   └── submissions/[id]/          # editor de correção
│   ├── correcoes/
│   │   ├── submit/                    # form aluno
│   │   ├── minhas-correcoes/          # histórico do aluno
│   │   └── [id]/                      # detalhe + botão PDF
│   └── api/
│       ├── auth/                      # request-link, consume, logout
│       ├── monitor/                   # login, submissions/{id}/[draft|approve|reject|regenerate]
│       ├── correcoes/{submit, [id]/pdf}
│       └── health
├── components/                        # ModuleNav, shared UI
├── lib/
│   ├── db.ts                          # clientes duplos (HTTP + Pool)
│   ├── db-context.ts                  # withUserContext + asStudent/asMonitor/asService
│   ├── session.ts                     # JWT cookie
│   ├── magic-link.ts                  # issue/consume + rate-limit
│   ├── env.ts                         # lazy env accessors
│   ├── monitor-actions.ts             # upsert correction + audit log
│   ├── pdf.tsx                        # React PDF + generateAndStorePdf
│   ├── status.ts                      # labels PT-BR + badges
│   └── validators.ts                  # Zod schemas (GH url, correction draft)
├── drizzle/
│   ├── schema.ts                      # 7 tabelas + enums + relations
│   ├── migrations/                    # 0001_init.sql + 0002_rls.sql
│   └── seed.ts                        # submissions de exemplo
├── scripts/db-init.ts                 # aplica migrations
├── .env.local.example
└── styles/globals.css
```

