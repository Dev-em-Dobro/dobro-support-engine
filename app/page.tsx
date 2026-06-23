import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="flex flex-col items-start gap-6 py-10">
      <span className="ds-badge-label !mb-0">
        Plataforma de suporte do Dev em Dobro_
      </span>
      <h1 className="ds-title max-w-3xl">
        Seu desafio corrigido com o padrão de qualidade da{' '}
        <span className="text-[#6528d3]">Dobro</span>.
      </h1>
      <p className="ds-text max-w-2xl">
        Envie a URL do seu repositório no GitHub e receba uma correção em segundos, detalhada
        com nota, pontos fortes e melhorias sugeridas.
      </p>
      <Link href="/correcoes/submit" className="ds-btn ds-btn-primary">
        Enviar desafio para correção
      </Link>
    </section>
  );
}
