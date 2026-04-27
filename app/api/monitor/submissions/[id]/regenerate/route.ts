import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { logMonitorAction, setSubmissionStatus } from '@/lib/monitor-actions';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  // v1 manual: só registra o pedido e volta pra queued. O pipeline automático
  // (Claude + screenshots) chega em v1.1.
  await asMonitor(session.email, async (tx) => {
    await setSubmissionStatus(tx, params.id, 'draft', { errorMsg: null });
    await logMonitorAction(tx, {
      submissionId: params.id,
      monitorEmail: session.email,
      action: 'regenerate',
    });
  });

  return NextResponse.json({ ok: true, note: 'v1 manual — edite e salve rascunho' });
}
