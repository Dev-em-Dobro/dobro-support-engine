/**
 * GET/PUT /api/gestor-vendas/contexto — contexto extra do SYSTEM_PROMPT.
 *
 * Editável pelo gestor de vendas (role 'monitor'). O texto entra **depois**
 * das regras inegociáveis do prompt principal em app/api/vendas/chat/route.ts,
 * limitando o estrago caso a conta seja comprometida (prompt injection).
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
import { inspectChatContext } from '@/lib/prompt-guard';
import { maybeScheduleEvalAfterContextChange } from '@/lib/sales-eval';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY = 'chat_context' as const;
const MAX_LEN = 4000;

const PutBody = z.object({
  value: z.string().max(MAX_LEN, `máximo ${MAX_LEN} caracteres`),
});

export async function GET() {
  try {
    const session = await requireMonitor();
    const rows = await asMonitor(session.email, async (tx) =>
      tx
        .select({
          value: salesSettings.value,
          updatedAt: salesSettings.updatedAt,
          updatedByEmail: salesSettings.updatedByEmail,
          pendingValue: salesSettings.pendingValue,
          pendingByEmail: salesSettings.pendingByEmail,
          pendingAt: salesSettings.pendingAt,
        })
        .from(salesSettings)
        .where(eq(salesSettings.key, KEY))
        .limit(1)
    );
    return NextResponse.json({
      ...(rows[0] ?? { value: '', updatedAt: null, updatedByEmail: null, pendingValue: null, pendingByEmail: null, pendingAt: null }),
      requiresApproval: env.SALES_CONTEXT_REQUIRE_APPROVAL,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/gestor-vendas/contexto]', err);
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

    // Guard heurístico de prompt injection — barra padrões clássicos de
    // override antes de gravar. Não substitui as mitigações no prompt; detém
    // erros honestos e ataques de baixa sofisticação, e gera sinal de auditoria.
    const guard = inspectChatContext(parsed.data.value);
    if (!guard.ok) {
      try {
        await asService(async (tx) => {
          await tx.insert(salesAuditEvents).values({
            eventType: 'chat_context_rejected',
            actorEmail: session.email,
            actorRole: 'monitor',
            metadata: { rule: guard.rule, length: parsed.data.value.length },
            ip,
            userAgent,
          });
        });
      } catch {}
      return NextResponse.json(
        { error: `Texto rejeitado por segurança: ${guard.reason}` },
        { status: 400 }
      );
    }

    // Modo two-eyes (opt-in): a edição não é aplicada; vira proposta pendente
    // que um SEGUNDO monitor precisa aprovar em /aprovar. Elimina o ataque solo.
    if (env.SALES_CONTEXT_REQUIRE_APPROVAL) {
      const currentValue = await asMonitor(session.email, async (tx) => {
        const rows = await tx
          .select({ value: salesSettings.value })
          .from(salesSettings)
          .where(eq(salesSettings.key, KEY))
          .limit(1);
        return rows[0]?.value ?? '';
      });

      if (currentValue === parsed.data.value) {
        return NextResponse.json({ error: 'O contexto já está com esse valor.' }, { status: 400 });
      }

      await asMonitor(session.email, async (tx) => {
        await tx
          .update(salesSettings)
          .set({ pendingValue: parsed.data.value, pendingByEmail: session.email, pendingAt: new Date() })
          .where(eq(salesSettings.key, KEY));
      });

      try {
        await asService(async (tx) => {
          await tx.insert(salesAuditEvents).values({
            eventType: 'chat_context_submitted',
            actorEmail: session.email,
            actorRole: 'monitor',
            metadata: { length: parsed.data.value.length },
            ip,
            userAgent,
          });
        });
      } catch {}

      // Alerta: há uma proposta aguardando revisão de outro gestor.
      void sendChatContextAlert({
        actorEmail: session.email,
        ip,
        userAgent,
        oldValue: currentValue,
        newValue: parsed.data.value,
        pending: true,
      });

      return NextResponse.json({ ok: true, pending: true });
    }

    const oldValue = await asMonitor(session.email, async (tx) => {
      const rows = await tx
        .select({ value: salesSettings.value })
        .from(salesSettings)
        .where(eq(salesSettings.key, KEY))
        .limit(1);
      const previous = rows[0]?.value ?? '';

      await tx
        .update(salesSettings)
        .set({ value: parsed.data.value, updatedByEmail: session.email, updatedAt: new Date() })
        .where(eq(salesSettings.key, KEY));

      // Snapshot de versão pra rollback — só quando o conteúdo muda de fato.
      if (previous !== parsed.data.value) {
        const [maxRow] = await tx
          .select({ max: sql<number>`coalesce(max(${salesSettingsHistory.version}), 0)::int` })
          .from(salesSettingsHistory)
          .where(eq(salesSettingsHistory.key, KEY));
        await tx.insert(salesSettingsHistory).values({
          key: KEY,
          version: (maxRow?.max ?? 0) + 1,
          value: parsed.data.value,
          editedByEmail: session.email,
        });
      }

      return previous;
    });

    invalidateChatContextCache();

    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'chat_context_update',
          actorEmail: session.email,
          actorRole: 'monitor',
          metadata: { length: parsed.data.value.length },
          ip,
          userAgent,
        });
      });
    } catch {}

    // Alerta fora-de-banda (best-effort) — detecção de mudança maliciosa em
    // tempo quase real. Só dispara quando o conteúdo realmente muda.
    if (oldValue !== parsed.data.value) {
      void sendChatContextAlert({
        actorEmail: session.email,
        ip,
        userAgent,
        oldValue,
        newValue: parsed.data.value,
      });
      maybeScheduleEvalAfterContextChange();
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[PUT /api/gestor-vendas/contexto]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
