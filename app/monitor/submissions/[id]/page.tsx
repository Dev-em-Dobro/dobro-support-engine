import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { submissions, corrections, monitorActions } from '@/drizzle/schema';
import { statusBadge, statusLabel } from '@/lib/status';
import { CorrectionEditor } from './CorrectionEditor';

export const metadata = { title: 'Revisar correção · Dobro Support' };

function ArrowLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function ExternalLink() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.11.79-.25.79-.55 0-.27-.01-1-.02-1.96-3.2.7-3.88-1.54-3.88-1.54-.52-1.32-1.28-1.67-1.28-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.14 1.17.91-.25 1.89-.38 2.86-.38s1.95.13 2.86.38c2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .3.21.67.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function ActionDot({ action }: { action: string }) {
  const color =
    action === 'approve' ? 'bg-emerald-500'
    : action === 'reject' ? 'bg-red-500'
    : action === 'ai_generate' ? 'bg-dobro-laranja'
    : 'bg-white/40';
  return <span className={`h-1.5 w-1.5 rounded-full ${color}`} aria-hidden />;
}

export default async function MonitorSubmissionPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'monitor') {
    redirect('/monitor/login');
  }

  const data = await asMonitor(session.email, async (tx) => {
    const sub = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, params.id))
      .limit(1);
    if (sub.length === 0) return null;
    const corr = await tx
      .select()
      .from(corrections)
      .where(eq(corrections.submissionId, params.id))
      .limit(1);
    const actions = await tx
      .select()
      .from(monitorActions)
      .where(eq(monitorActions.submissionId, params.id))
      .orderBy(desc(monitorActions.createdAt));
    return { submission: sub[0], correction: corr[0] || null, actions };
  });

  if (!data) notFound();

  const { submission, correction, actions } = data;
  const submittedAt = new Date(submission.submittedAt);
  const submittedAtStr = submittedAt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 py-2 lg:py-6">
      <nav>
        <Link
          href="/monitor/dashboard"
          className="group inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full border border-white/10 transition-all group-hover:-translate-x-0.5 group-hover:border-white/30">
            <ArrowLeft />
          </span>
          Voltar ao dashboard
        </Link>
      </nav>

      <header className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/40">
            Submissão · {submission.id.slice(0, 8)}
          </p>
          <h1 className="font-titulo text-3xl font-bold tracking-tight text-white md:text-[2.6rem] md:leading-[1.05]">
            {submission.studentEmail}
          </h1>
          <p className="max-w-[60ch] text-sm leading-relaxed text-white/60">
            Revise o código entregue, componha a correção — nota, pontos fortes,
            sugestões detalhadas e feedback narrativo — e entregue ao aluno.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusBadge(submission.status)}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
              {statusLabel(submission.status)}
            </span>
            <span className="font-mono text-[11px] text-white/40">
              {submittedAtStr}
            </span>
          </div>
        </div>

        <aside className="flex h-fit flex-col divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-white/[0.02]">
          <div className="px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              Links da submissão
            </p>
          </div>
          <a
            href={submission.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/70 transition-colors group-hover:border-white/25 group-hover:text-white">
              <GithubMark />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wider text-white/40">Repositório</p>
              <p className="truncate font-mono text-xs text-white/80">
                {submission.githubUrl.replace(/^https?:\/\//, '')}
              </p>
            </div>
            <span className="text-white/30 transition-colors group-hover:text-white/70">
              <ExternalLink />
            </span>
          </a>
          {submission.deployedUrl && (
            <a
              href={submission.deployedUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/70 transition-colors group-hover:border-white/25 group-hover:text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wider text-white/40">Deploy</p>
                <p className="truncate font-mono text-xs text-white/80">
                  {submission.deployedUrl.replace(/^https?:\/\//, '')}
                </p>
              </div>
              <span className="text-white/30 transition-colors group-hover:text-white/70">
                <ExternalLink />
              </span>
            </a>
          )}
        </aside>
      </header>

      <CorrectionEditor
        submissionId={submission.id}
        submissionStatus={submission.status}
        correction={correction}
      />

      {actions.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="font-titulo text-lg font-semibold tracking-tight text-white">
              Histórico
            </h2>
            <span className="font-mono text-[11px] text-white/30">
              {actions.length.toString().padStart(2, '0')} eventos
            </span>
          </div>
          <ol className="flex flex-col divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-white/[0.015]">
            {actions.map((a) => (
              <li key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                <ActionDot action={a.action} />
                <span className="text-sm font-medium text-white/85">{a.action}</span>
                <span className="text-xs text-white/45">por</span>
                <span className="truncate font-mono text-xs text-white/70">
                  {a.monitorEmail}
                </span>
                <span className="ml-auto font-mono text-[11px] text-white/35">
                  {new Date(a.createdAt).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
