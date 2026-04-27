/**
 * Severity metadata — central source of truth for Portuguese labels + colors.
 *
 * The underlying enum stays `low | medium | high` (schema, API, IA prompt) —
 * UI swaps in clearer pt-br labels so monitor and student see meaningful terms.
 *
 *   high   → Crítico    — bug, problema grave, acessibilidade quebrada
 *   medium → Importante — boa prática que faz diferença real
 *   low    → Polimento  — gosto, refinamento, opcional
 */

export type Severity = 'low' | 'medium' | 'high';

export interface SeverityMeta {
  label: string;
  description: string;
  hex: string;
  hexBg: string;
  badgeClass: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  high: {
    label: 'Crítico',
    description: 'Bug ou problema grave que compromete o funcionamento',
    hex: '#DC2626',
    hexBg: '#FEE2E2',
    badgeClass: 'bg-red-100 text-red-700',
  },
  medium: {
    label: 'Importante',
    description: 'Boa prática que faz diferença real na qualidade do código',
    hex: '#6528D3',
    hexBg: '#EDE6FB',
    badgeClass: 'bg-amber-100 text-amber-800',
  },
  low: {
    label: 'Polimento',
    description: 'Refinamento ou preferência de estilo',
    hex: '#6BB27C',
    hexBg: '#E9F6EC',
    badgeClass: 'bg-blue-100 text-blue-700',
  },
};

export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

export function severityLabel(s: Severity): string {
  return SEVERITY_META[s].label;
}
