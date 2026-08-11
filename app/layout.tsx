import type { Metadata } from 'next';
import Link from 'next/link';
import { ModuleNav } from '@/components/ModuleNav';
import { getSession } from '@/lib/session';
import '@/styles/globals.css';

// O root layout chama getSession() (lê cookies), então o app inteiro é
// renderizado sob demanda. Marcamos explícito pra o Next não tentar
// pré-renderizar estaticamente (evita o ruído DYNAMIC_SERVER_USAGE no build).
export const dynamic = 'force-dynamic';

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
      <body className="flex min-h-screen flex-col bg-black font-corpo text-white">
        <header className="border-b border-[#333] bg-[#111111]">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-block h-8 w-8 rounded-md bg-[#6528d3]" aria-hidden />
              <span className="font-titulo text-xl font-bold text-white">
                Dobro Support
              </span>
            </Link>
            {isMonitor && <ModuleNav />}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
        <footer className="border-t border-[#333] py-6 text-center text-sm text-white/60">
          Dev em Dobro · DevQuest
        </footer>
      </body>
    </html>
  );
}
