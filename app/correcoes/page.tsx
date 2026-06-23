import Link from 'next/link';

export default function CorrecoesHomePage() {
  return (
    <section className="flex flex-col gap-4 py-8">
      <h1 className="ds-subtitle text-[28px]">
        Correção de Desafios
      </h1>
      <p className="ds-text">
        Submeta um desafio ou acompanhe o status das suas correções.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/correcoes/submit" className="ds-btn ds-btn-primary">
          Enviar novo desafio
        </Link>
        <Link href="/correcoes/minhas-correcoes" className="ds-btn ds-btn-secondary">
          Minhas correções
        </Link>
      </div>
    </section>
  );
}
