'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Run {
  id: string;
  trigger: string;
  questionCount: number;
  avgDivergence: string | null;
  maxDivergence: string | null;
  flagged: boolean;
  isBaseline: boolean;
  createdAt: string;
}

interface Props {
  hasBaseline: boolean;
  runs: Run[];
}

function pct(v: string | null): string {
  if (v === null) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

export function EvalPanel({ hasBaseline, runs }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<'run' | 'baseline' | null>(null);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  async function run(baseline: boolean) {
    if (loading) return;
    if (baseline && !confirm('Regravar o baseline com as respostas atuais? Só faça isso com o agente sabidamente íntegro.')) {
      return;
    }
    setLoading(baseline ? 'baseline' : 'run');
    setStatus(null);
    try {
      const res = await fetch('/api/gestor-vendas/sales-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseline }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: 'error', msg: data.error ?? 'Falha ao rodar' });
      } else if (data.summary?.isBaseline) {
        setStatus({ type: 'success', msg: 'Baseline gravado com as respostas atuais.' });
        router.refresh();
      } else {
        const s = data.summary;
        setStatus({
          type: s.flagged ? 'error' : 'success',
          msg: s.flagged
            ? `⚠️ Divergência acima do limite (média ${(s.avgDivergence * 100).toFixed(1)}%, máx ${(s.maxDivergence * 100).toFixed(1)}%). Revise o contexto.`
            : `OK — divergência média ${(s.avgDivergence * 100).toFixed(1)}%, máx ${(s.maxDivergence * 100).toFixed(1)}%.`,
        });
        router.refresh();
      }
    } catch {
      setStatus({ type: 'error', msg: 'Falha de conexão.' });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={loading !== null || !hasBaseline}
          className="ds-btn ds-btn-primary px-5 py-2.5 text-sm"
        >
          {loading === 'run' ? 'Rodando...' : 'Rodar avaliação'}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={loading !== null}
          className="rounded-lg border border-[#333] px-5 py-2.5 text-sm font-bold text-white/80 hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          {loading === 'baseline' ? 'Gravando...' : hasBaseline ? 'Regravar baseline' : 'Definir baseline'}
        </button>
        {!hasBaseline && (
          <span className="text-xs text-white/60">
            Defina o baseline primeiro pra habilitar a avaliação.
          </span>
        )}
      </div>

      <p className="text-xs text-white/50">
        A avaliação faz várias chamadas à OpenAI e pode levar até ~1 minuto.
      </p>

      {status && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            status.type === 'error'
              ? 'border-[#ef4444]/40 bg-[#ef4444]/10 text-[#fca5a5]'
              : 'border-[#22c55e]/40 bg-[#22c55e]/10 text-[#6ee7b7]'
          }`}
        >
          {status.msg}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#333] bg-[#0d0d0d] shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#1a1a1a] text-left text-xs uppercase tracking-wider text-white/60">
            <tr>
              <th className="px-4 py-2 font-semibold">Quando</th>
              <th className="px-4 py-2 font-semibold">Gatilho</th>
              <th className="px-4 py-2 font-semibold">Média</th>
              <th className="px-4 py-2 font-semibold">Máx</th>
              <th className="px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-white/50">
                  Nenhuma execução ainda.
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-4 py-2 text-white/70">
                    {new Date(r.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-2 text-white/70">{r.trigger}</td>
                  <td className="px-4 py-2 font-mono text-white/80">{pct(r.avgDivergence)}</td>
                  <td className="px-4 py-2 font-mono text-white/80">{pct(r.maxDivergence)}</td>
                  <td className="px-4 py-2">
                    {r.isBaseline ? (
                      <span className="rounded-full bg-[#6528d3]/15 px-2 py-0.5 text-xs font-medium text-[#a78bfa]">
                        baseline
                      </span>
                    ) : r.flagged ? (
                      <span className="rounded-full bg-[#ef4444]/15 px-2 py-0.5 text-xs font-medium text-[#fca5a5]">
                        alerta
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#22c55e]/15 px-2 py-0.5 text-xs font-medium text-[#6ee7b7]">
                        ok
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
