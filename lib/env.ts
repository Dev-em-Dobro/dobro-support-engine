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
  get APP_URL() {
    return process.env.APP_URL || 'http://localhost:3000';
  },
  get AUTH_SECRET() {
    return required('AUTH_SECRET');
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
};
