import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { KbDocumentForm } from './KbDocumentForm';

export const metadata = { title: 'Cadastrar documento · KB Monitor' };

export default async function NewKbDocumentPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/gestor-vendas/login');
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="ds-subtitle mb-6">Cadastrar documento</h1>
      <KbDocumentForm />
    </div>
  );
}
