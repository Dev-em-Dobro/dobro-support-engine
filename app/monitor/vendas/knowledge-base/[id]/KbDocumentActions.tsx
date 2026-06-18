'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  documentId: string;
  isArchived: boolean;
  hasVersion: boolean;
  sourceType: 'pdf' | 'markdown' | 'faq';
}

export function KbDocumentActions({ documentId, isArchived, hasVersion, sourceType }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [showReupload, setShowReupload] = useState(false);
  const [reuploadFile, setReuploadFile] = useState<File | null>(null);
  const [reuploadContent, setReuploadContent] = useState('');
  const [faqPairs, setFaqPairs] = useState([{ question: '', answer: '' }]);

  async function action(endpoint: string, method = 'POST') {
    setLoading(endpoint);
    try {
      const res = await fetch(`/api/monitor/vendas/kb/documents/${documentId}/${endpoint}`, { method });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Erro ao executar ação');
      } else {
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  async function handleReupload(e: React.FormEvent) {
    e.preventDefault();
    setLoading('reupload');
    const form = new FormData();

    if (sourceType === 'pdf') {
      if (!reuploadFile) { alert('Selecione um PDF'); setLoading(null); return; }
      form.append('file', reuploadFile);
    } else if (sourceType === 'markdown') {
      form.append('content', reuploadContent);
    } else {
      const valid = faqPairs.filter((p) => p.question.trim() && p.answer.trim());
      form.append('faqPairs', JSON.stringify(valid));
    }

    try {
      const res = await fetch(`/api/monitor/vendas/kb/documents/${documentId}/versions`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? 'Erro ao reenviar');
      } else {
        setShowReupload(false);
        router.refresh();
      }
    } finally {
      setLoading(null);
    }
  }

  const btnCls = 'rounded-lg border border-dobro-cinza-escuro/15 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-dobro-cinza-claro disabled:opacity-40';

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className={btnCls}
        disabled={!!loading}
        onClick={() => setShowReupload((o) => !o)}
      >
        Reenviar
      </button>
      {hasVersion && (
        <button
          className={btnCls}
          disabled={!!loading}
          onClick={() => action('reindex')}
        >
          {loading === 'reindex' ? 'Reprocessando...' : 'Reprocessar'}
        </button>
      )}
      {isArchived ? (
        <button
          className={`${btnCls} border-emerald-400 text-emerald-700`}
          disabled={!!loading}
          onClick={() => action('reactivate')}
        >
          {loading === 'reactivate' ? 'Reativando...' : 'Reativar'}
        </button>
      ) : (
        <button
          className={`${btnCls} border-red-200 text-red-600`}
          disabled={!!loading}
          onClick={() => {
            if (confirm('Arquivar este documento? Ele sairá do retrieval mas o histórico fica preservado.')) {
              action('archive');
            }
          }}
        >
          {loading === 'archive' ? 'Arquivando...' : 'Arquivar'}
        </button>
      )}

      {showReupload && (
        <div className="w-full mt-2 rounded-xl border border-dobro-cinza-escuro/10 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3">Reenviar nova versão</h3>
          <form onSubmit={handleReupload} className="space-y-3">
            {sourceType === 'pdf' && (
              <input
                type="file"
                accept="application/pdf"
                required
                onChange={(e) => setReuploadFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-dobro-cinza-escuro file:mr-4 file:rounded-md file:border-0 file:bg-dobro-azul/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-dobro-azul"
              />
            )}
            {sourceType === 'markdown' && (
              <textarea
                required
                rows={8}
                value={reuploadContent}
                onChange={(e) => setReuploadContent(e.target.value)}
                placeholder="Conteúdo Markdown..."
                className="w-full rounded-md border border-dobro-cinza-escuro/15 px-3 py-2 font-mono text-xs focus:border-dobro-azul focus:outline-none focus:ring-2 focus:ring-dobro-azul/20"
              />
            )}
            {sourceType === 'faq' && (
              <div className="space-y-2">
                {faqPairs.map((p, i) => (
                  <div key={i} className="space-y-1.5 rounded-lg border border-dobro-cinza-escuro/10 p-3">
                    <input
                      type="text"
                      value={p.question}
                      onChange={(e) => setFaqPairs((prev) => prev.map((x, idx) => idx === i ? { ...x, question: e.target.value } : x))}
                      placeholder="Pergunta"
                      className="w-full rounded border border-dobro-cinza-escuro/15 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-dobro-azul"
                    />
                    <textarea
                      value={p.answer}
                      onChange={(e) => setFaqPairs((prev) => prev.map((x, idx) => idx === i ? { ...x, answer: e.target.value } : x))}
                      placeholder="Resposta"
                      rows={2}
                      className="w-full rounded border border-dobro-cinza-escuro/15 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-dobro-azul"
                    />
                  </div>
                ))}
                <button type="button" onClick={() => setFaqPairs((p) => [...p, { question: '', answer: '' }])} className="text-xs text-dobro-azul hover:underline">
                  + Par
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowReupload(false)} className="flex-1 rounded-lg border border-dobro-cinza-escuro/15 py-2 text-xs font-semibold">
                Cancelar
              </button>
              <button type="submit" disabled={loading === 'reupload'} className="flex-1 rounded-lg bg-dobro-azul py-2 text-xs font-bold text-white disabled:opacity-50">
                {loading === 'reupload' ? 'Processando...' : 'Confirmar reenvio'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
