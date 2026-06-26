import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { formatDateTime } from '@/app/monitor/scudo/format';
import { ScudoFinanceSection } from '@/app/monitor/scudo/ScudoFinanceSection';
import { ScudoFinanceLoading } from '@/app/monitor/scudo/loading';
import { getScudoCoreDashboardMetrics, rankOrderToSlug } from '@/lib/scudo-metrics';

export const metadata = { title: 'Dashboard Scudo · Dobro Support' };

export default async function MonitorScudoDashboardPage({
    searchParams,
}: {
    readonly searchParams: { student?: string };
}) {
    const session = await getSession();
    if (session?.role !== 'monitor') {
        redirect('/monitor/login');
    }

    let dashboard: Awaited<ReturnType<typeof getScudoCoreDashboardMetrics>> | null = null;
    let loadError: string | null = null;

    try {
        dashboard = await getScudoCoreDashboardMetrics(searchParams.student);
    } catch (err) {
        loadError = err instanceof Error ? err.message : 'Falha inesperada ao carregar métricas.';
    }

    if (!dashboard) {
        return (
            <section className="mx-auto flex max-w-5xl flex-col gap-4 py-8">
                <div className="flex items-center justify-between">
                    <h1 className="font-titulo text-3xl font-bold">Dashboard Scudo</h1>
                    <Link href="/monitor/dashboard" className="text-sm text-[#6528d3] hover:underline">
                        Voltar para correções
                    </Link>
                </div>
                <div className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fca5a5]">
                    <p className="font-semibold">Não foi possível carregar os dados da Scudo.</p>
                    <p className="mt-1">{loadError ?? 'Verifique SCUDO_DATABASE_URL e permissões de leitura.'}</p>
                </div>
            </section>
        );
    }

    const weeklyProgressLabel = `${dashboard.jobs.enteredLast7d}/${dashboard.jobs.weeklyGoal}`;

    return (
        <section className="mx-auto flex max-w-6xl flex-col gap-6 py-8">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs uppercase tracking-wider text-dobro-cinza-escuro/60">Monitor · Scudo</p>
                    <h1 className="font-titulo text-3xl font-bold">Dashboard de Métricas</h1>
                    <p className="mt-1 text-sm text-dobro-cinza-escuro/70">
                        Atualizado em{' '}
                        {new Date(dashboard.generatedAt).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                        })}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <Link
                        href="/monitor/dashboard"
                        className="rounded-md border border-[#333] px-3 py-2 text-sm text-white/80 transition-colors hover:border-[#6528d3] hover:bg-white/5"
                    >
                        Correções
                    </Link>
                    <form action="/api/auth/logout" method="post">
                        <button type="submit" className="rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/5">
                            Sair ({session.email})
                        </button>
                    </form>
                </div>
            </header>

            {dashboard.warnings.length > 0 && (
                <div className="rounded-lg border border-[#ff6b35]/40 bg-[#ff6b35]/10 px-4 py-3 text-sm text-[#fdba74]">
                    {dashboard.warnings.map((w) => (
                        <p key={w}>• {w}</p>
                    ))}
                </div>
            )}

            <Suspense fallback={<ScudoFinanceLoading />}>
                <ScudoFinanceSection />
            </Suspense>

            <section className="space-y-3">
                <h2 className="font-titulo text-xl font-semibold">Alunos (Geral)</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Cadastrados</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.students.total.toLocaleString('pt-BR')}</p>
                    </article>
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Acesso 24h</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.students.activeLast24h.toLocaleString('pt-BR')}</p>
                    </article>
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Acesso 48h</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.students.activeLast48h.toLocaleString('pt-BR')}</p>
                    </article>
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Acesso 72h</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.students.activeLast72h.toLocaleString('pt-BR')}</p>
                    </article>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-4">
                        <h3 className="font-titulo text-lg font-semibold">Distribuição por rank</h3>
                        <p className="mt-1 text-xs text-dobro-cinza-escuro/60">Clique no total de alunos para ver a listagem.</p>
                        <div className="mt-3 grid gap-2">
                            {dashboard.students.rankDistribution.map((bucket, index) => {
                                const maxCount = Math.max(...dashboard.students.rankDistribution.map((x) => x.count), 1);
                                const width = Math.round((bucket.count / maxCount) * 100);
                                const rankSlug = rankOrderToSlug(index + 1);
                                const rankHref = `/monitor/scudo/rank/${rankSlug}`;

                                return (
                                    <div key={bucket.rank} className="grid grid-cols-[110px_1fr_80px] items-center gap-2">
                                        <Link
                                            href={rankHref}
                                            className="text-sm text-dobro-cinza-escuro/80 transition-colors hover:text-[#6528d3]"
                                        >
                                            {bucket.rank}
                                        </Link>
                                        <Link href={rankHref} className="h-2 rounded bg-white/10 transition-opacity hover:opacity-90">
                                            <div className="h-2 rounded bg-[#6528d3]" style={{ width: `${width}%` }} />
                                        </Link>
                                        <Link
                                            href={rankHref}
                                            className="text-right font-mono text-sm text-[#6528d3] underline-offset-2 transition-colors hover:underline"
                                        >
                                            {bucket.count.toLocaleString('pt-BR')}
                                        </Link>
                                    </div>
                                );
                            })}
                        </div>
                    </article>

                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-4">
                        <h3 className="font-titulo text-lg font-semibold">Aplicações</h3>
                        <p className="mt-2 text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Total marcadas</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.students.appliedJobsTotal.toLocaleString('pt-BR')}</p>
                        <p className="mt-3 text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Últimos 7 dias</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.students.appliedJobsLast7d.toLocaleString('pt-BR')}</p>
                        <p className="mt-2 text-xs text-dobro-cinza-escuro/60">
                            Tracking de candidatura: {dashboard.students.hasAppliedJobsTracking ? 'ativo' : 'inativo'}
                        </p>
                    </article>
                </div>
            </section>

            <section className="space-y-3">
                <h2 className="font-titulo text-xl font-semibold">Aluno específico</h2>
                <form className="rounded-lg border border-[#333] bg-[#1a1a1a] p-4" method="get" action="/monitor/scudo">
                    <label htmlFor="student-email" className="block text-sm font-medium text-dobro-cinza-escuro">Email do aluno</label>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <input
                            id="student-email"
                            type="email"
                            name="student"
                            defaultValue={searchParams.student ?? ''}
                            placeholder="aluno@exemplo.com"
                            className="min-w-[280px] flex-1 rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-white placeholder:text-white/40 outline-none focus:border-[#6528d3]"
                        />
                        <button type="submit" className="rounded-md bg-[#6528d3] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5020b0]">
                            Buscar
                        </button>
                        {searchParams.student && (
                            <Link
                                href="/monitor/scudo"
                                className="rounded-md border border-[#333] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/5"
                            >
                                Limpar
                            </Link>
                        )}
                    </div>

                    {searchParams.student && !dashboard.student && (
                        <p className="mt-3 text-sm text-[#fdba74]">Nenhum aluno encontrado para esse email.</p>
                    )}

                    {dashboard.student && (
                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <article className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/20 p-3">
                                <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Aluno</p>
                                <p className="mt-1 text-sm font-semibold">{dashboard.student.name || dashboard.student.email}</p>
                                <p className="text-xs text-dobro-cinza-escuro/70">{dashboard.student.email}</p>
                            </article>
                            <article className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/20 p-3">
                                <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Rank atual</p>
                                <p className="mt-1 font-mono text-xl font-semibold">{dashboard.student.rank}</p>
                            </article>
                            <article className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/20 p-3">
                                <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Vagas aplicadas</p>
                                <p className="mt-1 font-mono text-xl font-semibold">{dashboard.student.appliedJobsCount.toLocaleString('pt-BR')}</p>
                                <p className="mt-1 text-xs text-dobro-cinza-escuro/70">Último acesso: {formatDateTime(dashboard.student.lastAccessAt)}</p>
                            </article>
                        </div>
                    )}
                </form>
            </section>

            <section className="space-y-3">
                <h2 className="font-titulo text-xl font-semibold">Vagas</h2>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Na plataforma</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.jobs.total.toLocaleString('pt-BR')}</p>
                    </article>
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Entraram 24h</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.jobs.enteredLast24h.toLocaleString('pt-BR')}</p>
                    </article>
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Entraram 7 dias</p>
                        <p className="mt-1 font-mono text-2xl font-semibold">{dashboard.jobs.enteredLast7d.toLocaleString('pt-BR')}</p>
                        <p className="mt-1 text-xs text-dobro-cinza-escuro/70">Meta semanal: {weeklyProgressLabel} ({dashboard.jobs.weeklyGoalProgressPct}%)</p>
                    </article>
                    <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-3">
                        <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Disponibilidade</p>
                        <p className="mt-1 text-sm">
                            <span className="font-semibold text-emerald-700">{dashboard.jobs.available.toLocaleString('pt-BR')}</span> disponíveis
                        </p>
                        <p className="text-sm">
                            <span className="font-semibold text-red-700">{dashboard.jobs.unavailable.toLocaleString('pt-BR')}</span> indisponíveis
                        </p>
                    </article>
                </div>

                <article className="rounded-lg border border-[#333] bg-[#1a1a1a] p-4">
                    <h3 className="font-titulo text-lg font-semibold">Stacks mais pedidas</h3>
                    {dashboard.jobs.topStacks.length === 0 ? (
                        <p className="mt-2 text-sm text-dobro-cinza-escuro/70">Sem stacks cadastradas nas vagas atuais.</p>
                    ) : (
                        <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                            {dashboard.jobs.topStacks.map((s) => (
                                <li key={s.stack} className="flex items-center justify-between rounded border border-dobro-cinza-escuro/10 px-3 py-2">
                                    <span className="font-mono text-sm uppercase">{s.stack}</span>
                                    <span className="font-mono text-sm font-semibold">{s.count.toLocaleString('pt-BR')}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </article>
            </section>
        </section>
    );
}
