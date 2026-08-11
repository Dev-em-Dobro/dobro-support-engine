'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SourceType = 'pdf' | 'markdown' | 'faq';

interface FaqPair {
  question: string;
  answer: string;
}

const inputCls =
  'w-full rounded-md border border-[#333] bg-[#1a1a1a] px-3.5 py-2.5 text-white placeholder:text-white/40 focus:border-[#6528d3] focus:outline-none focus:ring-2 focus:ring-[#6528d3]/20 transition-colors text-sm';

export function KbDocumentForm() {
  const router = useRouter();
  const [tab, setTab] = useState<SourceType>('pdf');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [markdownContent, setMarkdownContent] = useState('');
  const [faqPairs, setFaqPairs] = useState<FaqPair[]>([{ question: '', answer: '' }]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; msg: string } | null>(null);

  function addFaqPair() {
    setFaqPairs((prev) => [...prev, { question: '', answer: '' }]);
  }

  function updateFaqPair(i: number, field: 'question' | 'answer', value: string) {
    setFaqPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  }

  function removeFaqPair(i: number) {
    setFaqPairs((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const form = new FormData();
    form.append('title', title.trim());
    form.append('sourceType', tab);
    form.append('description', description.trim());
    form.append('tags', tags.trim());

    if (tab === 'pdf') {
      if (!pdfFile) {
        setStatus({ type: 'error', msg: 'Selecione um arquivo PDF' });
        setLoading(false);
        return;
      }
      form.append('file', pdfFile);
    } else if (tab === 'markdown') {
      form.append('content', markdownContent.trim());
    } else {
      const valid = faqPairs.filter((p) => p.question.trim() && p.answer.trim());
      if (!valid.length) {
        setStatus({ type: 'error', msg: 'Adicione ao menos um par pergunta/resposta' });
        setLoading(false);
        return;
      }
      form.append('faqPairs', JSON.stringify(valid));
    }

    try {
      const res = await fetch('/api/monitor/vendas/kb/documents', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: 'error', msg: data.error ?? 'Erro ao cadastrar documento' });
        setLoading(false);
        return;
      }

      setStatus({ type: 'success', msg: `Documento cadastrado! ${data.chunkCount} chunks gerados.` });
      setTimeout(() => router.push('/monitor/vendas/knowledge-base'), 1500);
    } catch {
      setStatus({ type: 'error', msg: 'Falha de conexão. Tenta novamente.' });
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex rounded-lg border border-[#333] overflow-hidden">
        {(['pdf', 'markdown', 'faq'] as SourceType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === t
                ? 'bg-[#6528d3] text-white'
                : 'bg-[#1a1a1a] text-white/70 hover:bg-white/5'
            }`}
          >
            {t === 'pdf' ? 'PDF' : t === 'markdown' ? 'Markdown' : 'FAQ'}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Título *</span>
        <input
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Kit de Lançamento DevQuest 5.0"
          className={inputCls}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Descrição (opcional)</span>
        <textarea
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição breve do documento..."
          className={inputCls}
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Tags (opcional)</span>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="lançamento, devquest, preços (separadas por vírgula)"
          className={inputCls}
        />
      </label>

      {tab === 'pdf' && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Arquivo PDF * (máx 5MB)</span>
          <input
            type="file"
            accept="application/pdf"
            required
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-white/80 file:mr-4 file:rounded-md file:border-0 file:bg-[#6528d3]/15 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#a78bfa] hover:file:bg-[#6528d3]/25"
          />
        </label>
      )}

      {tab === 'markdown' && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Conteúdo Markdown *</span>
          <textarea
            required
            rows={12}
            value={markdownContent}
            onChange={(e) => setMarkdownContent(e.target.value)}
            placeholder="Cole ou escreva o conteúdo em Markdown aqui..."
            className={`${inputCls} font-mono`}
          />
        </label>
      )}

      {tab === 'faq' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Pares Pergunta / Resposta *</span>
            <button
              type="button"
              onClick={addFaqPair}
              className="text-sm text-[#6528d3] hover:underline"
            >
              + Adicionar par
            </button>
          </div>
          {faqPairs.map((pair, i) => (
            <div key={i} className="rounded-lg border border-[#333] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/50">Par {i + 1}</span>
                {faqPairs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeFaqPair(i)}
                    className="text-xs text-[#f87171] hover:underline"
                  >
                    Remover
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={pair.question}
                onChange={(e) => updateFaqPair(i, 'question', e.target.value)}
                placeholder="Pergunta"
                className={inputCls}
              />
              <textarea
                required
                rows={3}
                value={pair.answer}
                onChange={(e) => updateFaqPair(i, 'answer', e.target.value)}
                placeholder="Resposta"
                className={inputCls}
              />
            </div>
          ))}
        </div>
      )}

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

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 rounded-lg border border-[#333] py-2.5 text-sm font-semibold text-white/70 hover:bg-white/5 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 rounded-lg bg-[#6528d3] py-2.5 text-sm font-bold text-white hover:bg-[#5020b0] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Processando...' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}
