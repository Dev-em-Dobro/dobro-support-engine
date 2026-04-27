/**
 * Public status endpoint for the live correction view.
 *
 * No auth: anyone with the submission UUID can poll. UUIDs are unguessable,
 * and the only data exposed is the correction text + repo URL that the
 * student themselves just submitted. No sensitive data.
 *
 * Returns the submission status and, when ready (draft/approved/delivered),
 * the full correction payload so the client can render it inline.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { asService } from '@/lib/db-context';
import { corrections, submissions } from '@/drizzle/schema';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const data = await asService(async (tx) => {
    const sub = await tx
      .select({
        id: submissions.id,
        status: submissions.status,
        githubUrl: submissions.githubUrl,
        deployedUrl: submissions.deployedUrl,
        errorMsg: submissions.errorMsg,
        correctedAt: submissions.correctedAt,
        submittedAt: submissions.submittedAt,
      })
      .from(submissions)
      .where(eq(submissions.id, params.id))
      .limit(1);
    if (sub.length === 0) return null;

    const corr = await tx
      .select({
        grade: corrections.grade,
        strengths: corrections.strengths,
        improvements: corrections.improvements,
        narrativeMd: corrections.narrativeMd,
      })
      .from(corrections)
      .where(eq(corrections.submissionId, params.id))
      .limit(1);

    return { submission: sub[0], correction: corr[0] ?? null };
  });

  if (!data) {
    return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  }

  const ready = ['draft', 'approved', 'delivered'].includes(data.submission.status);

  return NextResponse.json({
    id: data.submission.id,
    status: data.submission.status,
    githubUrl: data.submission.githubUrl,
    deployedUrl: data.submission.deployedUrl,
    errorMsg: data.submission.errorMsg,
    submittedAt: data.submission.submittedAt,
    correctedAt: data.submission.correctedAt,
    correction: ready ? data.correction : null,
  });
}
