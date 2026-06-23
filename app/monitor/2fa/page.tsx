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
      <Link href="/monitor/dashboard" className="text-sm text-[#6528d3] hover:underline">
        ← Voltar ao painel
      </Link>
      <h1 className="ds-subtitle mt-2">Verificação em duas etapas</h1>
      <p className="mt-2 text-sm text-white/70">
        Adiciona um segundo fator (código do app autenticador) ao seu login. Protege a conta de
        gestor — que controla o comportamento do agente de vendas — mesmo que a senha vaze.
      </p>

      <div className="ds-card mt-6 p-6">
        <TwoFactorSetup initiallyEnabled={enabled} email={session.email} />
      </div>
    </div>
  );
}
