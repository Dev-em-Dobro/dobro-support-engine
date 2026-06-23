import dynamic from 'next/dynamic';

/** Carrega o formulário só no cliente — evita falha intermitente do webpack (`__webpack_require__.n`) em dev, comum com caminhos com espaço no Windows. */
const SubmitForm = dynamic(() => import('./SubmitForm'), {
  ssr: false,
  loading: () => (
    <p className="text-sm text-white/60">Carregando formulário…</p>
  ),
});

export const metadata = { title: 'Enviar desafio · Dobro Support' };

export default function SubmitPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 py-10">
      <div className="flex flex-col gap-3">
        <span className="ds-badge ds-badge-roxo-soft self-start uppercase tracking-wide">
          Correção DevQuest
        </span>
        <h1 className="ds-title">
          Cola o link, recebe a correção na hora
        </h1>
        <p className="ds-text max-w-xl">
          Os agentes da Dobro leem seu código inteiro, corrigem com carinho e te
          devolvem a correção aqui nessa página em cerca de 1 minuto.
        </p>
      </div>

      <div className="ds-card p-6 md:p-8">
        <SubmitForm />
      </div>
    </section>
  );
}
