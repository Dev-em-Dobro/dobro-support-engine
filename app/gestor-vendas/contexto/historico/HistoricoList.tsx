'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Version {
  version: number;
  value: string;
  editedByEmail: string | null;
  editedAt: string;
}

interface Props {
  versions: Version[];
  currentValue: string;
}

export function HistoricoList({ versions, currentValue }: Props) {
  const router = useRouter();
  const [restoring, setRestoring] = useState<number | null>(null);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  async function handleRestore(version: number) {
    if (restoring !== null) return;
    if (!confirm(`Restaurar a versão ${version}? O contexto atual será substituído.`)) return;
    setRestoring(version);
    setStatus(null);
    try {
      const res = await fetch('/api/gestor-vendas/contexto/historico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: 'error', msg: data.error ?? 'Falha ao restaurar' });
      } else {
        setStatus({ type: 'success', msg: `Versão ${version} restaurada.` });
        router.refresh();
      }
    } catch {
      setStatus({ type: 'error', msg: 'Falha de conexão. Tenta de novo.' });
    } finally {
      setRestoring(null);
    }
  }

  if (versions.length === 0) {
    return (
      <p className="rounded-md border border-[#333] bg-[#1a1a1a] px-4 py-3 text-sm text-white/60">
        Nenhuma versão registrada ainda. O histórico começa a partir da próxima edição.
      </p>
    );
  }

  return (
    <div className="space-y-4">
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

      <ul className="space-y-3">
        {versions.map((v) => {
          const isCurrent = v.value === currentValue;
          return (
            <li
              key={v.version}
              className="ds-card p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white">
                  <span className="font-bold">v{v.version}</span>
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-[#22c55e]/15 px-2 py-0.5 text-xs font-medium text-[#6ee7b7]">
                      em uso
                    </span>
                  )}
                  <span className="ml-2 text-white/50">
                    {new Date(v.editedAt).toLocaleString('pt-BR')}
                    {v.editedByEmail ? ` · ${v.editedByEmail}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(v.version)}
                  disabled={isCurrent || restoring !== null}
                  className="shrink-0 rounded-lg border border-[#6528d3] px-3 py-1.5 text-xs font-bold text-[#a78bfa] hover:bg-[#6528d3]/10 disabled:opacity-40 transition-colors"
                >
                  {restoring === v.version ? 'Restaurando...' : 'Restaurar'}
                </button>
              </div>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-xs text-white/80">
                {v.value.trim() || '(vazio)'}
              </pre>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
