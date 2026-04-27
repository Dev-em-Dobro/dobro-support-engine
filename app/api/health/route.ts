import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    const rows = await sql`SELECT 1 AS ok`;
    return NextResponse.json({
      status: 'ok',
      db: rows?.[0]?.ok === 1 ? 'ok' : 'unknown',
      latencyMs: Date.now() - startedAt,
      now: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'down',
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
