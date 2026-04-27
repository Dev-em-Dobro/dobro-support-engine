/**
 * Public PDF download — renders on the fly from the current saved correction.
 *
 * No auth: anyone with the submission UUID gets the PDF. Same reasoning as
 * the status endpoint — the data is the student's own submission + correction,
 * and UUIDs are unguessable.
 *
 * No stored pdfs table lookup: we render fresh every time so the PDF always
 * reflects the latest correction state. Fast and stateless.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { asService } from '@/lib/db-context';
import { corrections, submissions } from '@/drizzle/schema';
import { renderCorrectionPdf } from '@/lib/pdf';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const data = await asService(async (tx) => {
    const sub = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, params.id))
      .limit(1);
    if (sub.length === 0) return null;
    const corr = await tx
      .select()
      .from(corrections)
      .where(eq(corrections.submissionId, params.id))
      .limit(1);
    return { submission: sub[0], correction: corr[0] ?? null };
  });

  if (!data) {
    return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
  }
  if (!data.correction) {
    return NextResponse.json(
      { error: 'a correção ainda não está pronta' },
      { status: 409 }
    );
  }

  const buffer = await renderCorrectionPdf({
    studentEmail: data.submission.studentEmail,
    githubUrl: data.submission.githubUrl,
    grade: data.correction.grade,
    strengths: data.correction.strengths as string[],
    improvements: data.correction.improvements as Parameters<
      typeof renderCorrectionPdf
    >[0]['improvements'],
    narrativeMd: data.correction.narrativeMd,
    correctedAt: data.submission.correctedAt ?? new Date(),
  });

  const repo = data.submission.githubUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\//g, '-');
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="correcao-${repo}.pdf"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
