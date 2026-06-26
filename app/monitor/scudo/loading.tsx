function SkeletonBlock({ className }: { className?: string }) {
    return <div className={`animate-pulse rounded bg-white/10 ${className ?? ''}`} />;
}

export default function ScudoLoading() {
    return (
        <section className="mx-auto flex max-w-6xl flex-col gap-6 py-8">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <SkeletonBlock className="h-3 w-28" />
                    <SkeletonBlock className="h-8 w-64" />
                    <SkeletonBlock className="h-4 w-44" />
                </div>
                <div className="flex gap-3">
                    <SkeletonBlock className="h-10 w-24" />
                    <SkeletonBlock className="h-10 w-36" />
                </div>
            </header>

            <section className="space-y-3">
                <SkeletonBlock className="h-6 w-32" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <SkeletonBlock className="h-28" />
                    <SkeletonBlock className="h-28" />
                    <SkeletonBlock className="h-28" />
                </div>
            </section>

            <section className="space-y-3">
                <SkeletonBlock className="h-6 w-36" />
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <SkeletonBlock className="h-20" />
                    <SkeletonBlock className="h-20" />
                    <SkeletonBlock className="h-20" />
                    <SkeletonBlock className="h-20" />
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
                    <SkeletonBlock className="h-72" />
                    <SkeletonBlock className="h-72" />
                </div>
            </section>

            <section className="space-y-3">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonBlock className="h-36" />
            </section>

            <section className="space-y-3">
                <SkeletonBlock className="h-6 w-24" />
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <SkeletonBlock className="h-20" />
                    <SkeletonBlock className="h-20" />
                    <SkeletonBlock className="h-20" />
                    <SkeletonBlock className="h-20" />
                </div>
                <SkeletonBlock className="h-40" />
            </section>
        </section>
    );
}

export function ScudoFinanceLoading() {
    return (
        <section className="space-y-3">
            <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="h-28 animate-pulse rounded bg-white/10" />
                <div className="h-28 animate-pulse rounded bg-white/10" />
                <div className="h-28 animate-pulse rounded bg-white/10" />
            </div>
        </section>
    );
}
