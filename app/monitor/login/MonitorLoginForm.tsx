'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const inputCls =
  'rounded-md border border-[#333] bg-[#1a1a1a] px-3.5 py-2.5 text-white placeholder:text-white/40 focus:border-[#6528d3] focus:outline-none focus:ring-2 focus:ring-[#6528d3]/20 transition-colors';

const labelTitleCls = 'font-titulo text-sm font-semibold text-white';

// `redirectTo` define pra onde mandar após o login completo. O monitor de
// correções vai pro /monitor/dashboard (default); o gestor de vendas reusa
// este mesmo form (mesma auth + 2FA) apontando pro /gestor-vendas.
export function MonitorLoginForm({
  redirectTo = '/monitor/dashboard',
}: {
  redirectTo?: string;
} = {}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Quando o login por senha responde requires2fa, trocamos pra etapa do código.
  const [step, setStep] = useState<'credentials' | 'code'>('credentials');
  const [code, setCode] = useState('');

  function goToDestination() {
    router.push(redirectTo);
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
      goToDestination();
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
      goToDestination();
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
          <p className="text-sm text-white/70">
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
          <p className="rounded-md border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-sm text-[#fca5a5]">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="ds-btn ds-btn-primary mt-1 px-5 py-3 text-sm uppercase tracking-wide"
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
