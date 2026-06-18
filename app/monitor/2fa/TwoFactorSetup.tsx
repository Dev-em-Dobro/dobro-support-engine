'use client';

import { useState } from 'react';

const inputCls =
  'rounded-md border border-dobro-cinza-escuro/15 bg-white px-3.5 py-2.5 text-sm text-dobro-cinza-escuro focus:border-dobro-azul focus:outline-none focus:ring-2 focus:ring-dobro-azul/20 transition-colors';
const btnPrimary =
  'rounded-lg bg-dobro-azul px-5 py-2.5 text-sm font-bold text-white hover:bg-dobro-azul/90 disabled:opacity-50 transition-colors';
const btnDanger =
  'rounded-lg border border-red-300 px-5 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors';

interface Props {
  initiallyEnabled: boolean;
  email: string;
}

export function TwoFactorSetup({ initiallyEnabled, email }: Props) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Enrollment
  const [enrolling, setEnrolling] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Disable
  const [disableCode, setDisableCode] = useState('');

  async function startEnroll() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/monitor/2fa/setup', { method: 'GET' });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'Falha ao iniciar');
      } else if (data.enabled) {
        setEnabled(true);
      } else {
        setSecret(data.secret);
        setUri(data.uri);
        setEnrolling(true);
      }
    } catch {
      setErr('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/monitor/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'Código incorreto');
      } else {
        setBackupCodes(data.backupCodes);
        setEnabled(true);
        setEnrolling(false);
        setSecret(null);
        setUri(null);
        setCode('');
      }
    } catch {
      setErr('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('Desabilitar o 2FA? Sua conta volta a depender só da senha.')) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/monitor/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'Código incorreto');
      } else {
        setEnabled(false);
        setDisableCode('');
      }
    } catch {
      setErr('Falha de conexão.');
    } finally {
      setLoading(false);
    }
  }

  const errBox = err && (
    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{err}</p>
  );

  // Tela de códigos de backup — mostrados uma única vez após habilitar.
  if (backupCodes) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700 ring-1 ring-green-200">
          2FA habilitado. Guarde os códigos de backup abaixo num lugar seguro —{' '}
          <strong>eles não serão exibidos de novo</strong>. Cada um funciona uma vez, caso você
          perca o app autenticador.
        </div>
        <ul className="grid grid-cols-2 gap-2 rounded-md bg-dobro-cinza-escuro/5 p-4 font-mono text-sm">
          {backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button type="button" className={btnPrimary} onClick={() => setBackupCodes(null)}>
          Guardei os códigos
        </button>
      </div>
    );
  }

  // Estado: habilitado.
  if (enabled && !enrolling) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            ativo
          </span>
          <span className="text-dobro-cinza-escuro/70">
            O login de <span className="font-mono">{email}</span> exige o código do app.
          </span>
        </div>
        <form onSubmit={disable} className="space-y-3 border-t border-dobro-cinza-escuro/10 pt-4">
          <p className="text-sm text-dobro-cinza-escuro/70">
            Pra desabilitar, confirme com um código atual (ou de backup):
          </p>
          <input
            type="text"
            inputMode="numeric"
            placeholder="123456"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            className={inputCls}
            required
          />
          {errBox}
          <button type="submit" disabled={loading} className={btnDanger}>
            {loading ? 'Desabilitando...' : 'Desabilitar 2FA'}
          </button>
        </form>
      </div>
    );
  }

  // Estado: enrollment em andamento.
  if (enrolling && secret) {
    return (
      <form onSubmit={confirmEnroll} className="space-y-4">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-dobro-cinza-escuro/80">
          <li>
            Abra seu app autenticador (Google Authenticator, Authy, 1Password…) e adicione uma
            conta nova por <strong>entrada manual</strong>.
          </li>
          <li>
            Cole/digite esta chave (conta: <span className="font-mono">{email}</span>):
            <div className="mt-1 select-all rounded-md bg-dobro-cinza-escuro/5 px-3 py-2 font-mono text-base tracking-wider">
              {secret}
            </div>
          </li>
          <li>Digite o código de 6 dígitos que o app gerar pra confirmar:</li>
        </ol>
        {uri && (
          <p className="break-all text-xs text-dobro-cinza-escuro/40">
            Ou importe via URI: <span className="font-mono">{uri}</span>
          </p>
        )}
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={inputCls}
          required
        />
        {errBox}
        <div className="flex gap-2">
          <button type="submit" disabled={loading} className={btnPrimary}>
            {loading ? 'Confirmando...' : 'Confirmar e ativar'}
          </button>
          <button
            type="button"
            className="rounded-lg px-4 py-2.5 text-sm text-dobro-cinza-escuro/60 hover:underline"
            onClick={() => {
              setEnrolling(false);
              setSecret(null);
              setUri(null);
              setCode('');
              setErr(null);
            }}
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  // Estado: desabilitado, sem enrollment iniciado.
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="rounded-full bg-dobro-cinza-escuro/10 px-2 py-0.5 text-xs font-medium text-dobro-cinza-escuro/60">
          inativo
        </span>
        <span className="text-dobro-cinza-escuro/70">O login usa só e-mail e senha.</span>
      </div>
      {errBox}
      <button type="button" disabled={loading} className={btnPrimary} onClick={startEnroll}>
        {loading ? 'Gerando...' : 'Ativar 2FA'}
      </button>
    </div>
  );
}
