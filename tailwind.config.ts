import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        dobro: {
          laranja: '#6528D3',
          azul: '#6BB27C',
          amarelo: '#22C55E',
          'cinza-escuro': '#111111',
          'cinza-claro': '#1A1A1A',
          branco: '#EDEDED',
        },
      },
      fontFamily: {
        titulo: ['Ubuntu', 'sans-serif'],
        corpo: ['Ubuntu', 'Inter', 'Plus Jakarta Sans', 'sans-serif'],
        mono: ['Martian Mono', 'monospace'],
        orbitron: ['Orbitron', 'sans-serif'],
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
