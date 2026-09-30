import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness only — não toca no Neon. Um ping aqui não pode acordar o compute.
 * Checagem de banco fica nas rotas que já precisam dele (submit, status, etc).
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    now: new Date().toISOString(),
  });
}
