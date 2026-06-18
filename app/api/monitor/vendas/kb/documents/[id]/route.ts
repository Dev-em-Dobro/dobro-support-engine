import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions, kbChunks } from '@/drizzle/schema';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

// GET /api/monitor/vendas/kb/documents/[id]
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireMonitor();
    const { id } = params;

    const doc = await asMonitor(session.email, async (tx) => {
      const rows = await tx
        .select()
        .from(kbDocuments)
        .where(eq(kbDocuments.id, id))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!doc) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });

    const versions = await asMonitor(session.email, async (tx) =>
      tx
        .select({
          id: kbDocumentVersions.id,
          version: kbDocumentVersions.version,
          charCount: kbDocumentVersions.charCount,
          embeddingTokens: kbDocumentVersions.embeddingTokens,
          embeddingCostUsd: kbDocumentVersions.embeddingCostUsd,
          createdByEmail: kbDocumentVersions.createdByEmail,
          createdAt: kbDocumentVersions.createdAt,
          chunkCount: sql<number>`(
            select count(*)::int from kb_chunks c where c.version_id = ${kbDocumentVersions.id}
          )`,
        })
        .from(kbDocumentVersions)
        .where(eq(kbDocumentVersions.documentId, id))
        .orderBy(desc(kbDocumentVersions.version))
    );

    // Chunks da versão atual (para debug/preview no monitor)
    const chunks = doc.currentVersionId
      ? await asMonitor(session.email, async (tx) =>
          tx
            .select({ id: kbChunks.id, chunkIndex: kbChunks.chunkIndex, content: kbChunks.content, tokenCount: kbChunks.tokenCount })
            .from(kbChunks)
            .where(eq(kbChunks.versionId, doc.currentVersionId!))
            .orderBy(kbChunks.chunkIndex)
        )
      : [];

    return NextResponse.json({ doc, versions, chunks });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/monitor/vendas/kb/documents/[id]]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
