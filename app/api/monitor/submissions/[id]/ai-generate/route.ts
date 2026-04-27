import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { submissions } from '@/drizzle/schema';
import { generateCorrectionViaAI } from '@/lib/ai-correction';
import { polishCorrection } from '@/lib/ai-reviewer';
import { sumUsage } from '@/lib/cost';
import {
  upsertCorrection,
  logMonitorAction,
  setSubmissionStatus,
} from '@/lib/monitor-actions';

export const runtime = 'nodejs';
// Leitura de repo inteiro (até 60 arquivos em batch) + OpenAI com contexto grande.
// Na prática roda em 20–60s, mas o teto dá folga pra repos maiores.
export const maxDuration = 90;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  // Ler a submission
  const submission = await asMonitor(session.email, async (tx) => {
    const rows = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, params.id))
      .limit(1);
    return rows[0] || null;
  });

  if (!submission) {
    return NextResponse.json({ error: 'submission não encontrada' }, { status: 404 });
  }

  // Marcar como processing (feedback visual no dashboard)
  await asMonitor(session.email, async (tx) => {
    await setSubmissionStatus(tx, params.id, 'draft', { errorMsg: null });
  });

  let generated;
  try {
    generated = await generateCorrectionViaAI({
      githubUrl: submission.githubUrl,
      deployedUrl: submission.deployedUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro gerando correção';
    await asMonitor(session.email, async (tx) => {
      await setSubmissionStatus(tx, params.id, 'rejected', { errorMsg: msg });
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Polish pass — second AI rewrites issues (tom, vagueness, AI-speak)
  // before we surface anything to the monitor. Fails open.
  const polish = await polishCorrection(generated.correction, {
    githubUrl: submission.githubUrl,
    studentEmail: submission.studentEmail,
  });

  // Custo agregado (gerador + polisher) — fica gravado em corrections pra
  // queries de "custo médio por correção" ficarem rápidas; breakdown vai
  // pra monitor_actions.edits pra debug futuro.
  const totalUsage = sumUsage([generated.usage, polish.usage]);

  // Persistir o rascunho polido
  await asMonitor(session.email, async (tx) => {
    await upsertCorrection(tx, params.id, polish.polished, {
      model: generated.model,
      promptVersion: generated.promptVersion,
      tokensIn: totalUsage.tokensIn,
      tokensOut: totalUsage.tokensOut,
      costUsd: totalUsage.costUsd,
    });
    await setSubmissionStatus(tx, params.id, 'draft', {
      correctedAt: new Date(),
      errorMsg: null,
    });
    await logMonitorAction(tx, {
      submissionId: params.id,
      monitorEmail: session.email,
      action: 'regenerate',
      edits: {
        source: 'ai',
        model: generated.model,
        polishChanges: polish.changes,
        polishFallback: polish.fallback,
        usage: {
          generator: generated.usage,
          polisher: polish.usage,
          total: {
            tokensIn: totalUsage.tokensIn,
            tokensOut: totalUsage.tokensOut,
            costUsd: Number(totalUsage.costUsd.toFixed(6)),
          },
        },
      },
    });
  });

  return NextResponse.json({ ok: true, correction: polish.polished });
}
