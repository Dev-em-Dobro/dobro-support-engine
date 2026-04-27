import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, or, sql as sqlExpr, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { submissions, corrections } from '@/drizzle/schema';
import { statusBadge, statusLabel, type SubmissionStatus } from '@/lib/status';

export const metadata = { title: 'Dashboard monitor · Dobro Support' };

const FILTERS: { label: string; value: string; statuses: SubmissionStatus[] }[] = [
  { label: 'Pendentes', value: 'pending', statuses: ['queued', 'processing', 'draft'] },
  { label: 'Aprovadas', value: 'approved', statuses: ['approved'] },
  { label: 'Entregues', value: 'delivered', statuses: ['delivered'] },
  { label: 'Rejeitadas', value: 'rejected', statuses: ['rejected', 'failed'] },
  { label: 'Todas', value: 'all', statuses: [] },
];

export default async function MonitorDashboardPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    redirect('/monitor/login');
  }

  const active = FILTERS.find((f) => f.value === searchParams.filter) || FILTERS[0];

  const rows = await asMonitor(session.email, async (tx) => {
    const q = tx.select().from(submissions).orderBy(desc(submissions.submittedAt));
    if (active.statuses.length > 0) {
      return q.where(inArray(submissions.status, active.statuses));
    }
    return q;
  });

  // Stats de custo das correções dos últimos 30 dias.
  const costStats = await asMonitor(session.email, async (tx) => {
    const result = await tx
      .select({
        count: sqlExpr<number>`count(*)::int`,
        total: sqlExpr<string>`coalesce(sum(${corrections.costUsd}), 0)::text`,
        avg: sqlExpr<string>`coalesce(avg(${corrections.costUsd}), 0)::text`,
        tokensIn: sqlExpr<number>`coalesce(sum(${corrections.tokensIn}), 0)::int`,
        tokensOut: sqlExpr<number>`coalesce(sum(${corrections.tokensOut}), 0)::int`,
      })
      .from(corrections)
      .where(sqlExpr`${corrections.createdAt} > now() - interval '30 days'`);
    return result[0];
  });

  const totalCost = Number(costStats?.total ?? 0);
  const avgCost = Number(costStats?.avg ?? 0);
  const corrCount = Number(costStats?.count ?? 0);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-titulo text-3xl font-bold">Dashboard monitor</h1>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="text-sm text-dobro-cinza-escuro/70"
          >
            Sair ({session.email})
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-3">
          <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Correções (30d)</p>
          <p className="mt-1 font-mono text-xl font-semibold">{corrCount}</p>
        </div>
        <div className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-3">
          <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Custo total (30d)</p>
          <p className="mt-1 font-mono text-xl font-semibold">${totalCost.toFixed(2)}</p>
        </div>
        <div className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-3">
          <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Média / correção</p>
          <p className="mt-1 font-mono text-xl font-semibold">
            ${avgCost.toFixed(4)}
          </p>
        </div>
        <div className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-3">
          <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Tokens (30d)</p>
          <p className="mt-1 font-mono text-xs text-dobro-cinza-escuro/80">
            <span className="font-semibold">{(costStats?.tokensIn ?? 0).toLocaleString('pt-BR')}</span> in
            {' · '}
            <span className="font-semibold">{(costStats?.tokensOut ?? 0).toLocaleString('pt-BR')}</span> out
          </p>
        </div>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-dobro-cinza-escuro/10 pb-3">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={`/monitor/dashboard?filter=${f.value}`}
            className={`rounded px-3 py-1 text-sm ${
              active.value === f.value
                ? 'bg-dobro-azul text-white'
                : 'bg-dobro-cinza-claro text-dobro-cinza-escuro hover:bg-dobro-cinza-escuro/10'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded bg-dobro-cinza-claro p-8 text-center text-dobro-cinza-escuro/70">
          Nada aqui nesse filtro.
        </p>
      ) : (
        <table className="w-full overflow-hidden rounded border border-dobro-cinza-escuro/10 text-sm">
          <thead className="bg-dobro-cinza-claro text-left text-xs uppercase text-dobro-cinza-escuro/70">
            <tr>
              <th className="px-3 py-2">Aluno</th>
              <th className="px-3 py-2">Repositório</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Enviada</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-dobro-cinza-escuro/5 hover:bg-dobro-cinza-claro/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span>{r.studentEmail}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide ${
                        r.courseVersion === '1.0'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-dobro-cinza-claro text-dobro-cinza-escuro/60'
                      }`}
                      title={r.courseVersion === '1.0' ? 'Cohort legado — DevQuest 1.0' : 'DevQuest 2.0'}
                    >
                      v{r.courseVersion}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.githubUrl.replace('https://github.com/', '')}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadge(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-dobro-cinza-escuro/60">
                  {new Date(r.submittedAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/monitor/submissions/${r.id}`}
                    className="text-dobro-laranja hover:underline"
                  >
                    Abrir →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
