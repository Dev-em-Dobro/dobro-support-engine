import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { MonitorLoginForm } from '@/app/monitor/login/MonitorLoginForm';

export const metadata = { title: 'Login Gestor de Vendas · Dev em Dobro' };

// Tela de login dedicada do Gestor de Vendas. Reusa o MonitorLoginForm — ou
// seja, a MESMA autenticação do monitor (com 2FA), porque o gestor é a conta
// que controla o prompt do agente e precisa dessa proteção. A única diferença
// é o destino pós-login (/gestor-vendas) e o texto da tela.
export default async function GestorLoginPage() {
  const session = await getSession();
  // Já logado como gestor/monitor? Pula direto pro painel.
  if (session?.role === 'monitor') redirect('/gestor-vendas');

  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col gap-3">
        <span className="ds-badge ds-badge-roxo-soft self-start uppercase tracking-wide">
          Gestor de Vendas
        </span>
        <h1 className="ds-subtitle text-[28px]">Painel do Gestor de Vendas</h1>
        <p className="ds-text">
          Acesso restrito a quem gerencia a base de conhecimento e o contexto do agente de vendas.
        </p>
      </div>

      <div className="ds-card p-6 md:p-8">
        <MonitorLoginForm redirectTo="/gestor-vendas" />
      </div>
    </section>
  );
}
