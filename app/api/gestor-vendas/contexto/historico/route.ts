/**
 * GET/POST /api/gestor-vendas/contexto/historico — versões do chat_context.
 *
 * GET  → últimas 20 versões salvas (pra UI de auditoria/rollback).
 * POST → restaura uma versão anterior: copia o value dela pra sales_settings,
 *        grava a restauração como uma NOVA versão (mantém a trilha imutável),
 *        invalida o cache e dispara o alerta fora-de-banda.
 *
 * Restaurar é uma mudança crítica do agente — por isso passa pelo mesmo alerta
 * que uma edição normal. Não revalida no guard heurístico: a versão sendo
 * restaurada já foi aceita quando foi salva.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { salesSettings, salesSettingsHistory, salesAuditEvents } from '@/drizzle/schema';
import { getClientIp } from '@/lib/rate-limit';
import { invalidateChatContextCache } from '@/lib/sales-settings';
import { sendChatContextAlert } from '@/lib/sales-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY = 'chat_context' as const;
const LIST_LIMIT = 20;

const PostBody = z.object({
  version: z.number().int().positive(),
});

export async function GET() {
  try {
    const session = await requireMonitor();
    const rows = await asMonitor(session.email, async (tx) =>
      tx
        .select({
          version: salesSettingsHistory.version,
          value: salesSettingsHistory.value,
          editedByEmail: salesSettingsHistory.editedByEmail,
          editedAt: salesSettingsHistory.editedAt,
        })
        .from(salesSettingsHistory)
        .where(eq(salesSettingsHistory.key, KEY))
        .orderBy(desc(salesSettingsHistory.version))
        .limit(LIST_LIMIT)
    );
    return NextResponse.json({ versions: rows });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/gestor-vendas/contexto/historico]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;

    const json = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'versão inválida' }, { status: 400 });
    }

    const result = await asMonitor(session.email, async (tx) => {
      const [target] = await tx
        .select({ value: salesSettingsHistory.value })
        .from(salesSettingsHistory)
        .where(
          and(eq(salesSettingsHistory.key, KEY), eq(salesSettingsHistory.version, parsed.data.version))
        )
        .limit(1);
      if (!target) return { notFound: true as const };

      const [current] = await tx
        .select({ value: salesSettings.value })
        .from(salesSettings)
        .where(eq(salesSettings.key, KEY))
        .limit(1);
      const oldValue = current?.value ?? '';

      // No-op se a versão alvo já é a vigente.
      if (oldValue === target.value) return { oldValue, newValue: target.value, changed: false };

      await tx
        .update(salesSettings)
        .set({ value: target.value, updatedByEmail: session.email, updatedAt: new Date() })
        .where(eq(salesSettings.key, KEY));

      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${salesSettingsHistory.version}), 0)::int` })
        .from(salesSettingsHistory)
        .where(eq(salesSettingsHistory.key, KEY));
      await tx.insert(salesSettingsHistory).values({
        key: KEY,
        version: (maxRow?.max ?? 0) + 1,
        value: target.value,
        editedByEmail: session.email,
      });

      return { oldValue, newValue: target.value, changed: true };
    });

    if ('notFound' in result) {
      return NextResponse.json({ error: 'versão não encontrada' }, { status: 404 });
    }

    invalidateChatContextCache();

    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'chat_context_restore',
          actorEmail: session.email,
          actorRole: 'monitor',
          metadata: { restoredVersion: parsed.data.version, length: result.newValue.length },
          ip,
          userAgent,
        });
      });
    } catch {}

    if (result.changed) {
      void sendChatContextAlert({
        actorEmail: session.email,
        ip,
        userAgent,
        oldValue: result.oldValue,
        newValue: result.newValue,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/gestor-vendas/contexto/historico]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
