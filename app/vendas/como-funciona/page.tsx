import { redirect } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { asSalesUser } from '@/lib/db-context';
import { salesSettings } from '@/drizzle/schema';

export const metadata = { title: 'Como o Chat funciona · Agente de Vendas' };

export default async function VendasComoFuncionaPage() {
  const session = await getSession();
  if (!session || session.role !== 'sales') redirect('/vendas/login');

  const rows = await asSalesUser(session.email, async (tx) =>
    tx
      .select({ value: salesSettings.value, updatedAt: salesSettings.updatedAt })
      .from(salesSettings)
      .where(eq(salesSettings.key, 'how_it_works'))
      .limit(1)
  );
  const setting = rows[0] ?? { value: '', updatedAt: null };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/vendas" className="text-sm text-[#6528d3] hover:underline">
        ← Voltar ao chat
      </Link>
      <h1 className="ds-subtitle mt-2">Como o Chat funciona</h1>

      <div className="ds-card mt-6 p-6">
        {setting.value.trim() ? (
          <article className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-white/90">
            {setting.value}
          </article>
        ) : (
          <p className="text-sm text-white/50">
            O gestor de vendas ainda não escreveu esta página. Procure o time interno se tiver dúvida
            sobre como usar o chat.
          </p>
        )}
      </div>

      {setting.updatedAt && (
        <p className="mt-3 text-xs text-white/50">
          Atualizado em {new Date(setting.updatedAt).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}
