'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const inputCls =
  'rounded-md border border-[#333] bg-[#1a1a1a] px-3.5 py-2.5 text-white placeholder:text-white/40 focus:border-[#6528d3] focus:outline-none focus:ring-2 focus:ring-[#6528d3]/20 transition-colors';

const labelTitleCls = 'font-titulo text-sm font-semibold text-white';
const helpCls = 'text-xs text-white/60';

export default function SubmitForm() {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState('');
  const [deployedUrl, setDeployedUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/correcoes/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubUrl: githubUrl.trim(),
          deployedUrl: deployedUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || 'Falha ao enviar');
        setLoading(false);
        return;
      }
      const data = await res.json();
      // Redirect to the live correction page. The AI pipeline is already
      // running in the background via waitUntil — the live view will poll
      // for status and render as soon as it's ready.
      router.push(`/correcoes/${data.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelTitleCls}>Link do GitHub</span>
        <input
          type="url"
          required
          placeholder="https://github.com/seu-usuario/seu-repo"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          className={inputCls}
        />
        <span className={helpCls}>Cola a URL do repositório público do seu desafio.</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelTitleCls}>
          Link do deploy <span className="font-normal text-white/50">(opcional)</span>
        </span>
        <input
          type="url"
          placeholder="https://seu-desafio.vercel.app"
          value={deployedUrl}
          onChange={(e) => setDeployedUrl(e.target.value)}
          className={inputCls}
        />
      </label>

      {err && (
        <p className="rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-sm text-[#fca5a5]">
          {err}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="ds-btn ds-btn-primary mt-1 px-5 py-3 text-sm uppercase tracking-wide"
      >
        {loading ? 'Enviando...' : 'Corrigir meu desafio'}
      </button>
      <p className={helpCls}>
        A correção aparece aqui mesmo em cerca de 1 minuto. Pode deixar a aba aberta.
      </p>
    </form>
  );
}
