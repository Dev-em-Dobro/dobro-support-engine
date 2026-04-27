import { MonitorLoginForm } from './MonitorLoginForm';

export const metadata = { title: 'Login monitor · Dobro Support' };

export default function MonitorLoginPage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col gap-3">
        <span className="inline-block self-start rounded-full bg-dobro-amarelo/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          Área restrita
        </span>
        <h1 className="font-titulo text-3xl font-bold md:text-4xl">
          Login monitor
        </h1>
        <p className="text-base text-dobro-cinza-escuro/80">
          Acesso restrito à equipe de monitoria DevQuest.
        </p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-dobro-cinza-escuro/10 md:p-8">
        <MonitorLoginForm />
      </div>
    </section>
  );
}
