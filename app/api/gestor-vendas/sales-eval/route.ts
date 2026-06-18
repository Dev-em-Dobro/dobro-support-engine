/**
 * GET/POST /api/gestor-vendas/sales-eval — avaliação automatizada do agente.
 *
 * GET  → últimas execuções (pra UI).
 * POST → roda a avaliação agora. Body: { baseline?: boolean }.
 *        Autenticação: sessão de monitor OU header de cron (CRON_SECRET), pra
 *        permitir agendamento via Vercel Cron.
 *
 * É uma operação cara/demorada (~1 completion + 2 embeddings por pergunta), por
 * isso maxDuration alto e sem streaming.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { salesEvalRuns } from '@/drizzle/schema';
import { env } from '@/lib/env';
import { runEval } from '@/lib/sales-eval';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  baseline: z.boolean().optional().default(false),
});

function isCronAuthorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.role !== 'monitor') {
      return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
    }
    const runs = await asMonitor(session.email, async (tx) =>
      tx
        .select()
        .from(salesEvalRuns)
        .orderBy(desc(salesEvalRuns.createdAt))
        .limit(20)
    );
    return NextResponse.json({ runs });
  } catch (err) {
    console.error('[GET /api/gestor-vendas/sales-eval]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const isMonitor = session?.role === 'monitor';
    const isCron = isCronAuthorized(req);
    if (!isMonitor && !isCron) {
      return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(json ?? {});
    const baseline = parsed.success ? parsed.data.baseline : false;

    const summary = await runEval('manual', baseline);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error('[POST /api/gestor-vendas/sales-eval]', err);
    return NextResponse.json({ error: 'falha ao rodar avaliação' }, { status: 500 });
  }
}
