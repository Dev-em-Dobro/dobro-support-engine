export type SubmissionStatus =
  | 'pending_auth'
  | 'queued'
  | 'processing'
  | 'draft'
  | 'approved'
  | 'rejected'
  | 'delivered'
  | 'failed';

export const statusLabelPtBr: Record<SubmissionStatus, string> = {
  pending_auth: 'Aguardando confirmação',
  queued: 'Na fila',
  processing: 'Em análise',
  draft: 'Em revisão do monitor',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  delivered: 'Entregue',
  failed: 'Falhou',
};

// Badges em tom translúcido + texto claro — paleta do Design System
// (docs/ds-site-devemdobro.md). Cores explícitas pra renderizar bem no
// tema dark sem depender da camada de override do globals.css.
export const statusBadgeClass: Record<SubmissionStatus, string> = {
  pending_auth: 'bg-white/10 text-white/70',
  queued: 'bg-[#3b82f6]/15 text-[#93c5fd]',
  processing: 'bg-[#6366f1]/15 text-[#a5b4fc]',
  draft: 'bg-[#ff6b35]/15 text-[#fdba74]',
  approved: 'bg-[#22c55e]/15 text-[#6ee7b7]',
  rejected: 'bg-[#ef4444]/15 text-[#fca5a5]',
  delivered: 'bg-[#6528d3]/15 text-[#c4b5fd]',
  failed: 'bg-[#ef4444]/15 text-[#fca5a5]',
};

export function statusLabel(s: string): string {
  return statusLabelPtBr[s as SubmissionStatus] ?? s;
}

export function statusBadge(s: string): string {
  return statusBadgeClass[s as SubmissionStatus] ?? 'bg-gray-200 text-gray-800';
}
