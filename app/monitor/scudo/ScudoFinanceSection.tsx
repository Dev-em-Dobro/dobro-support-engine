import { formatCurrency } from '@/app/monitor/scudo/format';
import { getScudoFinanceDashboard } from '@/lib/scudo-metrics';

export async function ScudoFinanceSection() {
    const finance = await getScudoFinanceDashboard();

    return (
        <section className="space-y-3">
            {finance.warnings.length > 0 && (
                <div className="rounded-lg border border-[#ff6b35]/40 bg-[#ff6b35]/10 px-4 py-3 text-sm text-[#fdba74]">
                    {finance.warnings.map((warning) => (
                        <p key={warning}>• {warning}</p>
                    ))}
                </div>
            )}

            <h2 className="font-titulo text-xl font-semibold">Financeiro</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <article className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-4">
                    <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Neon (30d)</p>
                    <p className="mt-1 font-mono text-2xl font-semibold">
                        {finance.neon.hasData ? formatCurrency(finance.neon.estimatedCostUsd30d) : 'N/D'}
                    </p>
                    <p className="mt-1 text-xs text-dobro-cinza-escuro/60">
                        {finance.neon.projectName ?? 'Projeto Scudo'} · plano {finance.neon.plan}
                    </p>
                    <p className="mt-1 text-xs text-dobro-cinza-escuro/60">
                        Compute: {finance.neon.computeUnitHours30d.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} CUh ·
                        Storage: {finance.neon.storageGbMonth30d.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} GB-mês
                    </p>
                </article>
                <article className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-4">
                    <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">OpenAI Scudo (30d)</p>
                    <p className="mt-1 font-mono text-2xl font-semibold">
                        {finance.openAi.hasData ? formatCurrency(finance.openAi.estimatedCostUsd30d) : 'N/D'}
                    </p>
                    <p className="mt-1 text-xs text-dobro-cinza-escuro/60">
                        {finance.openAi.hasData
                            ? 'Telemetria de custo da OpenAI ativa na Scudo.'
                            : finance.openAi.note}
                    </p>
                </article>
                <article className="rounded border border-dobro-cinza-escuro/10 bg-dobro-cinza-claro/30 p-4">
                    <p className="text-[11px] uppercase tracking-wider text-dobro-cinza-escuro/60">Total Scudo (30d)</p>
                    <p className="mt-1 font-mono text-2xl font-semibold">{formatCurrency(finance.totalEstimatedCostUsd30d)}</p>
                    <p className="mt-1 text-xs text-dobro-cinza-escuro/60">
                        Transferência Neon 30d: {finance.neon.transferGb30d.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} GB
                    </p>
                </article>
            </div>
        </section>
    );
}
