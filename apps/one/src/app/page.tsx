'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useStats } from '@oper/api-client';
import { PropertyCard } from '@/components/ui/card';
import { Loader2, Search, ArrowRight, Map as MapIcon, List as ListIcon } from 'lucide-react';
import Link from 'next/link';
import { PropertyMap } from '@/components/PropertyMap';
import {
  PropertyFilters,
  propertyFilterParsers,
  toFilterState,
} from '@/components/PropertyFilters';
import { WatchSearchButton } from '@/components/WatchSearchButton';
import { useQueryStates } from 'nuqs';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { SavedSearches } from '@/components/SavedSearches';
import { HomeHero } from '@/components/home/HomeHero';
import { FeaturedDeals } from '@/components/home/FeaturedDeals';
import { useSessionUser } from '@/lib/useSessionUser';
import { COMPARE_FREE_MAX, COMPARE_MAX } from '@/components/compare/useCompare';
import { ReducedRail } from '@/components/home/ReducedRail';
import { MarketPulse } from '@/components/home/MarketPulse';
import { RentHeatTeaser } from '@/components/home/RentHeatTeaser';
import { MarketsGrid } from '@/components/home/MarketsGrid';
import { asStrategy, STRATEGY_BY_ID } from '@/lib/strategies';

interface Property {
  id: string;
  address: string;
  listing_price: number;
  estimated_rent: number;
  financial_snapshot: any;
  status: string;
  raw_data: any;
  latitude: number;
  longitude: number;
  created_at?: string;
}

import { getProperties } from '@/app/actions';

