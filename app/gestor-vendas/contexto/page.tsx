import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asMonitor } from '@/lib/db-context';
import { salesSettings } from '@/drizzle/schema';
import { env } from '@/lib/env';
import { ContextoForm } from './ContextoForm';
import { PendingReview } from './PendingReview';

export const metadata = { title: 'Contexto do Chat · Gestor de Vendas' };

export default async function ContextoPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/gestor-vendas/login');

  const requiresApproval = env.SALES_CONTEXT_REQUIRE_APPROVAL;

  const rows = await asMonitor(session.email, async (tx) =>
    tx
      .select({
        value: salesSettings.value,
        updatedAt: salesSettings.updatedAt,
        updatedByEmail: salesSettings.updatedByEmail,
        pendingValue: salesSettings.pendingValue,
        pendingByEmail: salesSettings.pendingByEmail,
        pendingAt: salesSettings.pendingAt,
      })
      .from(salesSettings)
      .where(eq(salesSettings.key, 'chat_context'))
      .limit(1)
  );
  const initial = rows[0] ?? {
    value: '',
    updatedAt: null,
    updatedByEmail: null,
    pendingValue: null,
    pendingByEmail: null,
    pendingAt: null,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/gestor-vendas" className="text-sm text-[#6528d3] hover:underline">
          ← Voltar ao painel
        </Link>
        <div className="flex gap-4">
          <Link href="/gestor-vendas/contexto/avaliacao" className="text-sm text-[#6528d3] hover:underline">
            Avaliação →
          </Link>
          <Link href="/gestor-vendas/contexto/historico" className="text-sm text-[#6528d3] hover:underline">
            Histórico de versões →
          </Link>
        </div>
      </div>
      <h1 className="ds-subtitle mt-2">Contexto do Chat</h1>
      <p className="mt-2 text-sm text-white/70">
        Texto que o agente recebe em <strong>toda</strong> conversa, junto com as regras inegociáveis
        e os trechos da base de conhecimento. Use pra dar foco (ex: &quot;estamos no lançamento da
        DevQuest 6.0&quot;), tom desejado, política comercial não cadastrada como documento, etc.
      </p>
      <p className="mt-1 text-xs text-white/50">
        Limite: 4.000 caracteres. O agente continua proibido de inventar fora dos trechos da KB.
        {requiresApproval && ' Mudanças exigem aprovação de um segundo gestor antes de entrar no ar.'}
      </p>

      {requiresApproval && initial.pendingValue !== null && (
        <div className="mt-6">
          <PendingReview
            currentValue={initial.value ?? ''}
            pendingValue={initial.pendingValue}
            pendingByEmail={initial.pendingByEmail}
            pendingAt={initial.pendingAt ? new Date(initial.pendingAt).toISOString() : null}
            currentEmail={session.email}
          />
        </div>
      )}

      <div className="ds-card mt-6 p-6">
        <ContextoForm
          initialValue={initial.value ?? ''}
          updatedAt={initial.updatedAt ? new Date(initial.updatedAt).toISOString() : null}
          updatedByEmail={initial.updatedByEmail}
          requiresApproval={requiresApproval}
        />
      </div>
    </div>
  );
}
