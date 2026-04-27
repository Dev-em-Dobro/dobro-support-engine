import { LoginForm } from './LoginForm';

export const metadata = {
  title: 'Entrar · Dobro Support',
};

export default function EntrarPage({
  searchParams,
}: {
  searchParams: { erro?: string };
}) {
  const erroMsg = mapErro(searchParams.erro);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center py-12">
      <h1 className="font-titulo text-3xl font-bold">Entrar no Dobro Support</h1>
      <p className="mt-2 text-dobro-cinza-escuro/70">
        A gente envia um link de acesso pro seu email cadastrado na DevQuest.
      </p>
      {erroMsg && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {erroMsg}
        </div>
      )}
      <div className="mt-6">
        <LoginForm />
      </div>
    </div>
  );
}

function mapErro(code?: string): string | null {
  switch (code) {
    case 'invalid':
      return 'Esse link é inválido. Peça um novo.';
    case 'expired':
      return 'Esse link expirou. Links duram 15 minutos.';
    case 'already_used':
      return 'Esse link já foi usado. Peça um novo.';
    case 'token_ausente':
      return 'Faltou o token no link. Tenta de novo.';
    default:
      return null;
  }
}
