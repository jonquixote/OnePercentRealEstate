// SERVER component. This was 380 lines of 'use client' covering the entire home
// page, so nothing could stream, LCP waited on hydration plus three client
// fetches, and crawlers saw no content at all.
//
// Now the shell and its data are server-side. The remaining client islands are
// FeaturedDeals / ReducedRail / MarketPulse / RentHeatTeaser / MarketsGrid
// (unchanged) and OpportunitiesTool (filters, map, compare).
import { HeroSection } from '@/components/home/HeroSection';
import { FeaturedDeals } from '@/components/home/FeaturedDeals';
import { ReducedRail } from '@/components/home/ReducedRail';
import { MarketPulse } from '@/components/home/MarketPulse';
import { RentHeatTeaser } from '@/components/home/RentHeatTeaser';
import { MarketsGrid } from '@/components/home/MarketsGrid';
import { OpportunitiesTool } from '@/components/home/OpportunitiesTool';
import { getHomeStats, getPriceCuts, getMedianRent } from '@/lib/home-data';
import { asStrategy } from '@/lib/strategies';

// The hero is visitor-specific (geo headers pick the spotlight metro), so this
// route cannot be statically rendered.
export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ strat?: string }>;
}) {
  const { strat } = await searchParams;
  // Strategy is a real URL param now rather than client-only state: per-lens
  // URLs are shareable and server-rendered, and the stats and the lens agree
  // because both derive from this single value.
  const strategy = asStrategy(strat);

  // One parallel round. The old page did this as a hook plus two useEffect
  // fetches, after hydration, to its own API routes.
  const [stats, priceCuts, medianRent] = await Promise.all([
    getHomeStats(strategy),
    getPriceCuts(),
    getMedianRent(),
  ]);

  return (
    <div className="min-h-screen bg-ink font-sans text-foreground">
      <HeroSection stats={stats} priceCuts={priceCuts} medianRent={medianRent} />

      <FeaturedDeals strategy={strategy} rentCalcPending={stats?.rentCalcPending ?? 0} />
      <ReducedRail />
      {stats && (
        <MarketPulse
          strategy={strategy}
          histogram={stats.histogram}
          thresholdPct={stats.thresholdPct}
          clears={stats.onePercentPasses}
          medianRatioPct={stats.medianRatioPct}
        />
      )}

      <RentHeatTeaser />
      <MarketsGrid />

      <OpportunitiesTool />

      <footer className="border-t border-line bg-ink">
        <div className="mx-auto max-w-7xl px-6 py-7 lg:px-8">
          <p className="text-center text-xs leading-6 text-muted-foreground">
            Rent estimates triangulated from <span className="font-mono text-haze">HUD SAFMR</span>,{' '}
            <span className="font-mono text-haze">scraped comps</span>, and <span className="font-mono text-haze">ML</span>. Listing
            data via partner MLS feeds, refreshed continuously.
          </p>
        </div>
      </footer>
    </div>
  );
}
