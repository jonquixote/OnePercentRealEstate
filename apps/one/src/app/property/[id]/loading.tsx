export default function PropertyLoading() {
  return (
    <div style={{ background: 'var(--ink)' }}>
      {/* Skeleton header */}
      <div className="sticky top-0 z-50 border-b border-line bg-ink/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
          <div className="h-4 w-48 animate-pulse rounded bg-ink-2" />
          <div className="flex gap-2">
            <div className="h-8 w-20 animate-pulse rounded-full bg-ink-2" />
            <div className="h-8 w-20 animate-pulse rounded-full bg-ink-2" />
          </div>
        </div>
      </div>

      {/* Skeleton tab bar */}
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-7xl gap-6 px-6 lg:px-8">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-10 w-16 animate-pulse rounded bg-ink-2" />
          ))}
        </div>
      </div>

      {/* Content skeleton */}
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_360px]">
          <div className="space-y-8">
            <div className="aspect-[16/9] w-full animate-pulse rounded-2xl bg-ink-mat" />
            <div className="h-6 w-64 animate-pulse rounded bg-ink-2" />
            <div className="h-4 w-96 animate-pulse rounded bg-ink-2" />
            <div className="h-32 animate-pulse rounded-2xl bg-ink-panel" />
            <div className="h-32 animate-pulse rounded-2xl bg-ink-panel" />
          </div>
          <div className="h-80 animate-pulse rounded-2xl bg-ink-panel" />
        </div>
      </div>
    </div>
  );
}
