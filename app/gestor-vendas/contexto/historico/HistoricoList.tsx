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
      <p className="rounded-md bg-dobro-cinza-escuro/5 px-4 py-3 text-sm text-dobro-cinza-escuro/60">
        Nenhuma versão registrada ainda. O histórico começa a partir da próxima edição.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {status && (
        <div
          className={`rounded-md px-4 py-3 text-sm ${
            status.type === 'error'
              ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
              : 'bg-green-50 text-green-700 ring-1 ring-green-200'
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
              className="rounded-xl border border-dobro-cinza-escuro/10 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-bold">v{v.version}</span>
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      em uso
                    </span>
                  )}
                  <span className="ml-2 text-dobro-cinza-escuro/50">
                    {new Date(v.editedAt).toLocaleString('pt-BR')}
                    {v.editedByEmail ? ` · ${v.editedByEmail}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(v.version)}
                  disabled={isCurrent || restoring !== null}
                  className="shrink-0 rounded-lg border border-dobro-azul px-3 py-1.5 text-xs font-bold text-dobro-azul hover:bg-dobro-azul/5 disabled:opacity-40 transition-colors"
                >
                  {restoring === v.version ? 'Restaurando...' : 'Restaurar'}
                </button>
              </div>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-dobro-cinza-escuro/5 px-3 py-2 text-xs text-dobro-cinza-escuro/80">
                {v.value.trim() || '(vazio)'}
              </pre>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
