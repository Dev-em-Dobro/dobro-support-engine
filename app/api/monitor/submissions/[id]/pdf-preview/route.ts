/**
 * PDF preview for monitors — renders the current saved draft correction
 * on-the-fly, without writing to the pdfs table or flipping status.
 *
 * No review gate here: the polisher already ran during ai-generate, so
 * what's in the database is already the "best version" — preview it as-is.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { submissions, corrections } from '@/drizzle/schema';
import { renderCorrectionPdf } from '@/lib/pdf';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  const data = await asMonitor(session.email, async (tx) => {
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
    return { submission: sub[0], correction: corr[0] || null };
  });

  if (!data) {
    return NextResponse.json({ error: 'submission não encontrada' }, { status: 404 });
  }
  if (!data.correction) {
    return NextResponse.json(
      { error: 'sem rascunho salvo — salve um rascunho antes de pré-visualizar' },
      { status: 400 }
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

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="previa-correcao-${params.id}.pdf"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
