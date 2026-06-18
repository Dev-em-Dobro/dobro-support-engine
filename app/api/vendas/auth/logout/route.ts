import { NextResponse } from 'next/server';
import { clearSessionCookie, getSession } from '@/lib/session';
import { asService } from '@/lib/db-context';
import { salesAuditEvents } from '@/drizzle/schema';
import { getClientIp } from '@/lib/rate-limit';
import { withTransientRetry } from '@/lib/db-retry';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getSession();

  if (session?.role === 'sales') {
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;
    try {
      await withTransientRetry(() =>
        asService(async (tx) => {
          await tx.insert(salesAuditEvents).values({
            eventType: 'logout',
            actorEmail: session.email,
            actorRole: 'sales',
            ip,
            userAgent,
          });
        })
      );
    } catch (error) {
      console.warn('[vendas/auth/logout] falha ao persistir audit event:', error);
    }
  }

  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
