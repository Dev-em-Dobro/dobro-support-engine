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
      <div className="rounded border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800">
        <p className="font-semibold">Link enviado!</p>
        <p className="mt-1">
          {state.devLink ? 'Modo dev: use o link abaixo pra entrar direto.' : 'Confere seu email — pode ir pro spam.'}
        </p>
        {state.devLink && (
          <a
            href={state.devLink}
            className="mt-3 inline-block break-all rounded bg-dobro-laranja px-3 py-2 font-medium text-white hover:bg-dobro-laranja/90"
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
        <span className="font-medium">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@exemplo.com"
          className="rounded border border-dobro-cinza-escuro/20 px-3 py-2 focus:border-dobro-azul focus:outline-none focus:ring-1 focus:ring-dobro-azul"
        />
      </label>
      {state.kind === 'error' && (
        <p className="text-sm text-red-700">{state.msg}</p>
      )}
      <button
        type="submit"
        disabled={state.kind === 'loading'}
        className="rounded bg-dobro-azul px-4 py-2 font-medium text-white hover:bg-dobro-azul/90 disabled:opacity-50"
      >
        {state.kind === 'loading' ? 'Enviando...' : 'Receber link'}
      </button>
    </form>
  );
}
