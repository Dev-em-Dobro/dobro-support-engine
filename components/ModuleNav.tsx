import Link from 'next/link';
import clsx from 'clsx';

type ModuleItem = {
  label: string;
  href: string;
  active: boolean;
};

const modules: ModuleItem[] = [
  { label: 'Correção de Desafios', href: '/correcoes', active: true },
  { label: 'Dashboard Scudo', href: '/monitor/scudo', active: true },
  { label: 'Agente de Vendas', href: '/vendas', active: true },
  { label: 'Tickets', href: '#', active: false },
  { label: 'Histórico do Aluno', href: '#', active: false },
];

export function ModuleNav() {
  return (
    <nav aria-label="Módulos" className="flex flex-wrap items-center gap-2">
      {modules.map((m) =>
        m.active ? (
          <Link
            key={m.label}
            href={m.href}
            className="rounded-md px-3 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/5 hover:text-[#6528d3]"
          >
            {m.label}
          </Link>
        ) : (
          <span
            key={m.label}
            aria-disabled="true"
            title="Em breve"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-white/45"
          >
            {m.label}
            <span
              className={clsx(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                'bg-[#22c55e]/20 text-[#22c55e]'
              )}
            >
              em breve
            </span>
          </span>
        )
      )}
    </nav>
  );
}
