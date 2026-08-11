'use client';

import { useState } from 'react';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'sent'; devLink?: string }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          res.status === 410 && data.message
            ? data.message
            : data.error || 'Erro ao pedir link';
        setState({ kind: 'error', msg });
        return;
      }
      setState({ kind: 'sent', devLink: data.devLink });
    } catch (err) {
      setState({
        kind: 'error',
        msg: err instanceof Error ? err.message : 'Erro desconhecido',
      });
    }
  }

  if (state.kind === 'sent') {
    return (
      <div className="rounded-md border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-4 text-sm text-[#6ee7b7]">
        <p className="font-semibold">Link enviado!</p>
        <p className="mt-1">
          {state.devLink ? 'Modo dev: use o link abaixo pra entrar direto.' : 'Confere seu email — pode ir pro spam.'}
        </p>
        {state.devLink && (
          <a
            href={state.devLink}
            className="mt-3 inline-block break-all rounded-md bg-[#6528d3] px-3 py-2 font-medium text-white transition-colors hover:bg-[#5020b0]"
          >
            {state.devLink}
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-white">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@exemplo.com"
          className="rounded-md border border-[#333] bg-[#1a1a1a] px-3 py-2 text-white placeholder:text-white/40 focus:border-[#6528d3] focus:outline-none focus:ring-1 focus:ring-[#6528d3]"
        />
      </label>
      {state.kind === 'error' && (
        <p className="text-sm text-[#fca5a5]">{state.msg}</p>
      )}
      <button
        type="submit"
        disabled={state.kind === 'loading'}
        className="ds-btn ds-btn-primary"
      >
        {state.kind === 'loading' ? 'Enviando...' : 'Receber link'}
      </button>
    </form>
  );
}
