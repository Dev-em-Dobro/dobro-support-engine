import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { kbDocuments, kbDocumentVersions } from '@/drizzle/schema';
import { desc, sql, eq } from 'drizzle-orm';

export const metadata = { title: 'Knowledge Base · Monitor' };

const statusBadge: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  archived: 'bg-blue-100 text-blue-700',
};

const typeLabel: Record<string, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  faq: 'FAQ',
};

export default async function KnowledgeBasePage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

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
          <h1 className="font-titulo text-2xl font-bold">Base de Conhecimento</h1>
          <p className="text-sm text-dobro-cinza-escuro/60 mt-1">
            {docs.length} documento{docs.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/monitor/vendas/knowledge-base/new"
          className="rounded-lg bg-dobro-azul px-5 py-2.5 text-sm font-bold text-white hover:bg-dobro-azul/90 transition-colors"
        >
          + Cadastrar documento
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-dobro-cinza-escuro/10 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-dobro-cinza-claro border-b border-dobro-cinza-escuro/10">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-dobro-cinza-escuro/70">Título</th>
              <th className="px-4 py-3 text-left font-semibold text-dobro-cinza-escuro/70">Tipo</th>
              <th className="px-4 py-3 text-left font-semibold text-dobro-cinza-escuro/70">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-dobro-cinza-escuro/70">Versões</th>
              <th className="px-4 py-3 text-left font-semibold text-dobro-cinza-escuro/70">Autor</th>
              <th className="px-4 py-3 text-left font-semibold text-dobro-cinza-escuro/70">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-dobro-cinza-escuro/60">
                  Nenhum documento cadastrado. Clique em &quot;Cadastrar documento&quot; para começar.
                </td>
              </tr>
            )}
            {docs.map((doc) => (
              <tr
                key={doc.id}
                className="border-b border-dobro-cinza-escuro/10 hover:bg-dobro-cinza-claro transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/monitor/vendas/knowledge-base/${doc.id}`}
                    className="font-medium text-dobro-azul hover:underline"
                  >
                    {doc.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-dobro-cinza-escuro/70">
                  {typeLabel[doc.sourceType] ?? doc.sourceType}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge[doc.status] ?? 'bg-blue-100 text-blue-700'}`}
                  >
                    {doc.archivedAt ? 'arquivado' : doc.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-dobro-cinza-escuro/70">{doc.versionCount}</td>
                <td className="px-4 py-3 text-dobro-cinza-escuro/70 text-xs">{doc.createdByEmail}</td>
                <td className="px-4 py-3 text-dobro-cinza-escuro/60 text-xs">
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
