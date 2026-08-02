/**
 * Structural placeholder for the merged hero, painted by loading.tsx while the
 * server page streams.
 *
 * The geometry mirrors HeroSection exactly — same container, same
 * lg:grid-cols-[1.1fr_1fr] split, same aspect-[16/10] photo block with the
 * ratio badge ghosted in the same corner — so the real hero swapping in causes
 * no layout shift. An approximate skeleton would trade one CLS problem for
 * another.
 *
 * animate-pulse is safe unprefixed: globals.css zeroes animation-duration for
 * everything under prefers-reduced-motion.
 */
export function HeroSkeleton() {
  return (
    <section aria-hidden className="relative isolate overflow-hidden bg-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8 lg:py-14">
        {/* provenance chip */}
        <div className="mb-4 h-4 w-72 animate-pulse rounded bg-[var(--ink-2)]" />

        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
          {/* left: headline / rule line / ticker / search / CTA */}
          <div>
            <div className="space-y-3">
              <div className="h-12 w-4/5 animate-pulse rounded bg-[var(--ink-2)] sm:h-16" />
              <div className="h-12 w-3/5 animate-pulse rounded bg-[var(--ink-2)] sm:h-16" />
            </div>

            {/* The rule line renders for real — it is 1px of CSS, and keeping
                the brand's signature visible makes this read as content
                arriving rather than a page being replaced. */}
            <div className="rule-line mt-8 opacity-40" />

            <div className="mt-4 flex gap-x-10">
              <div className="h-4 w-32 animate-pulse rounded bg-[var(--ink-2)]" />
              <div className="h-4 w-28 animate-pulse rounded bg-[var(--ink-2)]" />
              <div className="h-4 w-36 animate-pulse rounded bg-[var(--ink-2)]" />
            </div>

            <div className="mt-8 h-12 max-w-md animate-pulse rounded-xl bg-[var(--ink-2)]" />
            <div className="mt-4 h-11 w-44 animate-pulse rounded-[6px] bg-[var(--ink-2)]" />
          </div>

          {/* right: spotlight card (photo + caption bar + tour strip) */}
          <div className="lg:pt-6">
            <div className="mat overflow-hidden p-0">
              <div className="relative aspect-[16/10] animate-pulse bg-[var(--ink-2)]">
                <div className="absolute left-4 top-4 h-14 w-24 rounded-[6px] bg-[var(--ink)]/60" />
              </div>
              <div className="flex items-center justify-between gap-4 p-5">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--ink-2)]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--ink-2)]" />
                </div>
                <div className="h-9 w-24 animate-pulse rounded-[6px] bg-[var(--ink-2)]" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="h-3 w-40 animate-pulse rounded bg-[var(--ink-2)]" />
              <div className="h-7 w-28 animate-pulse rounded-[5px] bg-[var(--ink-2)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
