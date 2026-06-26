/**
 * Typed access to runtime env vars.
 *
 * Reads are lazy — we throw only when a value is actually needed, so dev mode
 * can boot without optional integrations configured.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

function bool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export const env = {
  get DATABASE_URL() {
    return required('DATABASE_URL');
  },
  get SCUDO_DATABASE_URL() {
    return required('SCUDO_DATABASE_URL');
  },
  get NEON_NAPI_KEY() {
    return optional('NEON_NAPI_KEY');
  },
  get NEON_ORG_ID() {
    return optional('NEON_ORG_ID');
  },
  get SCUDO_NEON_PROJECT_ID() {
    // ID do projeto Neon da Scudo (nao confundir com NEON_PROJECT_ID do Support Engine).
    // Evita varrer todos os projetos da org na API da Neon ao carregar o dashboard.
    return optional('SCUDO_NEON_PROJECT_ID');
  },
  get APP_URL() {
    return process.env.APP_URL || 'http://localhost:3000';
  },
  get AUTH_SECRET() {
    const v = process.env.AUTH_SECRET;
    if (v) return v;
    if (process.env.NODE_ENV !== 'production') {
      // Fallback só para dev local: evita travar login quando o .env ainda
      // não foi completado. Em produção continua obrigatório.
      return 'dev-only-auth-secret-change-me';
    }
    throw new Error('Missing env: AUTH_SECRET');
  },
  get DEV_MODE() {
    return bool('DOBRO_DEV_MODE', process.env.NODE_ENV !== 'production');
  },
  // Monitor: credenciais ficam na tabela monitor_users (migrate 0005). Bootstrap
  // via `npm run monitor:add -- --email=x@y.com --password=...`. MONITOR_EMAILS
  // e MONITOR_PASSWORD do env foram removidas a partir de 2026-04-28.
  // Email — desabilitado por padrão (decisão Carlos 2026-04-25: correção é
  // entregue ao vivo no fluxo anônimo, login nominado por enquanto não vale
  // o custo do Resend). Pra reativar: setar DOBRO_EMAIL_ENABLED=true em prod.
  get EMAIL_ENABLED() {
    return bool('DOBRO_EMAIL_ENABLED', false);
  },
  get RESEND_API_KEY() {
    return optional('RESEND_API_KEY');
  },
  get FROM_EMAIL() {
    return process.env.FROM_EMAIL || 'Dobro Support <onboarding@resend.dev>';
  },
  // AI
  get OPENAI_API_KEY() {
    return required('OPENAI_API_KEY');
  },
  get GITHUB_TOKEN() {
    return optional('GITHUB_TOKEN');
  },
  // Cron job auth (Vercel sets CRON_SECRET env in request Authorization header)
  get CRON_SECRET() {
    return optional('CRON_SECRET');
  },
  // Webhook (Slack/Discord) para alertas fora-de-banda de mudanças críticas no
  // agente de vendas — ex.: edição do chat_context. Opcional: se ausente, o
  // alerta é silenciosamente ignorado.
  get SALES_ALERT_WEBHOOK() {
    return optional('SALES_ALERT_WEBHOOK');
  },
  // Aprovação two-eyes do chat_context: quando true, uma edição entra como
  // pendente e exige aprovação de um SEGUNDO monitor antes de virar ativa.
  // Default false — só faz sentido com 3+ gestores (precisa de aprovador).
  get SALES_CONTEXT_REQUIRE_APPROVAL() {
    return bool('SALES_CONTEXT_REQUIRE_APPROVAL', false);
  },
  // Dispara a avaliação automatizada (lib/sales-eval) em background sempre que o
  // chat_context muda. Default false — tem custo de API por mudança; ligue
  // quando houver baseline curado. A avaliação manual via UI funciona sempre.
  get SALES_EVAL_AUTO() {
    return bool('SALES_EVAL_AUTO', false);
  },
};
