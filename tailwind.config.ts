import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Aliases legados — mantidos pra não quebrar páginas existentes.
        // Os nomes são históricos (laranja=roxo, azul/amarelo=verde); os
        // valores já apontam pra paleta correta do design system.
        dobro: {
          laranja: '#6528D3',
          azul: '#6BB27C',
          amarelo: '#22C55E',
          'cinza-escuro': '#111111',
          'cinza-claro': '#1A1A1A',
          branco: '#EDEDED',
        },
        // Paleta oficial do Design System (docs/ds-site-devemdobro.md).
        // Use `ds-*` em código novo: nomes batem com o documento.
        ds: {
          roxo: '#6528d3', // primária da marca — CTAs, destaques
          'roxo-hover': '#5020b0',
          verde: '#22c55e', // sucesso, badges positivos
          vermelho: '#ef4444', // alertas, itens negativos
          laranja: '#ff6b35', // badges especiais, urgência
          azul: '#3b82f6', // badges informativos
          preto: '#000000', // background principal
          'cinza-900': '#0d0d0d', // background mais escuro
          'cinza-800': '#111111', // background secundário (alterna c/ preto)
          'cinza-700': '#1a1a1a', // background de cards
          borda: '#333333', // borda padrão de cards
          'borda-forte': '#444444', // borda alternativa
          branco: '#ededed', // texto de badges/labels
        },
      },
      fontFamily: {
        titulo: ['Ubuntu', 'Helvetica', 'sans-serif'],
        corpo: ['Ubuntu', 'Helvetica', 'Inter', 'Plus Jakarta Sans', 'sans-serif'],
        mono: ['Martian Mono', 'monospace'],
        orbitron: ['Orbitron', 'sans-serif'],
      },
      maxWidth: {
        // Largura de container padrão do DS
        ds: '1216px',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
    },
  },
  plugins: [],
};

export default config;
