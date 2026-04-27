import type { Metadata } from 'next';
import Link from 'next/link';
import { ModuleNav } from '@/components/ModuleNav';
import { getSession } from '@/lib/session';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Dobro Support',
  description:
    'Plataforma de suporte ao aluno DevQuest — correções, tickets, histórico e base de conhecimento.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isMonitor = session?.role === 'monitor';

  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-dobro-branco">
        <header className="border-b border-dobro-cinza-claro bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-block h-8 w-8 rounded-md bg-dobro-laranja" aria-hidden />
              <span className="font-titulo text-xl font-bold">
                Dobro Support
              </span>
            </Link>
            {isMonitor && <ModuleNav />}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
        <footer className="border-t border-dobro-cinza-claro py-6 text-center text-sm text-dobro-cinza-escuro/60">
          Dev em Dobro · DevQuest
        </footer>
      </body>
    </html>
  );
}
