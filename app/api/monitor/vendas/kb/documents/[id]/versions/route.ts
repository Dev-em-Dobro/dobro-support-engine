import { NextResponse } from 'next/server';
import { eq, max } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions, salesAuditEvents } from '@/drizzle/schema';
import { extractText, ingestDocument, parseFaqPairs, type FaqPair } from '@/lib/kb-ingest';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PDF_BYTES = 5 * 1024 * 1024;

// POST /api/monitor/vendas/kb/documents/[id]/versions — reupload de nova versão
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;
    const { id: documentId } = params;

    const doc = await asMonitor(session.email, async (tx) => {
      const rows = await tx.select().from(kbDocuments).where(eq(kbDocuments.id, documentId)).limit(1);
      return rows[0] ?? null;
    });

    if (!doc) return NextResponse.json({ error: 'documento não encontrado' }, { status: 404 });
    if (doc.archivedAt) return NextResponse.json({ error: 'documento arquivado — reative primeiro' }, { status: 409 });

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'use multipart/form-data' }, { status: 415 });
    }

    const form = await req.formData();
    let rawContent: string | Buffer;
    let faqPairs: FaqPair[] | undefined;
    let pdfBytes: Buffer | undefined;

    if (doc.sourceType === 'pdf') {
      const file = form.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'arquivo PDF obrigatório' }, { status: 400 });
      if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: 'PDF excede 5MB' }, { status: 413 });
      if (!file.type.includes('pdf')) {
        return NextResponse.json({ error: 'tipo de arquivo inválido (esperado PDF)' }, { status: 400 });
      }
      pdfBytes = Buffer.from(await file.arrayBuffer());
      rawContent = pdfBytes;
    } else if (doc.sourceType === 'markdown') {
      rawContent = String(form.get('content') ?? '').trim();
      if (!rawContent) return NextResponse.json({ error: 'conteúdo obrigatório' }, { status: 400 });
    } else {
      const parsed = parseFaqPairs(form.get('faqPairs'));
      if (!parsed) return NextResponse.json({ error: 'FAQ requer ao menos um par válido' }, { status: 400 });
      faqPairs = parsed;
      rawContent = '';
    }

    let rawText: string;
    try {
      rawText = await extractText(doc.sourceType, rawContent, faqPairs);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'falha na extração' },
        { status: 422 }
      );
    }

    // Próximo número de versão
    const [{ nextVersion }] = await asService(async (tx) =>
      tx
        .select({ nextVersion: max(kbDocumentVersions.version) })
        .from(kbDocumentVersions)
        .where(eq(kbDocumentVersions.documentId, documentId))
    ).then((rows) => rows.map((r) => ({ nextVersion: (r.nextVersion ?? 0) + 1 })));

    const [ver] = await asService(async (tx) =>
      tx
        .insert(kbDocumentVersions)
        .values({
          documentId,
          version: nextVersion,
          rawText,
          rawBytes: pdfBytes,
          charCount: rawText.length,
          createdByEmail: session.email,
        })
        .returning({ id: kbDocumentVersions.id })
    );

    await asService(async (tx) => {
      await tx
        .update(kbDocuments)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(kbDocuments.id, documentId));
    });

    let ingestResult;
    try {
      ingestResult = await ingestDocument(documentId, ver.id, rawText);
    } catch (err) {
      await asService(async (tx) => {
        await tx
          .update(kbDocuments)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(kbDocuments.id, documentId));
      });
      return NextResponse.json(
        { error: 'falha no processamento: ' + (err instanceof Error ? err.message : String(err)) },
        { status: 500 }
      );
    }

    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'kb_reupload',
          actorEmail: session.email,
          actorRole: 'monitor',
          targetId: documentId,
          metadata: { version: nextVersion, chunkCount: ingestResult.chunkCount },
          ip,
          userAgent,
        });
      });
    } catch {}

    return NextResponse.json({ versionId: ver.id, version: nextVersion, ...ingestResult });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/monitor/vendas/kb/documents/[id]/versions]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
