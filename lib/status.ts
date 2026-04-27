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

export const statusBadgeClass: Record<SubmissionStatus, string> = {
  pending_auth: 'bg-gray-200 text-gray-800',
  queued: 'bg-blue-100 text-blue-800',
  processing: 'bg-indigo-100 text-indigo-800',
  draft: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  delivered: 'bg-dobro-laranja/15 text-dobro-laranja',
  failed: 'bg-red-100 text-red-800',
};

export function statusLabel(s: string): string {
  return statusLabelPtBr[s as SubmissionStatus] ?? s;
}

export function statusBadge(s: string): string {
  return statusBadgeClass[s as SubmissionStatus] ?? 'bg-gray-200 text-gray-800';
}
