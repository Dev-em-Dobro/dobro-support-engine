import Link from 'next/link';
import clsx from 'clsx';

type ModuleItem = {
  label: string;
  href: string;
  active: boolean;
};

const modules: ModuleItem[] = [
  { label: 'Correção de Desafios', href: '/correcoes', active: true },
  { label: 'Tickets', href: '#', active: false },
  { label: 'Histórico do Aluno', href: '#', active: false },
  { label: 'Base de Conhecimento', href: '#', active: false },
];

export function ModuleNav() {
  return (
    <nav aria-label="Módulos" className="flex flex-wrap items-center gap-2">
      {modules.map((m) =>
        m.active ? (
          <Link
            key={m.label}
            href={m.href}
            className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-dobro-cinza-claro"
          >
            {m.label}
          </Link>
        ) : (
          <span
            key={m.label}
            aria-disabled="true"
            title="Em breve"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-sm text-dobro-cinza-escuro/60"
          >
            {m.label}
            <span
              className={clsx(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                'bg-dobro-amarelo/20'
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
