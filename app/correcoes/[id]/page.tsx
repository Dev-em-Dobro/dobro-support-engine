import { CorrectionLiveView } from './CorrectionLiveView';

export const metadata = { title: 'Correção · Dobro Support' };

export default function CorrecaoDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  // Public page. The client component polls /api/correcoes/[id]/status
  // and handles all three states (loading, ready, failed).
  return (
    <section className="mx-auto flex w-full max-w-[880px] flex-col gap-6 py-2 lg:py-6">
      <CorrectionLiveView submissionId={params.id} />
    </section>
  );
}
