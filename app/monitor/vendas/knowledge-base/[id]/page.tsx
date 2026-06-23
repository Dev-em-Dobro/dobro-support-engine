import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { KbDocumentActions } from './KbDocumentActions';
import { asMonitor } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions, kbChunks } from '@/drizzle/schema';
import { eq, desc, sql } from 'drizzle-orm';

export const metadata = { title: 'Detalhe do documento · KB Monitor' };

const statusBadge: Record<string, string> = {
  active: 'bg-[#22c55e]/15 text-[#6ee7b7]',
  processing: 'bg-[#ff6b35]/15 text-[#fdba74]',
  failed: 'bg-[#ef4444]/15 text-[#fca5a5]',
  archived: 'bg-[#3b82f6]/15 text-[#93c5fd]',
};

export default async function KbDocumentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

  const doc = await asMonitor(session.email, async (tx) => {
    const rows = await tx
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, params.id))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!doc) notFound();

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
        chunkCount: sql<number>`(select count(*)::int from kb_chunks c where c.version_id = ${kbDocumentVersions.id})`,
      })
      .from(kbDocumentVersions)
      .where(eq(kbDocumentVersions.documentId, params.id))
      .orderBy(desc(kbDocumentVersions.version))
  );

  const chunks = doc.currentVersionId
    ? await asMonitor(session.email, async (tx) =>
        tx
          .select({
            id: kbChunks.id,
            chunkIndex: kbChunks.chunkIndex,
            content: kbChunks.content,
            tokenCount: kbChunks.tokenCount,
          })
          .from(kbChunks)
          .where(eq(kbChunks.versionId, doc.currentVersionId!))
          .orderBy(kbChunks.chunkIndex)
      )
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <Link
          href="/monitor/vendas/knowledge-base"
          className="text-sm text-[#6528d3] hover:underline"
        >
          ← Base de Conhecimento
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="ds-subtitle">{doc.title}</h1>
            {doc.description && (
              <p className="mt-1 text-sm text-white/70">{doc.description}</p>
            )}
            <div className="mt-2 flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[doc.status] ?? 'bg-[#3b82f6]/15 text-[#93c5fd]'}`}
              >
                {doc.archivedAt ? 'arquivado' : doc.status}
              </span>
              <span className="text-xs text-white/50">{doc.sourceType.toUpperCase()}</span>
              {doc.tags.length > 0 && (
                <span className="text-xs text-white/50">{doc.tags.join(', ')}</span>
              )}
            </div>
          </div>
          <KbDocumentActions documentId={doc.id} isArchived={!!doc.archivedAt} hasVersion={!!doc.currentVersionId} sourceType={doc.sourceType} />
        </div>
      </div>

      <div className="rounded-xl border border-[#333] bg-[#0d0d0d] shadow-sm overflow-hidden">
        <div className="border-b border-[#333] px-5 py-3">
          <h2 className="font-semibold text-sm text-white">Versões ({versions.length})</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[#1a1a1a]">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Versão</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Chars</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Chunks</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Tokens</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Custo</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Autor</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white/60">Data</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr
                key={v.id}
                className={`border-b border-white/5 ${v.id === doc.currentVersionId ? 'bg-[#22c55e]/10' : ''}`}
              >
                <td className="px-4 py-2.5 font-medium text-white">
                  v{v.version}
                  {v.id === doc.currentVersionId && (
                    <span className="ml-2 text-[10px] font-bold uppercase text-[#6ee7b7]">atual</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-white/70">{v.charCount.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-2.5 text-white/70">{v.chunkCount}</td>
                <td className="px-4 py-2.5 text-white/70">{v.embeddingTokens.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-2.5 text-white/70">${Number(v.embeddingCostUsd).toFixed(4)}</td>
                <td className="px-4 py-2.5 text-xs text-white/60">{v.createdByEmail}</td>
                <td className="px-4 py-2.5 text-xs text-white/60">
                  {new Date(v.createdAt).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {chunks.length > 0 && (
        <details className="rounded-xl border border-[#333] bg-[#0d0d0d] shadow-sm">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-white hover:bg-white/5">
            Chunks da versão atual ({chunks.length})
          </summary>
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {chunks.map((c) => (
              <div key={c.id} className="px-5 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-mono text-white/60">#{c.chunkIndex}</span>
                  <span className="text-xs text-white/60">{c.tokenCount} tokens</span>
                </div>
                <p className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed">
                  {c.content}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
