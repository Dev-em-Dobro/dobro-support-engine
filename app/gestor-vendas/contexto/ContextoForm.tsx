'use client';

import { useState } from 'react';

const MAX_LEN = 4000;

interface Props {
  initialValue: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
  requiresApproval?: boolean;
}

export function ContextoForm({ initialValue, updatedAt, updatedByEmail, requiresApproval }: Props) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(updatedAt);
  const [lastSavedBy, setLastSavedBy] = useState<string | null>(updatedByEmail);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus(null);

    try {
      const res = await fetch('/api/gestor-vendas/contexto', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: 'error', msg: data.error ?? 'Falha ao salvar' });
      } else if (data.pending) {
        setStatus({
          type: 'success',
          msg: 'Proposta enviada. Um segundo gestor precisa aprovar antes de entrar no ar. Recarregue a página para acompanhar.',
        });
      } else {
        setStatus({ type: 'success', msg: 'Salvo. O agente vai usar o novo contexto na próxima conversa.' });
        setLastSavedAt(new Date().toISOString());
        setLastSavedBy(null);
      }
    } catch {
      setStatus({ type: 'error', msg: 'Falha de conexão. Tenta de novo.' });
    } finally {
      setSaving(false);
    }
  }

  const over = value.length > MAX_LEN;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <textarea
        rows={14}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ex: Estamos no lançamento da DevQuest 6.0 (cupom DOBRO20 vale até 30/06). Priorize destacar a comunidade Discord e a mentoria do DevQuest+..."
        className="w-full resize-y rounded-md border border-dobro-cinza-escuro/15 bg-white px-3.5 py-2.5 text-sm text-dobro-cinza-escuro focus:border-dobro-azul focus:outline-none focus:ring-2 focus:ring-dobro-azul/20 transition-colors"
      />

      <div className="flex items-center justify-between text-xs">
        <span className={over ? 'text-red-600' : 'text-dobro-cinza-escuro/50'}>
          {value.length} / {MAX_LEN}
        </span>
        {lastSavedAt && (
          <span className="text-dobro-cinza-escuro/50">
            Última edição: {new Date(lastSavedAt).toLocaleString('pt-BR')}
            {lastSavedBy ? ` por ${lastSavedBy}` : ''}
          </span>
        )}
      </div>

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

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || over}
          className="rounded-lg bg-dobro-azul px-5 py-2.5 text-sm font-bold text-white hover:bg-dobro-azul/90 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Salvando...' : requiresApproval ? 'Enviar para aprovação' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
