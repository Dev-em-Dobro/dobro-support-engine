import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { salesSettings } from '@/drizzle/schema';
import { ComoFuncionaForm } from './ComoFuncionaForm';

export const metadata = { title: 'Como o Chat funciona · Gestor de Vendas' };

export default async function ComoFuncionaPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

  const rows = await asMonitor(session.email, async (tx) =>
    tx
      .select({
        value: salesSettings.value,
        updatedAt: salesSettings.updatedAt,
        updatedByEmail: salesSettings.updatedByEmail,
      })
      .from(salesSettings)
      .where(eq(salesSettings.key, 'how_it_works'))
      .limit(1)
  );
  const initial = rows[0] ?? { value: '', updatedAt: null, updatedByEmail: null };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/gestor-vendas" className="text-sm text-[#6528d3] hover:underline">
        ← Voltar ao painel
      </Link>
      <h1 className="ds-subtitle mt-2">Como o Chat funciona</h1>
      <p className="mt-2 text-sm text-white/70">
        Texto que os vendedores leem em <Link href="/vendas/como-funciona" className="text-[#6528d3] hover:underline">/vendas/como-funciona</Link>.
        Explique o que o agente sabe responder, limites, quando criar nova conversa, como reportar
        erro, etc. Aceita parágrafos simples (sem HTML).
      </p>
      <p className="mt-1 text-xs text-white/50">
        Limite: 20.000 caracteres.
      </p>

      <div className="ds-card mt-6 p-6">
        <ComoFuncionaForm
          initialValue={initial.value ?? ''}
          updatedAt={initial.updatedAt ? new Date(initial.updatedAt).toISOString() : null}
          updatedByEmail={initial.updatedByEmail}
        />
      </div>
    </div>
  );
}
