'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputCls =
  'rounded-md border border-[#333] bg-[#1a1a1a] px-3.5 py-2.5 text-white placeholder:text-white/40 focus:border-[#6528d3] focus:outline-none focus:ring-2 focus:ring-[#6528d3]/20 transition-colors';

const labelTitleCls = 'font-titulo text-sm font-semibold text-white';

export function SalesLoginForm() {
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
      const res = await fetch('/api/vendas/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || 'Falha no login');
        setLoading(false);
        return;
      }
      router.push('/vendas');
      router.refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        setErr('Login demorou demais para responder. Tenta novamente.');
      } else {
        setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      }
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
        <p className="rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-sm text-[#fca5a5]">
          {err}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="ds-btn ds-btn-primary mt-1 px-5 py-3 text-sm uppercase tracking-wide"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
