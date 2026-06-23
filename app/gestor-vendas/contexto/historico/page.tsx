import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { salesSettings, salesSettingsHistory } from '@/drizzle/schema';
import { HistoricoList } from './HistoricoList';

export const metadata = { title: 'Histórico do Contexto · Gestor de Vendas' };

export default async function HistoricoPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

  const [versions, currentRows] = await Promise.all([
    asMonitor(session.email, async (tx) =>
      tx
        .select({
          version: salesSettingsHistory.version,
          value: salesSettingsHistory.value,
          editedByEmail: salesSettingsHistory.editedByEmail,
          editedAt: salesSettingsHistory.editedAt,
        })
        .from(salesSettingsHistory)
        .where(eq(salesSettingsHistory.key, 'chat_context'))
        .orderBy(desc(salesSettingsHistory.version))
        .limit(20)
    ),
    asMonitor(session.email, async (tx) =>
      tx
        .select({ value: salesSettings.value })
        .from(salesSettings)
        .where(eq(salesSettings.key, 'chat_context'))
        .limit(1)
    ),
  ]);

  const currentValue = currentRows[0]?.value ?? '';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/gestor-vendas/contexto" className="text-sm text-[#6528d3] hover:underline">
        ← Voltar ao contexto
      </Link>
      <h1 className="ds-subtitle mt-2">Histórico do Contexto</h1>
      <p className="mt-2 text-sm text-white/70">
        Últimas 20 versões salvas do contexto do chat. Use <strong>Restaurar</strong> pra reverter
        rapidamente caso uma versão indevida tenha entrado no ar. A restauração também é registrada
        como uma nova versão e dispara o alerta de mudança crítica.
      </p>

      <div className="mt-6">
        <HistoricoList
          versions={versions.map((v) => ({
            version: v.version,
            value: v.value,
            editedByEmail: v.editedByEmail,
            editedAt: new Date(v.editedAt).toISOString(),
          }))}
          currentValue={currentValue}
        />
      </div>
    </div>
  );
}
