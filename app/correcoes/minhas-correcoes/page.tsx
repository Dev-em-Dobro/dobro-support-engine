import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asStudent } from '@/lib/db-context';
import { submissions } from '@/drizzle/schema';
import { statusBadge, statusLabel } from '@/lib/status';

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
          <h1 className="font-titulo text-3xl font-bold">
            Minhas correções
          </h1>
          <p className="text-dobro-cinza-escuro/70">
            Histórico das suas submissões.
          </p>
        </div>
        <Link
          href="/correcoes/submit"
          className="rounded bg-dobro-laranja px-4 py-2 text-sm font-medium text-white hover:bg-dobro-laranja/90"
        >
          + Enviar novo desafio
        </Link>
      </div>

      {searchParams.ok && (
        <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Desafio enviado. A gente avisa aqui quando a correção sair.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/50 p-8 text-center">
          <p className="text-dobro-cinza-escuro/70">
            Você ainda não enviou nenhum desafio.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded border border-dobro-cinza-escuro/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <a
                  href={row.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                >
                  {row.githubUrl.replace('https://github.com/', '')}
                </a>
                <span className="text-xs text-dobro-cinza-escuro/60">
                  Enviado em{' '}
                  {new Date(row.submittedAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadge(
                    row.status
                  )}`}
                >
                  {statusLabel(row.status)}
                </span>
                {row.status === 'delivered' && (
                  <Link
                    href={`/correcoes/${row.id}`}
                    className="text-sm font-medium text-dobro-laranja hover:underline"
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
