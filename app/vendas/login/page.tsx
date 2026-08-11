import { SalesLoginForm } from './SalesLoginForm';

export const metadata = { title: 'Agente de Vendas · Dev em Dobro' };

export default function SalesLoginPage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col gap-3">
        <span className="ds-badge ds-badge-roxo-soft self-start uppercase tracking-wide">
          Agente de Vendas
        </span>
        <h1 className="ds-subtitle text-[28px]">
          Bem-vindo ao Agente de Vendas
        </h1>
        <p className="ds-text">
          Acesso exclusivo para o time comercial Dev em Dobro.
        </p>
      </div>

      <div className="ds-card p-6 md:p-8">
        <SalesLoginForm />
      </div>
    </section>
  );
}
