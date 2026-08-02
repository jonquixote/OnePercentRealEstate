import { HeroSkeleton } from '@/components/home/HeroSkeleton';

/**
 * Route-level loading UI.
 *
 * This was a full-screen "Loading..." spinner, which was harmless while the
 * page was one client component (it never rendered) but would have replaced
 * real streaming content with an empty screen now that page.tsx is a server
 * component. A geometry-mirroring skeleton keeps CLS near zero instead.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-ink font-sans text-foreground">
      {/* Skeletons are decorative and aria-hidden; this is the one thing a
          screen reader should hear. */}
      <span className="sr-only" role="status">Loading deals</span>
      <HeroSkeleton />
      <div className="mx-auto max-w-6xl px-6 lg:px-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-t border-line py-16">
            <div className="h-8 w-56 animate-pulse rounded bg-[var(--ink-2)]" />
            <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="aspect-[4/3] animate-pulse rounded-[6px] bg-[var(--ink-2)]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