export default function Dashboard() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [showMap, setShowMap] = useState(true);
  const [sortBy, setSortBy] = useState('one_percent_high');

  const opportunitiesRef = useRef<HTMLDivElement | null>(null);
  const scrollToOpportunities = useCallback(() => {
    opportunitiesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Filter + lens state in URL via nuqs.
  const [qs, setQs] = useQueryStates(propertyFilterParsers, { history: 'replace', shallow: true });
  const filters = useMemo(() => toFilterState(qs), [qs]);
  const strategy = asStrategy(qs.strat);
  const stratMeta = STRATEGY_BY_ID[strategy];
  const { data: stats } = useStats(strategy);
  const [priceCuts, setPriceCuts] = useState<number | undefined>(undefined);
  const [medianRent, setMedianRent] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/stats/cuts').then(r => r.ok ? r.json().then(d => setPriceCuts(d.count)) : null).catch(() => {});
    fetch('/api/stats/median-rent').then(r => r.ok ? r.json().then(d => setMedianRent(d.medianRent ?? null)) : null).catch(() => {});
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast, ToastView } = useToast();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { loadProperties(1); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, qs.sold, qs.pmin, qs.pmax, qs.beds, qs.baths, qs.op, qs.cap, qs.coc, qs.type, qs.sale, qs.strat, qs.hoamax, qs.dom, qs.cut]);

  async function loadProperties(pageNum: number) {
    try {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);
      const data = await getProperties(pageNum, 100, sortBy, {
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        minBeds: filters.minBeds,
        minBaths: filters.minBaths,
        onlyOnePercentRule: filters.onlyOnePercentRule,
        minCapRate: filters.minCapRate,
        minCashOnCash: filters.minCashOnCash,
        propertyType: filters.propertyType,
        saleType: filters.saleType,
        strategy: filters.strategy,
        hoaMax: filters.hoaMax > 0 ? filters.hoaMax : undefined,
        domMin: filters.domMin > 0 ? filters.domMin : undefined,
        hasPriceCut: filters.hasPriceCut || undefined,
      });
      const items = data.items;
      setHasMore(items.length >= 100);
      setProperties((prev) => (pageNum === 1 ? items : [...prev, ...items]));
      setPage(pageNum);
    } catch (error) {
      console.error('Failed to fetch properties:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const handleLoadMore = () => loadProperties(page + 1);

  const sessionUser = useSessionUser();
  const compareLimit = sessionUser?.tier === 'pro' ? COMPARE_MAX : COMPARE_FREE_MAX;
  const toggleSelection = useCallback(
    (id: string) => {
      setSelectedProperties((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else {
          if (next.size >= compareLimit) {
            showToast(`You can compare up to ${compareLimit} properties at a time${sessionUser?.tier === 'pro' ? '' : ' — upgrade to compare more'}.`);
            return prev;
          }
          next.add(id);
        }
        return next;
      });
    },
    [showToast, compareLimit, sessionUser?.tier]
  );

  const filteredProperties = useMemo(
    () => properties.filter((p) => (!filters.showSold && (p.status === 'sold' || p.listing_price === null) ? false : true)),
    [properties, filters.showSold]
  );

  return (
    <div className="min-h-screen bg-ink font-sans text-foreground">
      <HomeHero
        stats={stats ?? null}
        priceCuts={priceCuts}
        medianRent={medianRent}
      />
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

      {/* Opportunities — the tool itself. Anchored target for hero CTA. */}
      <section id="opportunities" ref={opportunitiesRef} aria-labelledby="opp-headline" className="border-t border-line bg-ink-panel/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 py-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                The tool · {stratMeta.label}
              </p>
              <h2 id="opp-headline" className="mt-1 flex items-baseline gap-3 font-sans text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
                Every deal on the map, ranked
                <span className="rounded-full bg-pass/15 px-3 py-1 font-mono text-[11px] font-semibold tabular-nums text-pass-hi">
                  {filteredProperties.length} shown
                </span>
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden sm:block"><SavedSearches /></div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-9 rounded-md border border-line bg-ink-panel px-3 py-1 text-sm text-foreground focus:border-pass focus:outline-none"
              >
                <option value="one_percent_high">Rule · best</option>
                <option value="one_percent_low">Rule · worst</option>
                <option value="newest">Newest listed</option>
                <option value="biggest_cut">Biggest price cut</option>
                <option value="stalest">Longest on market</option>
                <option value="price_high">Price · high to low</option>
                <option value="price_low">Price · low to high</option>
              </select>
              <div className="lg:hidden">
                <Button variant="outline" size="sm" onClick={() => setShowMap(!showMap)}>
                  {showMap ? <ListIcon className="mr-2 h-4 w-4" /> : <MapIcon className="mr-2 h-4 w-4" />}
                  {showMap ? 'List' : 'Map'}
                </Button>
              </div>
            </div>
          </div>

          <div className="sticky top-[88px] z-20 -mx-4 border-y border-line bg-ink/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <PropertyFilters />
              </div>
              <WatchSearchButton filters={filters} />
            </div>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl flex-col px-4 sm:px-6 lg:px-8 lg:flex-row">
          <div className={`flex-1 py-8 ${showMap ? 'hidden lg:block lg:w-[55%]' : 'w-full'}`}>
            {loading && page === 1 ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-line bg-ink-panel">
                    <div className="aspect-[16/10] animate-pulse bg-white/[0.04]" />
                    <div className="space-y-2 p-4">
                      <div className="h-4 w-24 animate-pulse rounded bg-white/[0.04]" />
                      <div className="h-5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
                      <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`grid gap-6 ${showMap ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                {filteredProperties.map((property, idx) => (
                  <div key={property.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: `${idx * 30}ms` }}>
                    <PropertyCard property={property} isSelected={selectedProperties.has(property.id)} onSelect={toggleSelection} />
                  </div>
                ))}
              </div>
            )}

            {!loading && filteredProperties.length === 0 && (
              <div className="mt-12 rounded-2xl border border-dashed border-line bg-white/[0.02] p-12 text-center">
                <Search className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-2 text-sm font-semibold text-white">No properties match your filters</h3>
                <p className="mt-1 text-sm text-muted-foreground">Try adjusting your price range or criteria.</p>
              </div>
            )}

            {hasMore && !loading && (
              <div className="mt-8 text-center">
                <Button onClick={handleLoadMore} disabled={loadingMore} variant="outline" className="w-full md:w-auto min-w-[200px]">
                  {loadingMore ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>) : 'Load more'}
                </Button>
              </div>
            )}
          </div>

          <div className={`relative ${showMap ? 'block h-[60vh] w-full' : 'hidden'} lg:sticky lg:top-[140px] lg:block lg:h-[calc(100vh-160px)] lg:w-[45%] lg:border-l lg:border-line`}>
            <PropertyMap
              filters={{
                minPrice: filters.minPrice,
                maxPrice: filters.maxPrice,
                minBeds: filters.minBeds,
                minBaths: filters.minBaths,
                status: filters.showSold ? 'sold' : 'for_sale',
                saleType: filters.saleType,
              }}
            />
            <button
              onClick={() => setShowMap(!showMap)}
              className="absolute left-4 top-4 z-10 hidden rounded-md border border-line bg-ink-panel p-2 shadow-md hover:bg-ink-2 lg:block"
              title={showMap ? 'Hide Map' : 'Show Map'}
              aria-label={showMap ? 'Hide Map' : 'Show Map'}
            >
              {showMap ? <ArrowRight className="h-4 w-4 text-haze" /> : <MapIcon className="h-4 w-4 text-haze" />}
            </button>
            <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 lg:hidden">
              <Button variant="default" size="default" className="rounded-full px-6 shadow-lg" onClick={() => setShowMap(false)}>
                <ListIcon className="mr-2 h-4 w-4" />Show list
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-ink">
        <div className="mx-auto max-w-7xl px-6 py-7 lg:px-8">
          <p className="text-center text-xs leading-6 text-muted-foreground">
            Rent estimates triangulated from <span className="font-mono text-haze">HUD SAFMR</span>,{' '}
            <span className="font-mono text-haze">scraped comps</span>, and <span className="font-mono text-haze">ML</span>. Listing
            data via partner MLS feeds, refreshed continuously.
          </p>
        </div>
      </footer>

      {selectedProperties.size > 0 && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-8 fade-in duration-300">
          <Link
            href={`/compare?ids=${Array.from(selectedProperties).join(',')}`}
            className="group flex items-center rounded-full bg-pass pl-4 pr-6 py-3 text-white shadow-2xl ring-4 ring-ink transition-all hover:scale-105 hover:bg-pass-hi"
          >
            <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-bold text-pass-hi shadow-inner transition-transform group-hover:scale-110">
              {selectedProperties.size}
            </span>
            <span className="font-medium">Compare selected</span>
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      )}

      {ToastView}
    </div>
  );
}
