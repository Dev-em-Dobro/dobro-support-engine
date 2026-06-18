'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputCls =
  'rounded-md border border-dobro-cinza-escuro/15 bg-dobro-cinza-claro/40 px-3.5 py-2.5 text-dobro-cinza-escuro placeholder:text-dobro-cinza-escuro/40 focus:border-dobro-azul focus:bg-dobro-cinza-claro/60 focus:outline-none focus:ring-2 focus:ring-dobro-azul/20 transition-colors';

const labelTitleCls = 'font-titulo text-sm font-semibold';

export function MonitorLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Quando o login por senha responde requires2fa, trocamos pra etapa do código.
  const [step, setStep] = useState<'credentials' | 'code'>('credentials');
  const [code, setCode] = useState('');

  function goToDashboard() {
    router.push('/monitor/dashboard');
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/monitor/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || 'Falha no login');
        setLoading(false);
        return;
      }
      if (data.requires2fa) {
        setStep('code');
        setLoading(false);
        return;
      }
      goToDashboard();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        setErr('Login demorou demais para responder. Tenta novamente.');
      } else {
        setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      }
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/monitor/login/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || 'Código incorreto');
        setLoading(false);
        return;
      }
      goToDashboard();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      setLoading(false);
    }
  }

  if (step === 'code') {
    return (
      <form onSubmit={handleVerifyCode} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className={labelTitleCls}>Verificação em duas etapas</span>
          <p className="text-sm text-dobro-cinza-escuro/70">
            Digite o código de 6 dígitos do seu app autenticador. Sem o app? Use um código de
            backup.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={labelTitleCls}>Código</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
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
          {loading ? 'Verificando...' : 'Verificar'}
        </button>
      </form>
    );
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
