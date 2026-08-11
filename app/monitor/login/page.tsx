import { MonitorLoginForm } from './MonitorLoginForm';

export const metadata = { title: 'Login monitor · Dobro Support' };

export default function MonitorLoginPage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col gap-3">
        <span className="ds-badge ds-badge-roxo-soft self-start uppercase tracking-wide">
          Área restrita
        </span>
        <h1 className="ds-subtitle text-[28px]">
          Login monitor
        </h1>
        <p className="ds-text">
          Acesso restrito à equipe de monitoria DevQuest.
        </p>
      </div>

      <div className="ds-card p-6 md:p-8">
        <MonitorLoginForm />
      </div>
    </section>
  );
}
