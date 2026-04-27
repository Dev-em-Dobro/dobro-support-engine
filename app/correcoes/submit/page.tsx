import dynamic from 'next/dynamic';

/** Carrega o formulário só no cliente — evita falha intermitente do webpack (`__webpack_require__.n`) em dev, comum com caminhos com espaço no Windows. */
const SubmitForm = dynamic(() => import('./SubmitForm'), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-dobro-cinza-escuro/60">Carregando formulário…</p>
  ),
});

export const metadata = { title: 'Enviar desafio · Dobro Support' };

export default function SubmitPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-3">
        <span className="inline-block self-start rounded-full bg-dobro-amarelo/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
          Correção DevQuest
        </span>
        <h1 className="font-titulo text-3xl font-bold md:text-4xl">
          Cola o link, recebe a correção na hora
        </h1>
        <p className="max-w-xl text-base text-dobro-cinza-escuro/80">
          Os agentes da Dobro leem seu código inteiro, corrigem com carinho e te
          devolvem a correção aqui nessa página em cerca de 1 minuto.
        </p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-dobro-cinza-escuro/10 md:p-8">
        <SubmitForm />
      </div>
    </section>
  );
}
