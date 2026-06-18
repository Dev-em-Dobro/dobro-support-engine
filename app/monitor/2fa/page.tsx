import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asService } from '@/lib/db-context';
import { monitorUsers } from '@/drizzle/schema';
import { TwoFactorSetup } from './TwoFactorSetup';

export const metadata = { title: 'Verificação em duas etapas · Monitor' };

export default async function TwoFactorPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

  const rows = await asService(async (tx) =>
    tx
      .select({ totpEnabledAt: monitorUsers.totpEnabledAt })
      .from(monitorUsers)
      .where(eq(monitorUsers.email, session.email))
      .limit(1)
  );
  const enabled = !!rows[0]?.totpEnabledAt;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/monitor/dashboard" className="text-sm text-dobro-azul hover:underline">
        ← Voltar ao painel
      </Link>
      <h1 className="mt-2 font-titulo text-2xl font-bold">Verificação em duas etapas</h1>
      <p className="mt-2 text-sm text-dobro-cinza-escuro/70">
        Adiciona um segundo fator (código do app autenticador) ao seu login. Protege a conta de
        gestor — que controla o comportamento do agente de vendas — mesmo que a senha vaze.
      </p>

      <div className="mt-6 rounded-xl border border-dobro-cinza-escuro/10 bg-white p-6 shadow-sm">
        <TwoFactorSetup initiallyEnabled={enabled} email={session.email} />
      </div>
    </div>
  );
}
