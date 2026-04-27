import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { logMonitorAction, setSubmissionStatus } from '@/lib/monitor-actions';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : undefined;

  await asMonitor(session.email, async (tx) => {
    await setSubmissionStatus(tx, params.id, 'rejected', {
      errorMsg: reason ?? 'Rejeitada pelo monitor',
    });
    await logMonitorAction(tx, {
      submissionId: params.id,
      monitorEmail: session.email,
      action: 'reject',
      edits: reason ? { reason } : null,
    });
  });

  return NextResponse.json({ ok: true });
}
