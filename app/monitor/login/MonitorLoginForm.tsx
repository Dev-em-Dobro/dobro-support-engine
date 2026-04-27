'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputCls =
  'rounded-md border border-dobro-cinza-escuro/15 bg-dobro-cinza-claro/40 px-3.5 py-2.5 text-dobro-cinza-escuro placeholder:text-dobro-cinza-escuro/40 focus:border-dobro-azul focus:bg-white focus:outline-none focus:ring-2 focus:ring-dobro-azul/20 transition-colors';

const labelTitleCls = 'font-titulo text-sm font-semibold';

export function MonitorLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/monitor/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || 'Falha no login');
        setLoading(false);
        return;
      }
      router.push('/monitor/dashboard');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className={labelTitleCls}>Email</span>
        <input
          type="email"
          required
          placeholder="voce@devemdobro.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelTitleCls}>Senha</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </label>
      {err && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
          {err}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-md bg-dobro-azul px-5 py-3 font-titulo text-sm font-bold uppercase tracking-wide text-white shadow-sm hover:bg-dobro-azul/90 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
