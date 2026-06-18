/**
 * POST /api/gestor-vendas/contexto/aprovar — revisão two-eyes do chat_context.
 *
 * Body: { action: 'approve' | 'reject' }.
 *
 * approve → promove pending_value para value (exige um monitor DIFERENTE de
 *           quem propôs), grava versão no histórico e limpa o pending.
 * reject  → descarta a proposta pendente (qualquer monitor, inclusive o autor).
 *
 * A regra "aprovador ≠ autor" é o coração do controle: impede que um único
 * gestor comprometido aprove a própria mudança.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { salesSettings, salesSettingsHistory, salesAuditEvents } from '@/drizzle/schema';
import { getClientIp } from '@/lib/rate-limit';
import { invalidateChatContextCache } from '@/lib/sales-settings';
import { sendChatContextAlert } from '@/lib/sales-alerts';
import { maybeScheduleEvalAfterContextChange } from '@/lib/sales-eval';

export const runtime = 'nodejs';

const KEY = 'chat_context' as const;

const Body = z.object({
  action: z.enum(['approve', 'reject']),
});

export async function POST(req: Request) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'ação inválida' }, { status: 400 });
    }

    const current = await asMonitor(session.email, async (tx) => {
      const rows = await tx
        .select({
          value: salesSettings.value,
          pendingValue: salesSettings.pendingValue,
          pendingByEmail: salesSettings.pendingByEmail,
        })
        .from(salesSettings)
        .where(eq(salesSettings.key, KEY))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!current || current.pendingValue === null) {
      return NextResponse.json({ error: 'não há proposta pendente.' }, { status: 400 });
    }

    if (parsed.data.action === 'reject') {
      await asMonitor(session.email, async (tx) => {
        await tx
          .update(salesSettings)
          .set({ pendingValue: null, pendingByEmail: null, pendingAt: null })
          .where(eq(salesSettings.key, KEY));
      });
      try {
        await asService(async (tx) => {
          await tx.insert(salesAuditEvents).values({
            eventType: 'chat_context_review_rejected',
            actorEmail: session.email,
            actorRole: 'monitor',
            metadata: { proposedBy: current.pendingByEmail },
            ip,
            userAgent,
          });
        });
      } catch {}
      return NextResponse.json({ ok: true, action: 'reject' });
    }

    // approve — aprovador precisa ser diferente do autor.
    if (current.pendingByEmail && current.pendingByEmail === session.email) {
      return NextResponse.json(
        { error: 'a aprovação precisa ser feita por um gestor diferente de quem propôs.' },
        { status: 403 }
      );
    }

    const pendingValue = current.pendingValue;
    const oldValue = current.value;

    await asMonitor(session.email, async (tx) => {
      await tx
        .update(salesSettings)
        .set({
          value: pendingValue,
          // Mantém o autor da edição como updatedByEmail (quem escreveu),
          // não o aprovador — o histórico registra a autoria real.
          updatedByEmail: current.pendingByEmail,
          updatedAt: new Date(),
          pendingValue: null,
          pendingByEmail: null,
          pendingAt: null,
        })
        .where(eq(salesSettings.key, KEY));

      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${salesSettingsHistory.version}), 0)::int` })
        .from(salesSettingsHistory)
        .where(eq(salesSettingsHistory.key, KEY));
      await tx.insert(salesSettingsHistory).values({
        key: KEY,
        version: (maxRow?.max ?? 0) + 1,
        value: pendingValue,
        editedByEmail: current.pendingByEmail,
      });
    });

    invalidateChatContextCache();

    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'chat_context_approved',
          actorEmail: session.email,
          actorRole: 'monitor',
          metadata: { proposedBy: current.pendingByEmail, length: pendingValue.length },
          ip,
          userAgent,
        });
      });
    } catch {}

    void sendChatContextAlert({
      actorEmail: `${current.pendingByEmail ?? '?'} (aprovado por ${session.email})`,
      ip,
      userAgent,
      oldValue,
      newValue: pendingValue,
    });
    maybeScheduleEvalAfterContextChange();

    return NextResponse.json({ ok: true, action: 'approve' });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/gestor-vendas/contexto/aprovar]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
