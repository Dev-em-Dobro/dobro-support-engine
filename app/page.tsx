import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="flex flex-col items-start gap-6 py-10">
      <p className="inline-block rounded-full bg-dobro-amarelo/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
        Plataforma de suporte do Dev em Dobro
      </p>
      <h1 className="font-titulo text-4xl font-bold md:text-5xl">
        Seu desafio corrigido com o padrão de qualidade da Dobro.
      </h1>
      <p className="max-w-2xl text-lg text-dobro-cinza-escuro/80">
        Envie a URL do seu repositório no GitHub e receba uma correção em segundos, detalhada
        com nota, pontos fortes e melhorias sugeridas.
      </p>
      <Link
        href="/correcoes/submit"
        className="inline-flex items-center gap-2 rounded-md bg-dobro-laranja px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-dobro-laranja/90"
      >
        Enviar desafio para correção
      </Link>
    </section>
  );
}
