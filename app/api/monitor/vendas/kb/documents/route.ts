import { NextResponse } from 'next/server';
import { z } from 'zod';
import { desc, and, eq, ilike, sql } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions, salesAuditEvents } from '@/drizzle/schema';
import { extractText, ingestDocument, parseFaqPairs, type FaqPair } from '@/lib/kb-ingest';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// PDFs até 5MB: multipart precisa de limite maior que o default Next.js (4MB)
export const maxDuration = 60;

const MAX_PDF_BYTES = 5 * 1024 * 1024;

const ListQuery = z.object({
  type: z.enum(['pdf', 'markdown', 'faq']).optional(),
  status: z.enum(['processing', 'active', 'failed', 'archived']).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /api/monitor/vendas/kb/documents
export async function GET(req: Request) {
  try {
    const session = await requireMonitor();
    const url = new URL(req.url);
    const query = ListQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success) return NextResponse.json({ error: 'parâmetros inválidos' }, { status: 400 });

    const { type, status, q, page, limit } = query.data;
    const offset = (page - 1) * limit;

    const docs = await asMonitor(session.email, async (tx) => {
      const conditions = [];
      if (type) conditions.push(eq(kbDocuments.sourceType, type));
      if (status) conditions.push(eq(kbDocuments.status, status));
      if (q) conditions.push(ilike(kbDocuments.title, `%${q}%`));

      return tx
        .select({
          id: kbDocuments.id,
          title: kbDocuments.title,
          sourceType: kbDocuments.sourceType,
          status: kbDocuments.status,
          createdByEmail: kbDocuments.createdByEmail,
          archivedAt: kbDocuments.archivedAt,
          createdAt: kbDocuments.createdAt,
          updatedAt: kbDocuments.updatedAt,
          versionCount: sql<number>`count(distinct ${kbDocumentVersions.id})::int`,
          chunkCount: sql<number>`coalesce((
            select count(*)::int from kb_chunks c
            join kb_document_versions v on v.id = c.version_id
            where v.document_id = ${kbDocuments.id}
              and v.id = ${kbDocuments.currentVersionId}
          ), 0)`,
        })
        .from(kbDocuments)
        .leftJoin(kbDocumentVersions, eq(kbDocumentVersions.documentId, kbDocuments.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .groupBy(kbDocuments.id)
        .orderBy(desc(kbDocuments.updatedAt))
        .limit(limit)
        .offset(offset);
    });

    return NextResponse.json({ docs });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/monitor/vendas/kb/documents]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

// POST /api/monitor/vendas/kb/documents
export async function POST(req: Request) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;

    const contentType = req.headers.get('content-type') ?? '';
    let title: string;
    let sourceType: 'pdf' | 'markdown' | 'faq';
    let description: string | undefined;
    let tags: string[] = [];
    let rawContent: string | Buffer;
    let faqPairs: FaqPair[] | undefined;
    let pdfBytes: Buffer | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      title = String(form.get('title') ?? '').trim();
      sourceType = String(form.get('sourceType') ?? '') as 'pdf' | 'markdown' | 'faq';
      description = String(form.get('description') ?? '').trim() || undefined;
      const rawTags = String(form.get('tags') ?? '');
      tags = rawTags ? rawTags.split(',').map((t) => t.trim()).filter(Boolean) : [];

      if (sourceType === 'pdf') {
        const file = form.get('file') as File | null;
        if (!file) return NextResponse.json({ error: 'arquivo PDF obrigatório' }, { status: 400 });
        if (file.size > MAX_PDF_BYTES) {
          return NextResponse.json({ error: 'PDF excede 5MB' }, { status: 413 });
        }
        if (!file.type.includes('pdf')) {
          return NextResponse.json({ error: 'tipo de arquivo inválido (esperado PDF)' }, { status: 400 });
        }
        pdfBytes = Buffer.from(await file.arrayBuffer());
        rawContent = pdfBytes;
      } else if (sourceType === 'markdown') {
        rawContent = String(form.get('content') ?? '').trim();
        if (!rawContent) return NextResponse.json({ error: 'conteúdo Markdown obrigatório' }, { status: 400 });
      } else if (sourceType === 'faq') {
        const parsed = parseFaqPairs(form.get('faqPairs'));
        if (!parsed) return NextResponse.json({ error: 'FAQ requer ao menos um par válido' }, { status: 400 });
        faqPairs = parsed;
        rawContent = '';
      } else {
        return NextResponse.json({ error: 'sourceType inválido' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'use multipart/form-data' }, { status: 415 });
    }

    if (!title || title.length > 200) {
      return NextResponse.json({ error: 'título obrigatório (máx 200 chars)' }, { status: 400 });
    }

    // Extrai texto
    let rawText: string;
    try {
      rawText = await extractText(sourceType, rawContent, faqPairs);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'falha na extração de texto' },
        { status: 422 }
      );
    }

    const charCount = rawText.length;

    // Persiste documento + primeira versão
    const { documentId, versionId } = await asService(async (tx) => {
      const [doc] = await tx
        .insert(kbDocuments)
        .values({ title, sourceType, description, tags, status: 'processing', createdByEmail: session.email })
        .returning({ id: kbDocuments.id });

      const [ver] = await tx
        .insert(kbDocumentVersions)
        .values({
          documentId: doc.id,
          version: 1,
          rawText,
          rawBytes: pdfBytes,
          charCount,
          createdByEmail: session.email,
        })
        .returning({ id: kbDocumentVersions.id });

      return { documentId: doc.id, versionId: ver.id };
    });

    // Chunking + embedding (síncrono)
    let ingestResult;
    try {
      ingestResult = await ingestDocument(documentId, versionId, rawText);
    } catch (err) {
      // Marca como falhou mas não destrói o registro
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

    // Auditoria
    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'kb_create',
          actorEmail: session.email,
          actorRole: 'monitor',
          targetId: documentId,
          metadata: { title, sourceType, chunkCount: ingestResult.chunkCount },
          ip,
          userAgent,
        });
      });
    } catch {}

    return NextResponse.json(
      { documentId, versionId, ...ingestResult },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/monitor/vendas/kb/documents]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
