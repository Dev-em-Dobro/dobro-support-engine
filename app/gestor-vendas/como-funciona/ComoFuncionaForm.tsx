'use client';

import { useState } from 'react';

const MAX_LEN = 20000;

interface Props {
  initialValue: string;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

export function ComoFuncionaForm({ initialValue, updatedAt, updatedByEmail }: Props) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(updatedAt);
  const [lastSavedBy, setLastSavedBy] = useState<string | null>(updatedByEmail);
  const [showPreview, setShowPreview] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus(null);

    try {
      const res = await fetch('/api/gestor-vendas/como-funciona', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: 'error', msg: data.error ?? 'Falha ao salvar' });
      } else {
        setStatus({ type: 'success', msg: 'Salvo. Vendedores verão a nova versão no próximo acesso a /vendas/como-funciona.' });
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
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
          {showPreview ? 'Preview' : 'Editor'}
        </span>
        <button
          type="button"
          onClick={() => setShowPreview((s) => !s)}
          className="text-sm text-[#6528d3] hover:underline"
        >
          {showPreview ? 'Editar' : 'Ver preview'}
        </button>
      </div>

      {showPreview ? (
        <div className="min-h-[14rem] whitespace-pre-wrap rounded-md border border-[#333] bg-[#1a1a1a] px-4 py-3 text-sm text-white/90">
          {value || (
            <span className="text-white/40">Nada escrito ainda.</span>
          )}
        </div>
      ) : (
        <textarea
          rows={18}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Ex:\n\n# Como funciona o Chat de Vendas\n\nO agente responde dúvidas com base apenas nos documentos que o gestor cadastrou. Se ele não souber, vai responder que não encontrou — não invente.\n\n## Dicas\n- Comece nova conversa pra cada cliente diferente\n- Use perguntas específicas\n- Se a resposta parecer errada, reporta no Slack #vendas`}
          className="w-full resize-y rounded-md border border-[#333] bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-[#6528d3] focus:outline-none focus:ring-2 focus:ring-[#6528d3]/20 transition-colors font-mono"
        />
      )}

      <div className="flex items-center justify-between text-xs">
        <span className={over ? 'text-[#fca5a5]' : 'text-white/50'}>
          {value.length} / {MAX_LEN}
        </span>
        {lastSavedAt && (
          <span className="text-white/50">
            Última edição: {new Date(lastSavedAt).toLocaleString('pt-BR')}
            {lastSavedBy ? ` por ${lastSavedBy}` : ''}
          </span>
        )}
      </div>

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

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || over}
          className="ds-btn ds-btn-primary px-5 py-2.5 text-sm"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
