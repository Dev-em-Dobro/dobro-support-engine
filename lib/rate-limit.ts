/**
 * Rate-limit helpers — DB-backed.
 *
 * Não usamos Redis/Upstash pra manter o stack simples (uma dependência só
 * = Postgres). Custos de queries são baixos: cada check é um COUNT(*) com
 * index parcial (submissions_client_ip_recent_idx, auth_events_created_idx).
 *
 * Decisões:
 *   - Submit: 3 submits / 5min / IP. Aluno legítimo raramente reenviar 3+
 *     vezes em 5min; script automatizado bate teto em segundos.
 *   - Monitor login: 10 tentativas / 5min / IP. Bloqueia brute force sem
 *     prejudicar quem digitou senha errada uma ou duas vezes.
 *
 * IP extraction: Vercel injeta x-forwarded-for. Pegamos o primeiro hop
 * (cliente real). Se headers não estiverem presentes (dev local), retorna
 * '127.0.0.1' — rate limit ainda funciona em dev pra teste.
 */

import { and, eq, gt, sql } from 'drizzle-orm';
import { asService } from './db-context';
import { submissions, authEvents } from '@/drizzle/schema';

export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return '127.0.0.1';
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number; // Quanto esperar quando blocked
}

const SUBMIT_WINDOW_MS = 5 * 60 * 1000;
const SUBMIT_MAX_PER_WINDOW = 3;

/**
 * Conta submissions recentes do mesmo IP. Retorna se pode prosseguir.
 *
 * Usa index parcial (client_ip, submitted_at DESC) — a query é rápida mesmo
 * com submissions table grande.
 */
export async function checkSubmitRateLimit(ip: string): Promise<RateLimitResult> {
  const since = new Date(Date.now() - SUBMIT_WINDOW_MS);

  const rows = await asService(async (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(eq(submissions.clientIp, ip), gt(submissions.submittedAt, since)))
  );

  const count = rows[0]?.count ?? 0;
  if (count >= SUBMIT_MAX_PER_WINDOW) {
    return { allowed: false, retryAfterSec: Math.ceil(SUBMIT_WINDOW_MS / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

const MONITOR_LOGIN_WINDOW_MS = 5 * 60 * 1000;
const MONITOR_LOGIN_MAX_PER_WINDOW = 10;

/**
 * Conta tentativas recentes de login do MESMO IP via auth_events. Conta tanto
 * sucesso quanto falha — a métrica é "atividade no endpoint", não "falhas
 * exclusivamente". Isso bloqueia também credential-stuffing onde o atacante
 * acerta de vez em quando.
 */
export async function checkMonitorLoginRateLimit(ip: string): Promise<RateLimitResult> {
  const since = new Date(Date.now() - MONITOR_LOGIN_WINDOW_MS);

  const rows = await asService(async (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(authEvents)
      .where(
        and(
          eq(authEvents.ip, ip),
          gt(authEvents.createdAt, since),
          // Eventos que indicam interação com a rota de login do monitor.
          // 'login' e 'unauthorized_access_attempt' cobrem sucesso e falha.
          sql`${authEvents.eventType} IN ('login','unauthorized_access_attempt')`
        )
      )
  );

  const count = rows[0]?.count ?? 0;
  if (count >= MONITOR_LOGIN_MAX_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil(MONITOR_LOGIN_WINDOW_MS / 1000),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}
