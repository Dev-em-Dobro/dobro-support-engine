import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { setSessionCookie } from '@/lib/session';
import { asService } from '@/lib/db-context';
import { salesUsers, salesAuditEvents } from '@/drizzle/schema';
import { verifyPassword } from '@/lib/password';
import { checkSalesLoginRateLimit, getClientIp } from '@/lib/rate-limit';
import { withTransientRetry } from '@/lib/db-retry';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;

    let rl: Awaited<ReturnType<typeof checkSalesLoginRateLimit>> = {
      allowed: true,
      retryAfterSec: 0,
    };
    try {
      rl = await withTransientRetry(() => checkSalesLoginRateLimit(ip));
    } catch (error) {
      console.warn('[vendas/auth/login] rate-limit indisponível, seguindo sem bloqueio:', error);
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'muitas tentativas. Aguarda alguns minutos.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const password = parsed.data.password;

    const user = await withTransientRetry(() =>
      asService(async (tx) => {
        const rows = await tx
          .select()
          .from(salesUsers)
          .where(eq(salesUsers.email, email))
          .limit(1);
        return rows[0] ?? null;
      })
    );

    // Timing-safe: sempre roda verifyPassword para evitar enumeração por timing.
    const fakeHash =
      'scrypt:32768:8:1:00000000000000000000000000000000:00000000000000000000000000000000';
    const targetHash = user?.passwordHash ?? fakeHash;
    const valid = await verifyPassword(password, targetHash);

    const ok = !!user && user.active && valid;

    try {
      await withTransientRetry(() =>
        asService(async (tx) => {
          await tx.insert(salesAuditEvents).values({
            eventType: ok ? 'login' : 'unauthorized_access_attempt',
            actorEmail: email,
            actorRole: 'sales',
            ip,
            userAgent,
          });
          if (ok) {
            await tx
              .update(salesUsers)
              .set({ lastLoginAt: new Date() })
              .where(eq(salesUsers.email, email));
          }
        })
      );
    } catch (error) {
      console.warn('[vendas/auth/login] falha ao persistir audit event:', error);
    }

    if (!ok) {
      return NextResponse.json({ error: 'credenciais inválidas' }, { status: 401 });
    }

    await setSessionCookie({ role: 'sales', email });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[vendas/auth/login] falha inesperada:', error);
    return NextResponse.json(
      { error: 'serviço de login temporariamente indisponível. Tenta novamente.' },
      { status: 503 }
    );
  }
}
