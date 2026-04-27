import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { CorrectionDraftInput } from '@/lib/validators';
import {
  logMonitorAction,
  setSubmissionStatus,
  upsertCorrection,
} from '@/lib/monitor-actions';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = CorrectionDraftInput.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'correção inválida', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  await asMonitor(session.email, async (tx) => {
    await upsertCorrection(tx, params.id, parsed.data, {
      model: 'manual',
      promptVersion: 'manual-v1',
    });
    await setSubmissionStatus(tx, params.id, 'draft');
    await logMonitorAction(tx, {
      submissionId: params.id,
      monitorEmail: session.email,
      action: 'edit',
      edits: parsed.data,
    });
  });

  return NextResponse.json({ ok: true });
}
