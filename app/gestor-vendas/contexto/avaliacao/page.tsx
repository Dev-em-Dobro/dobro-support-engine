import { redirect } from 'next/navigation';
import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { salesEvalRuns, salesEvalBaseline } from '@/drizzle/schema';
import { EVAL_QUESTIONS } from '@/lib/sales-eval-questions';
import { EvalPanel } from './EvalPanel';

export const metadata = { title: 'Avaliação do Agente · Gestor de Vendas' };

export default async function AvaliacaoPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

  const [runs, baseline] = await Promise.all([
    asMonitor(session.email, async (tx) =>
      tx
        .select({
          id: salesEvalRuns.id,
          trigger: salesEvalRuns.trigger,
          questionCount: salesEvalRuns.questionCount,
          avgDivergence: salesEvalRuns.avgDivergence,
          maxDivergence: salesEvalRuns.maxDivergence,
          flagged: salesEvalRuns.flagged,
          isBaseline: salesEvalRuns.isBaseline,
          createdAt: salesEvalRuns.createdAt,
        })
        .from(salesEvalRuns)
        .orderBy(desc(salesEvalRuns.createdAt))
        .limit(20)
    ),
    asMonitor(session.email, async (tx) =>
      tx.select({ questionId: salesEvalBaseline.questionId }).from(salesEvalBaseline)
    ),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/gestor-vendas/contexto" className="text-sm text-dobro-azul hover:underline">
        ← Voltar ao contexto
      </Link>
      <h1 className="mt-2 font-titulo text-2xl font-bold">Avaliação do Agente</h1>
      <p className="mt-2 text-sm text-dobro-cinza-escuro/70">
        Roda {EVAL_QUESTIONS.length} perguntas canônicas contra o agente e compara as respostas com
        um baseline confiável. Divergência alta indica que o comportamento mudou — útil pra flagrar
        um <strong>contexto envenenado</strong> que o filtro de texto não pega.
      </p>

      <div className="mt-6">
        <EvalPanel
          hasBaseline={baseline.length > 0}
          runs={runs.map((r) => ({
            id: r.id,
            trigger: r.trigger,
            questionCount: r.questionCount,
            avgDivergence: r.avgDivergence,
            maxDivergence: r.maxDivergence,
            flagged: r.flagged,
            isBaseline: r.isBaseline,
            createdAt: new Date(r.createdAt).toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
