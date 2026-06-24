import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions } from '@/drizzle/schema';
import { desc, sql, eq } from 'drizzle-orm';

export const metadata = { title: 'Knowledge Base · Monitor' };

const statusBadge: Record<string, string> = {
  active: 'bg-[#22c55e]/15 text-[#6ee7b7]',
  processing: 'bg-[#ff6b35]/15 text-[#fdba74]',
  failed: 'bg-[#ef4444]/15 text-[#fca5a5]',
  archived: 'bg-[#3b82f6]/15 text-[#93c5fd]',
};

const typeLabel: Record<string, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  faq: 'FAQ',
};

export default async function KnowledgeBasePage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/gestor-vendas/login');

  const docs = await asMonitor(session.email, async (tx) =>
    tx
      .select({
        id: kbDocuments.id,
        title: kbDocuments.title,
        sourceType: kbDocuments.sourceType,
        status: kbDocuments.status,
        createdByEmail: kbDocuments.createdByEmail,
        archivedAt: kbDocuments.archivedAt,
        updatedAt: kbDocuments.updatedAt,
        versionCount: sql<number>`count(distinct ${kbDocumentVersions.id})::int`,
      })
      .from(kbDocuments)
      .leftJoin(kbDocumentVersions, eq(kbDocumentVersions.documentId, kbDocuments.id))
      .groupBy(kbDocuments.id)
      .orderBy(desc(kbDocuments.updatedAt))
      .limit(100)
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="ds-subtitle">Base de Conhecimento</h1>
          <p className="text-sm text-white/60 mt-1">
            {docs.length} documento{docs.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/monitor/vendas/knowledge-base/new"
          className="rounded-lg bg-[#6528d3] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#5020b0] transition-colors"
        >
          + Cadastrar documento
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#333] bg-[#0d0d0d] shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#1a1a1a] border-b border-[#333]">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-white/70">Título</th>
              <th className="px-4 py-3 text-left font-semibold text-white/70">Tipo</th>
              <th className="px-4 py-3 text-left font-semibold text-white/70">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-white/70">Versões</th>
              <th className="px-4 py-3 text-left font-semibold text-white/70">Autor</th>
              <th className="px-4 py-3 text-left font-semibold text-white/70">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-white/60">
                  Nenhum documento cadastrado. Clique em &quot;Cadastrar documento&quot; para começar.
                </td>
              </tr>
            )}
            {docs.map((doc) => (
              <tr
                key={doc.id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/monitor/vendas/knowledge-base/${doc.id}`}
                    className="font-medium text-[#6528d3] hover:underline"
                  >
                    {doc.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-white/70">
                  {typeLabel[doc.sourceType] ?? doc.sourceType}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[doc.status] ?? 'bg-[#3b82f6]/15 text-[#93c5fd]'}`}
                  >
                    {doc.archivedAt ? 'arquivado' : doc.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-white/70">{doc.versionCount}</td>
                <td className="px-4 py-3 text-white/70 text-xs">{doc.createdByEmail}</td>
                <td className="px-4 py-3 text-white/60 text-xs">
                  {new Date(doc.updatedAt).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
