export function SectionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-3 rounded-2xl border border-line bg-card p-6">
      <div className="h-4 w-1/3 rounded bg-ink-2" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 w-full rounded bg-ink-2" style={{ width: `${70 + (i % 3) * 15}%` }} />
      ))}
    </div>
  );
}

export function RentSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-line bg-card p-6">
      <div className="flex gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex-1 space-y-2">
            <div className="h-3 w-20 rounded bg-ink-2" />
            <div className="h-8 w-24 rounded bg-ink-2" />
            <div className="h-2 w-full rounded bg-ink-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GallerySkeleton() {
  return (
    <div className="animate-pulse aspect-[16/9] w-full rounded-2xl bg-ink-mat" />
  );
}
