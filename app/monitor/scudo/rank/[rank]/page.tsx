import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { formatDateTime } from '@/app/monitor/scudo/format';
import { getScudoStudentsByRank, RANK_LABELS, rankSlugToOrder } from '@/lib/scudo-metrics';

export async function generateMetadata({ params }: { params: { rank: string } }) {
    const rankOrder = rankSlugToOrder(params.rank);
    if (!rankOrder) {
        return { title: 'Rank inválido · Dashboard Scudo' };
    }

    return { title: `Alunos ${RANK_LABELS[rankOrder - 1]} · Dashboard Scudo` };
}

export default async function MonitorScudoRankPage({ params }: { readonly params: { rank: string } }) {
    const session = await getSession();
    if (session?.role !== 'monitor') {
        redirect('/monitor/login');
    }

    const rankOrder = rankSlugToOrder(params.rank);
    if (!rankOrder) {
        notFound();
    }

    let result: Awaited<ReturnType<typeof getScudoStudentsByRank>> | null = null;
    let loadError: string | null = null;

    try {
        result = await getScudoStudentsByRank(rankOrder);
    } catch (err) {
        loadError = err instanceof Error ? err.message : 'Falha inesperada ao carregar alunos.';
    }

    if (!result) {
        return (
            <section className="mx-auto flex max-w-5xl flex-col gap-4 py-8">
                <div className="flex items-center justify-between">
                    <h1 className="font-titulo text-3xl font-bold">Alunos por rank</h1>
                    <Link href="/monitor/scudo" className="text-sm text-[#6528d3] hover:underline">
                        Voltar ao dashboard
                    </Link>
                </div>
                <div className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fca5a5]">
                    <p className="font-semibold">Não foi possível carregar a listagem.</p>
                    <p className="mt-1">{loadError ?? 'Verifique SCUDO_DATABASE_URL e permissões de leitura.'}</p>
                </div>
            </section>
        );
    }

    return (
        <section className="mx-auto flex max-w-6xl flex-col gap-6 py-8">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-wider text-dobro-cinza-escuro/60">Monitor · Scudo</p>
                    <h1 className="font-titulo text-3xl font-bold">Alunos rank {result.rank}</h1>
                    <p className="mt-1 text-sm text-dobro-cinza-escuro/70">
                        {result.students.length.toLocaleString('pt-BR')} aluno(s) encontrado(s)
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Link
                        href="/monitor/scudo"
                        className="rounded-md border border-[#333] px-3 py-2 text-sm text-white/80 transition-colors hover:border-[#6528d3] hover:bg-white/5"
                    >
                        Dashboard Scudo
                    </Link>
                    <form action="/api/auth/logout" method="post">
                        <button
                            type="submit"
                            className="rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/5"
                        >
                            Sair ({session.email})
                        </button>
                    </form>
                </div>
            </header>

            {result.students.length === 0 ? (
                <div className="rounded-lg border border-[#333] bg-[#1a1a1a] px-4 py-6 text-sm text-dobro-cinza-escuro/70">
                    Nenhum aluno encontrado neste rank.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-[#333] bg-[#1a1a1a]">
                    <table className="min-w-full text-left text-sm">
                        <thead className="border-b border-[#333] text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Aluno</th>
                                <th className="px-4 py-3 font-semibold">Email</th>
                                <th className="px-4 py-3 font-semibold">Oficial</th>
                                <th className="px-4 py-3 font-semibold">Último acesso</th>
                                <th className="px-4 py-3 font-semibold">Vagas aplicadas</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.students.map((student) => (
                                <tr key={student.email} className="border-b border-[#333]/70 last:border-b-0">
                                    <td className="px-4 py-3 font-medium">{student.name || '—'}</td>
                                    <td className="px-4 py-3 font-mono text-xs">{student.email}</td>
                                    <td className="px-4 py-3">
                                        {student.isOfficial ? (
                                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                                                Sim
                                            </span>
                                        ) : (
                                            <span className="text-dobro-cinza-escuro/60">Não</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-dobro-cinza-escuro/80">{formatDateTime(student.lastAccessAt)}</td>
                                    <td className="px-4 py-3 font-mono">
                                        {result.hasAppliedJobsTracking
                                            ? student.appliedJobsCount.toLocaleString('pt-BR')
                                            : 'N/D'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
