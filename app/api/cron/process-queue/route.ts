/**
 * Pickup manual de submissions órfãs (queued/processing).
 *
 * Sem schedule na Vercel: o cron de 5 em 5 min acordava o Neon o mês inteiro.
 * Pipeline normal: submit → waitUntil. Retry: poll de /status enquanto o
 * aluno espera. Este endpoint fica pra ops (Authorization: Bearer CRON_SECRET).
 *
 * When CRON_SECRET is not set (local dev), this endpoint rejects all requests.
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { processStuckSubmissions } from '@/lib/ai-processor';

export const runtime = 'nodejs';
// 20 submissions × up to 60s each = 1200s worst case, but Vercel caps at 300s
// on Pro. In practice most runs process 0–2 items. Tune limit in ai-processor if needed.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 }
    );
  }

  const header = req.headers.get('authorization') || '';
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await processStuckSubmissions();
  return NextResponse.json({ ok: true, ...result });
}
