import Link from 'next/link';

export default function CorrecoesHomePage() {
  return (
    <section className="flex flex-col gap-4 py-8">
      <h1 className="font-titulo text-3xl font-bold">
        Correção de Desafios
      </h1>
      <p className="text-dobro-cinza-escuro/80">
        Submeta um desafio ou acompanhe o status das suas correções.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/correcoes/submit"
          className="rounded-md bg-dobro-laranja px-4 py-2 font-semibold text-white hover:bg-dobro-laranja/90"
        >
          Enviar novo desafio
        </Link>
        <Link
          href="/correcoes/minhas-correcoes"
          className="rounded-md border border-dobro-azul px-4 py-2 font-semibold hover:bg-dobro-cinza-claro"
        >
          Minhas correções
        </Link>
      </div>
    </section>
  );
}
