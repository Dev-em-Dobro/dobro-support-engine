import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { SalesChat } from './SalesChat';

export const metadata = { title: 'Agente de Vendas · Dev em Dobro' };

export default async function VendasPage() {
  const session = await getSession();
  if (!session || session.role !== 'sales') {
    redirect('/vendas/login');
  }

  return <SalesChat userEmail={session.email} />;
}
