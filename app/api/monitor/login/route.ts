import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { setSessionCookie } from '@/lib/session';
import { asService } from '@/lib/db-context';
import { monitorUsers, authEvents } from '@/drizzle/schema';
import { verifyPassword } from '@/lib/password';
import { hashEmail } from '@/lib/magic-link';
import { checkMonitorLoginRateLimit, getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

function isTransientDbError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lowered = msg.toLowerCase();
  return (
    lowered.includes('connection terminated unexpectedly') ||
    lowered.includes('fetch failed') ||
    lowered.includes('socket hang up') ||
    lowered.includes('econnreset') ||
    lowered.includes('etimedout')
  );
}

async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = i === attempts - 1;
      if (!isTransientDbError(error) || isLast) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastError;
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') || undefined;

    // Rate limit por IP — bloqueia brute force. Conta tentativas (sucesso +
    // falha) na auth_events nos últimos 5min; teto = 10/IP.
    let rl: Awaited<ReturnType<typeof checkMonitorLoginRateLimit>> = {
      allowed: true,
      retryAfterSec: 0,
    };
    try {
      rl = await withTransientRetry(() => checkMonitorLoginRateLimit(ip));
    } catch (error) {
      // Falha em telemetria/rate-limit não pode derrubar login legítimo.
      console.warn('[monitor/login] rate-limit indisponível, seguindo sem bloqueio:', error);
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'muitas tentativas. Aguarda alguns minutos.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSec) },
        }
      );
    }

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const password = parsed.data.password;

    // Busca o monitor no banco. RLS service-only, então usa asService.
    const user = await withTransientRetry(() =>
      asService(async (tx) => {
        const rows = await tx
          .select()
          .from(monitorUsers)
          .where(eq(monitorUsers.email, email))
          .limit(1);
        return rows[0] ?? null;
      })
    );

    // Importante: SEMPRE roda verifyPassword pra manter o tempo de resposta
    // constante. Sem isso, "email não existe" volta em ~5ms e "email existe
    // mas senha errada" volta em ~80ms — atacante consegue enumerar emails
    // pelo timing. Quando user é null, comparamos contra um hash fake (formato
    // válido mas sem salt real) só pra queimar tempo de scrypt.
    const fakeHash =
      'scrypt:32768:8:1:00000000000000000000000000000000:00000000000000000000000000000000';
    const targetHash = user?.passwordHash ?? fakeHash;
    const valid = await verifyPassword(password, targetHash);

    // Critério de autorização: email existe + active=true + senha confere.
    const ok = !!user && user.active && valid;

    try {
      await withTransientRetry(() =>
        asService(async (tx) => {
          await tx.insert(authEvents).values({
            eventType: ok ? 'login' : 'unauthorized_access_attempt',
            emailHash: hashEmail(email),
            ip,
            userAgent,
          });
          if (ok) {
            await tx
              .update(monitorUsers)
              .set({ lastLoginAt: new Date() })
              .where(eq(monitorUsers.email, email));
          }
        })
      );
    } catch (error) {
      // Audit é best-effort: login não pode falhar por causa de log.
      console.warn('[monitor/login] falha ao persistir auth event:', error);
    }

    if (!ok) {
      // Mesma resposta pra qualquer falha (não enumera email, não diferencia
      // active=false de senha errada). Frontend vê só "credenciais inválidas".
      return NextResponse.json({ error: 'credenciais inválidas' }, { status: 401 });
    }

    await setSessionCookie({ role: 'monitor', email });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[monitor/login] falha inesperada:', error);
    return NextResponse.json(
      { error: 'serviço de login temporariamente indisponível. Tenta novamente.' },
      { status: 503 }
    );
  }
}
