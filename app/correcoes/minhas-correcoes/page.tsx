import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asStudent } from '@/lib/db-context';
import { submissions } from '@/drizzle/schema';
function studentStatusLabel(status: string): string {
  if (status === 'failed' || status === 'rejected') return 'Falha';
  if (
    status === 'delivered' ||
    status === 'approved' ||
    status === 'draft'
  ) {
    return 'Corrigido';
  }
  return 'Gerando';
}

function studentStatusBadge(status: string): string {
  if (status === 'failed' || status === 'rejected') {
    return 'bg-[#ef4444]/15 text-[#fca5a5]';
  }
  if (
    status === 'delivered' ||
    status === 'approved' ||
    status === 'draft'
  ) {
    return 'bg-[#22c55e]/15 text-[#6ee7b7]';
  }
  return 'bg-[#3b82f6]/15 text-[#93c5fd]';
}

export const metadata = { title: 'Minhas correções · Dobro Support' };

export default async function MinhasCorrecoesPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'student') {
    redirect('/entrar?next=/correcoes/minhas-correcoes');
  }

  const rows = await asStudent(session.email, async (tx) =>
    tx
      .select()
      .from(submissions)
      .orderBy(desc(submissions.submittedAt))
  );

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="ds-subtitle text-[28px]">
            Minhas correções
          </h1>
          <p className="ds-text-sm">
            Histórico das suas submissões.
          </p>
        </div>
        <Link
          href="/correcoes/submit"
          className="ds-btn ds-btn-primary px-4 py-2 text-sm"
        >
          + Enviar novo desafio
        </Link>
      </div>

      {searchParams.ok && (
        <div className="rounded-md border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-3 text-sm text-[#6ee7b7]">
          Desafio enviado. A gente avisa aqui quando a correção sair.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="ds-card p-8 text-center">
          <p className="ds-text-sm">
            Você ainda não enviou nenhum desafio.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="ds-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <a
                  href={row.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-white hover:text-[#6528d3] hover:underline"
                >
                  {row.githubUrl.replace('https://github.com/', '')}
                </a>
                <span className="text-xs text-white/60">
                  Enviado em{' '}
                  {new Date(row.submittedAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${studentStatusBadge(row.status)}`}
                >
                  {studentStatusLabel(row.status)}
                </span>
                {row.status !== 'failed' && row.status !== 'rejected' && (
                  <Link
                    href={`/correcoes/${row.id}`}
                    className="text-sm font-medium text-[#6528d3] hover:underline"
                  >
                    Ver correção →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
