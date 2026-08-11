import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions, salesAuditEvents } from '@/drizzle/schema';
import { ingestDocument } from '@/lib/kb-ingest';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/monitor/vendas/kb/documents/[id]/reindex — reprocessa versão atual
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

    if (!doc) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
    if (!doc.currentVersionId) return NextResponse.json({ error: 'nenhuma versão processada ainda' }, { status: 409 });

    const version = await asMonitor(session.email, async (tx) => {
      const rows = await tx
        .select({ id: kbDocumentVersions.id, rawText: kbDocumentVersions.rawText })
        .from(kbDocumentVersions)
        .where(eq(kbDocumentVersions.id, doc.currentVersionId!))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!version) return NextResponse.json({ error: 'versão não encontrada' }, { status: 404 });

    await asService(async (tx) => {
      await tx.update(kbDocuments).set({ status: 'processing', updatedAt: new Date() }).where(eq(kbDocuments.id, documentId));
    });

    let ingestResult;
    try {
      ingestResult = await ingestDocument(documentId, version.id, version.rawText);
    } catch (err) {
      await asService(async (tx) => {
        await tx.update(kbDocuments).set({ status: 'failed', updatedAt: new Date() }).where(eq(kbDocuments.id, documentId));
      });
      return NextResponse.json(
        { error: 'falha no reprocessamento: ' + (err instanceof Error ? err.message : String(err)) },
        { status: 500 }
      );
    }

    try {
      await asService(async (tx) => {
        await tx.insert(salesAuditEvents).values({
          eventType: 'kb_reindex',
          actorEmail: session.email,
          actorRole: 'monitor',
          targetId: documentId,
          metadata: { chunkCount: ingestResult.chunkCount },
          ip,
          userAgent,
        });
      });
    } catch {}

    return NextResponse.json({ ok: true, ...ingestResult });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/monitor/vendas/kb/documents/[id]/reindex]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
