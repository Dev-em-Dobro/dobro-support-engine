function SkeletonBlock({ className }: { className?: string }) {
    return <div className={`animate-pulse rounded bg-white/10 ${className ?? ''}`} />;
}

export default function ScudoRankLoading() {
    return (
        <section className="mx-auto flex max-w-6xl flex-col gap-6 py-8">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <SkeletonBlock className="h-3 w-28" />
                    <SkeletonBlock className="h-8 w-56" />
                    <SkeletonBlock className="h-4 w-40" />
                </div>
                <div className="flex gap-3">
                    <SkeletonBlock className="h-10 w-32" />
                    <SkeletonBlock className="h-10 w-36" />
                </div>
            </header>
            <SkeletonBlock className="h-96" />
        </section>
    );
}
