import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Painel do Gestor de Vendas · Dev em Dobro' };

interface Card {
  href: string;
  title: string;
  desc: string;
}

const cards: Card[] = [
  {
    href: '/monitor/vendas/knowledge-base',
    title: 'Documentos da KB',
    desc: 'Subir PDF, Markdown ou FAQ. Cada documento vira fonte de resposta do agente.',
  },
  {
    href: '/gestor-vendas/contexto',
    title: 'Contexto do Chat',
    desc: 'Instruções extras que o agente recebe sempre. Use pra explicar tom, foco em produtos do momento, etc.',
  },
  {
    href: '/gestor-vendas/como-funciona',
    title: 'Como o Chat funciona',
    desc: 'Página de ajuda que os vendedores leem. Explica capacidades e limites do agente.',
  },
];

export default async function GestorVendasPage() {
  const session = await getSession();
  if (!session || session.role !== 'monitor') redirect('/monitor/login');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <p className="font-titulo text-xs font-bold uppercase tracking-widest text-[#a78bfa] mb-1">
          Gestor de Vendas
        </p>
        <h1 className="ds-subtitle text-[28px]">Painel</h1>
        <p className="mt-2 text-sm text-white/70">
          Logado como <span className="font-mono">{session.email}</span>
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="ds-card group block p-5"
          >
            <h2 className="font-titulo text-lg font-bold text-[#a78bfa] group-hover:underline">
              {c.title}
            </h2>
            <p className="mt-2 text-sm text-white/70">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
