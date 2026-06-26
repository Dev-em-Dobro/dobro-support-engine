export function formatCurrency(value: number) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 4,
    }).format(value);
}

export function formatDateTime(iso: string | null) {
    if (!iso) return 'Sem acesso recente';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Sem acesso recente';
    return date.toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    });
}
