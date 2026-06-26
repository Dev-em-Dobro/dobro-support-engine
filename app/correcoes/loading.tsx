function SkeletonBlock({ className }: { readonly className?: string }) {
    return <div className={`animate-pulse rounded bg-white/10 ${className ?? ''}`} />;
}

export default function CorrecoesLoading() {
    return (
        <section className="flex flex-col gap-4 py-8">
            <SkeletonBlock className="h-8 w-72 max-w-full" />
            <SkeletonBlock className="h-5 w-full max-w-md" />
            <div className="flex flex-wrap gap-3 pt-1">
                <SkeletonBlock className="h-11 w-44" />
                <SkeletonBlock className="h-11 w-40" />
            </div>
        </section>
    );
}
