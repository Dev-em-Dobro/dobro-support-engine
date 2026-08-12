/**
 * Public PDF download — serve o PDF pré-gerado quando existe.
 *
 * No auth: anyone with the submission UUID gets the PDF. Same reasoning as
 * the status endpoint — the data is the student's own submission + correction,
 * and UUIDs are unguessable.
 *
 * Antes esta rota renderizava fresco a cada request. Correção grande passa de
 * 30s no react-pdf (medido: 60 melhorias = ~35s) e estourava o maxDuration,
 * devolvendo 504 pro aluno. Agora o PDF é gerado quando a correção fica pronta
 * (lib/ai-processor.ts) e aqui é só leitura.
 *
 * O render fresco continua como fallback pras correções anteriores à
 * pré-geração, que não têm linha em pdfs. Esse caminho ainda pode dar timeout
 * em correção muito grande — é o comportamento antigo, não uma regressão — e
 * grava o resultado pra que a segunda tentativa venha do banco.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { asService } from '@/lib/db-context';
import { corrections, submissions } from '@/drizzle/schema';
import { renderCorrectionPdf, getStoredPdf, storeCorrectionPdf } from '@/lib/pdf';

export const runtime = 'nodejs';
export const maxDuration = 30;

function pdfResponse(bytes: Buffer, githubUrl: string) {
  const repo = githubUrl
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\//g, '-');
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="correcao-${repo}.pdf"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    },
  });
}

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

  // Caminho normal: bytes já prontos, nada de render na requisição.
  const stored = await getStoredPdf(params.id);
  if (stored) {
    return pdfResponse(stored.data, data.submission.githubUrl);
  }

  // Fallback pras correções sem PDF pré-gerado.
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

  // Guarda pra próxima. Se falhar, o aluno já tem o PDF em mãos — só a próxima
  // visita vai pagar o render de novo.
  storeCorrectionPdf(params.id).catch((err) => {
    console.error(
      `[pdf-route] não consegui guardar o PDF de ${params.id}:`,
      err instanceof Error ? err.message : err
    );
  });

  return pdfResponse(buffer, data.submission.githubUrl);
}
