'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  currentValue: string;
  pendingValue: string;
  pendingByEmail: string | null;
  pendingAt: string | null;
  currentEmail: string;
}

export function PendingReview({
  currentValue,
  pendingValue,
  pendingByEmail,
  pendingAt,
  currentEmail,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // O autor da proposta não pode aprovar a própria mudança (regra two-eyes).
  const isAuthor = !!pendingByEmail && pendingByEmail === currentEmail;

  async function act(action: 'approve' | 'reject') {
    if (loading) return;
    if (action === 'reject' && !confirm('Descartar a proposta pendente?')) return;
    setLoading(action);
    setErr(null);
    try {
      const res = await fetch('/api/gestor-vendas/contexto/aprovar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'Falha na ação');
      } else {
        router.refresh();
      }
    } catch {
      setErr('Falha de conexão.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-xl border border-[#ff6b35]/30 bg-[#ff6b35]/10 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#ff6b35]/20 px-2 py-0.5 text-xs font-bold text-[#ff6b35]">
          aguardando aprovação
        </span>
        <span className="text-sm text-[#fdba74]">
          Proposta de {pendingByEmail ?? 'desconhecido'}
          {pendingAt ? ` · ${new Date(pendingAt).toLocaleString('pt-BR')}` : ''}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#fdba74]/80">
            Atual (no ar)
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-xs text-white/80">
            {currentValue.trim() || '(vazio)'}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#fdba74]/80">
            Proposto
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-xs text-white/80">
            {pendingValue.trim() || '(vazio)'}
          </pre>
        </div>
      </div>

      {err && (
        <p className="mt-3 rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-sm text-[#fca5a5]">
          {err}
        </p>
      )}

      {isAuthor ? (
        <p className="mt-4 text-sm text-[#fdba74]">
          Você é o autor desta proposta. A aprovação precisa ser feita por{' '}
          <strong>outro gestor</strong>. Você pode descartá-la abaixo.
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => act('approve')}
          disabled={isAuthor || loading !== null}
          className="ds-btn ds-btn-success px-5 py-2.5 text-sm"
        >
          {loading === 'approve' ? 'Aprovando...' : 'Aprovar e publicar'}
        </button>
        <button
          type="button"
          onClick={() => act('reject')}
          disabled={loading !== null}
          className="rounded-lg border border-[#ef4444]/50 px-5 py-2.5 text-sm font-bold text-[#fca5a5] hover:bg-[#ef4444]/10 disabled:opacity-40 transition-colors"
        >
          {loading === 'reject' ? 'Descartando...' : 'Descartar'}
        </button>
      </div>
    </div>
  );
}
