'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { PropertyCard } from '@/components/ui/card';
import Header from '@/components/Header';
import { Loader2, Search, BarChart3, ArrowRight, Map as MapIcon, List as ListIcon } from 'lucide-react';
import Link from 'next/link';
import { PropertyMap } from '@/components/PropertyMap';
import {
  PropertyFilters,
  propertyFilterParsers,
  toFilterState,
} from '@/components/PropertyFilters';
import { useQueryStates } from 'nuqs';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { SavedSearches } from '@/components/SavedSearches';
import { HomeHero } from '@/components/home/HomeHero';
import { StatsStrip } from '@/components/home/StatsStrip';
import { FeaturedDeals } from '@/components/home/FeaturedDeals';
import { MarketPulse } from '@/components/home/MarketPulse';

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
  // State
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [showMap, setShowMap] = useState(true);
  const [sortBy, setSortBy] = useState('one_percent_high');

  const [heroStats, setHeroStats] = useState<{
    total: number;
    markets: number;
    rentCalcPending: number;
  } | null>(null);

  const opportunitiesRef = useRef<HTMLDivElement | null>(null);
  const scrollToOpportunities = useCallback(() => {
    opportunitiesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Filter state in URL via nuqs.
  const [qs] = useQueryStates(propertyFilterParsers);
  const filters = useMemo(() => toFilterState(qs), [qs]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast, ToastView } = useToast();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadProperties(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sortBy,
    qs.sold,
    qs.pmin,
    qs.pmax,
    qs.beds,
    qs.baths,
    qs.op,
    qs.cap,
    qs.coc,
    qs.type,
    qs.sale,
    qs.strat,
  ]);

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
      });

      const items = data.items;
      if (items.length < 100) setHasMore(false);
      else setHasMore(true);

      if (pageNum === 1) {
        setProperties(items);
      } else {
        setProperties((prev) => [...prev, ...items]);
      }

      setPage(pageNum);
    } catch (error) {
      console.error('Failed to fetch properties:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const handleLoadMore = () => loadProperties(page + 1);

  const toggleSelection = useCallback(
    (id: string) => {
      setSelectedProperties((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          if (next.size >= 3) {
            showToast('You can compare up to 3 properties at a time.');
            return prev;
          }
          next.add(id);
        }
        return next;
      });
    },
    [showToast]
  );

  // Client-side filter only for showSold (status check). Server handles the rest.
  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      if (!filters.showSold && (p.status === 'sold' || p.listing_price === null)) return false;
      return true;
    });
  }, [properties, filters.showSold]);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <Header />
      <HomeHero onCtaClick={scrollToOpportunities} stats={heroStats} />
      <StatsStrip onStatsLoaded={(s) => setHeroStats({ total: s.total, markets: s.markets, rentCalcPending: s.rentCalcPending })} />
      <FeaturedDeals rentCalcPending={heroStats?.rentCalcPending ?? 0} />
      <MarketPulse />

      {/* Opportunities — the tool itself. Anchored target for hero CTA. */}
      <section
        id="opportunities"
        ref={opportunitiesRef}
        aria-labelledby="opp-headline"
        className="border-t border-slate-200/70 bg-slate-50"
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 py-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
                All opportunities
              </p>
              <h2
                id="opp-headline"
                className="mt-1 flex items-baseline gap-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"
              >
                Browse the full feed
                <span className="rounded-full bg-slate-900 px-3 py-1 font-mono text-[11px] font-semibold tabular-nums text-white">
                  {filteredProperties.length} shown
                </span>
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden sm:block">
                <SavedSearches />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="one_percent_high">1% rule · best</option>
                <option value="one_percent_low">1% rule · worst</option>
                <option value="newest">Newest listed</option>
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

          {/* Sticky filters within the opportunities section */}
          <div className="sticky top-[64px] z-20 -mx-4 border-y border-slate-200 bg-white px-4 shadow-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <PropertyFilters />
          </div>
        </div>

        {/* Grid + Map */}
        <div className="mx-auto flex max-w-7xl flex-col px-4 sm:px-6 lg:px-8 lg:flex-row">
          <div
            className={`flex-1 py-8 ${
              showMap ? 'hidden lg:block lg:w-[55%]' : 'w-full'
            }`}
          >
            {loading && page === 1 ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                  >
                    <div className="aspect-[16/10] animate-pulse bg-slate-100" />
                    <div className="space-y-2 p-4">
                      <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                      <div className="h-5 w-3/4 animate-pulse rounded bg-slate-100" />
                      <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className={`grid gap-6 ${
                  showMap
                    ? 'grid-cols-1 xl:grid-cols-2'
                    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                }`}
              >
                {filteredProperties.map((property, idx) => (
                  <div
                    key={property.id}
                    className="animate-in fade-in slide-in-from-bottom-2 duration-500"
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    <PropertyCard
                      property={property}
                      isSelected={selectedProperties.has(property.id)}
                      onSelect={toggleSelection}
                    />
                  </div>
                ))}
              </div>
            )}

            {!loading && filteredProperties.length === 0 && (
              <div className="mt-12 rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 p-12 text-center">
                <Search className="mx-auto h-12 w-12 text-slate-400" />
                <h3 className="mt-2 text-sm font-semibold text-slate-900">
                  No properties match your filters
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Try adjusting your price range or criteria.
                </p>
              </div>
            )}

            {hasMore && !loading && (
              <div className="mt-8 text-center">
                <Button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  variant="outline"
                  className="w-full md:w-auto min-w-[200px]"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Load more'
                  )}
                </Button>
              </div>
            )}
          </div>

          <div
            className={`relative ${
              showMap ? 'block h-[60vh] w-full' : 'hidden'
            } lg:sticky lg:top-[140px] lg:block lg:h-[calc(100vh-160px)] lg:w-[45%] lg:border-l lg:border-slate-200`}
          >
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
              className="absolute left-4 top-4 z-10 hidden rounded-md border border-slate-200 bg-white p-2 shadow-md hover:bg-slate-50 lg:block"
              title={showMap ? 'Hide Map' : 'Show Map'}
              aria-label={showMap ? 'Hide Map' : 'Show Map'}
            >
              {showMap ? <ArrowRight className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
            </button>
            <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 lg:hidden">
              <Button
                variant="default"
                size="default"
                className="rounded-full px-6 shadow-lg"
                onClick={() => setShowMap(false)}
              >
                <ListIcon className="mr-2 h-4 w-4" />
                Show list
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer credit strip */}
      <footer className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
          <p className="text-center text-xs text-slate-500">
            Rent estimates triangulated from{' '}
            <span className="font-mono text-slate-700">HUD SAFMR</span>,{' '}
            <span className="font-mono text-slate-700">scraped comps</span>, and{' '}
            <span className="font-mono text-slate-700">ML</span>. Listing data
            via partner MLS feeds, refreshed every 30 minutes.
          </p>
        </div>
      </footer>

      {/* Floating Compare CTA */}
      {selectedProperties.size > 0 && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-8 fade-in duration-300">
          <Link
            href={`/compare?ids=${Array.from(selectedProperties).join(',')}`}
            className="group flex items-center rounded-full bg-slate-900 pl-4 pr-6 py-3 text-white shadow-2xl ring-4 ring-white transition-all hover:scale-105 hover:bg-slate-800"
          >
            <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold shadow-inner transition-transform group-hover:scale-110">
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
