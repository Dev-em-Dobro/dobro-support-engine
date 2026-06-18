/**
 * GET/PUT /api/gestor-vendas/como-funciona — markdown "como o chat funciona".
 *
 * Editável pelo gestor de vendas (role 'monitor'). Lido pelos vendedores em
 * /vendas/como-funciona como página de ajuda. Renderizado como texto simples
 * por agora (sem parser markdown ainda — evita XSS via raw HTML).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { salesSettings, salesAuditEvents } from '@/drizzle/schema';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const KEY = 'how_it_works' as const;
const MAX_LEN = 20000;

const PutBody = z.object({
  value: z.string().max(MAX_LEN, `máximo ${MAX_LEN} caracteres`),
});

export async function GET() {
  try {
    const session = await requireMonitor();
    const rows = await asMonitor(session.email, async (tx) =>
      tx
        .select({ value: salesSettings.value, updatedAt: salesSettings.updatedAt, updatedByEmail: salesSettings.updatedByEmail })
        .from(salesSettings)
        .where(eq(salesSettings.key, KEY))
        .limit(1)
    );
    return NextResponse.json(rows[0] ?? { value: '', updatedAt: null, updatedByEmail: null });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/gestor-vendas/como-funciona]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;

    const json = await req.json().catch(() => null);
    const parsed = PutBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'dados inválidos' },
        { status: 400 }
      );
    }

    await asMonitor(session.email, async (tx) => {
      await tx
        .update(salesSettings)
        .set({ value: parsed.data.value, updatedByEmail: session.email, updatedAt: new Date() })
        .where(eq(salesSettings.key, KEY));
    });

    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'how_it_works_update',
          actorEmail: session.email,
          actorRole: 'monitor',
          metadata: { length: parsed.data.value.length },
          ip,
          userAgent,
        });
      });
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[PUT /api/gestor-vendas/como-funciona]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
