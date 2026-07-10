'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useQueryStates } from 'nuqs';
import { Loader2, SlidersHorizontal, Map, List } from 'lucide-react';
import { PropertyMap } from '@/components/PropertyMap';
import { SearchCard } from '@/components/search/SearchCard';
import { WatchSearchButton } from '@/components/WatchSearchButton';
import {
  PropertyFilters,
  propertyFilterParsers,
  toFilterState,
} from '@/components/PropertyFilters';
import { getProperties } from '@/app/actions';

const num = new Intl.NumberFormat('en-US');

const SORT_OPTIONS = [
  { value: 'one_percent_high', label: 'Rule · best' },
  { value: 'one_percent_low', label: 'Rule · worst' },
  { value: 'biggest_cut', label: 'Biggest price cut' },
  { value: 'newest', label: 'Newest listed' },
  { value: 'stalest', label: 'Longest on market' },
  { value: 'price_high', label: 'Price · high to low' },
  { value: 'price_low', label: 'Price · low to high' },
];

interface Property {
  id: string;
  address: string;
  listing_price?: number | null;
  estimated_rent?: number | null;
  rent_low?: number | null;
  rent_high?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  primary_photo?: string | null;
  property_type?: string | null;
  price_cut_pct?: number | null;
  days_on_market?: number | null;
  is_rentable?: boolean | null;
  target_ratio?: number | null;
}

export default function SearchPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [sortBy, setSortBy] = useState('one_percent_high');
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [copied, setCopied] = useState(false);

  const [qs, setQs] = useQueryStates(propertyFilterParsers, { history: 'replace', shallow: true });
  const filters = useMemo(() => toFilterState(qs), [qs]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadProperties(1), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, qs.sold, qs.pmin, qs.pmax, qs.beds, qs.baths, qs.op, qs.cap, qs.coc, qs.type, qs.sale, qs.strat, qs.hoamax, qs.dom, qs.cut, qs.q]);

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
        q: qs.q || undefined,
      });
      const items = data?.items ?? [];
      setHasMore(items.length >= 100);
      setProperties((prev) => (pageNum === 1 ? items : [...prev, ...items]));
      setPage(pageNum);
    } catch {
      setProperties([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (qs.pmin > 0) chips.push({ key: 'pmin', label: `≥ $${num.format(qs.pmin)}`, onRemove: () => setQs({ pmin: null }) });
    if (qs.pmax < 2000000) chips.push({ key: 'pmax', label: `≤ $${num.format(qs.pmax)}`, onRemove: () => setQs({ pmax: null }) });
    if (qs.beds > 0) chips.push({ key: 'beds', label: `${qs.beds}+ bd`, onRemove: () => setQs({ beds: null }) });
    if (qs.baths > 0) chips.push({ key: 'baths', label: `${qs.baths}+ ba`, onRemove: () => setQs({ baths: null }) });
    if (qs.op) chips.push({ key: 'op', label: 'Clears the line', onRemove: () => setQs({ op: null }) });
    if (qs.cut) chips.push({ key: 'cut', label: 'Price reduced', onRemove: () => setQs({ cut: null }) });
    if (qs.type) chips.push({ key: 'type', label: qs.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), onRemove: () => setQs({ type: null }) });
    return chips;
  }, [qs, setQs]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>

      {/* sticky toolbar */}
      <div
        className="sticky top-[57px] z-30 border-b backdrop-blur"
        style={{ background: 'rgba(250,247,242,.95)', borderColor: 'var(--line)' }}
      >
        <div className="mx-auto max-w-7xl px-6 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:border-line-hi"
              style={{ borderColor: showFilters ? 'var(--pass)' : 'var(--line)', color: showFilters ? 'var(--pass)' : 'var(--text)' }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {showFilters ? 'Done' : 'Filters'}
            </button>

            {/* Active filter chips */}
            <div className="flex items-center gap-2 overflow-x-auto">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  onClick={chip.onRemove}
                  className="flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
                  style={{
                    background: chip.key === 'cut' ? 'var(--brass-dim)' : 'var(--pass-dim)',
                    color: chip.key === 'cut' ? 'var(--brass-hi)' : 'var(--pass-hi)',
                  }}
                  aria-label={`Remove filter: ${chip.label}`}
                >
                  {chip.label} <span className="ml-0.5 opacity-60">×</span>
                </button>
              ))}
            </div>

            {/* Count + sort + actions */}
            <div className="ml-auto flex items-center gap-2">
              {activeChips.length === 0 && !showFilters && (
                <span className="hidden sm:inline text-[12px]" style={{ color: 'var(--mute)' }}>
                  {loading ? 'Loading…' : `${num.format(properties.length)} properties`}
                </span>
              )}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded-full border bg-transparent px-3 py-1.5 text-[12px] font-medium"
                style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => setShowMap(!showMap)}
                className="hidden lg:flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-line-hi"
                style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
                title={showMap ? 'Hide map' : 'Show map'}
              >
                {showMap ? <List className="h-3.5 w-3.5" /> : <Map className="h-3.5 w-3.5" />}
                {showMap ? 'List' : 'Map'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="hidden sm:flex whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-line-hi"
                style={{ border: '1px solid var(--line)', color: copied ? 'var(--pass)' : 'var(--haze)' }}
                title="Copy search link"
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <WatchSearchButton filters={filters} />
            </div>
          </div>
        </div>

        {/* Expandable filter panel */}
        {showFilters && (
          <div className="mx-auto max-w-7xl border-t px-6 py-4 lg:px-8" style={{ borderColor: 'var(--line)' }}>
            <PropertyFilters />
          </div>
        )}
      </div>

      {/* Content: cards + map */}
      <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
        <div className={`grid gap-6 ${showMap ? 'grid-cols-1 lg:grid-cols-[1fr_45%] lg:gap-8' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>

          {/* Cards */}
          <div>
            {loading ? (
              <div className={`grid gap-6 ${showMap ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--line)', background: 'var(--ink-panel)' }}>
                    <div className="aspect-[4/3] animate-pulse" style={{ background: 'var(--ink-2)' }} />
                    <div className="space-y-3 p-4">
                      <div className="h-5 w-24 rounded" style={{ background: 'var(--ink-2)' }} />
                      <div className="h-3 w-32 rounded" style={{ background: 'var(--ink-2)' }} />
                      <div className="h-3 w-20 rounded" style={{ background: 'var(--ink-2)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : properties.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed p-16 text-center"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-panel)' }}
              >
                <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>No properties match your search</p>
                <p className="mt-1.5 text-[13px]" style={{ color: 'var(--haze)' }}>Try adjusting your filters or criteria.</p>
              </div>
            ) : (
              <>
                <div className={`grid gap-6 ${showMap ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                  {properties.map((p) => (
                    <SearchCard key={p.id} property={p} />
                  ))}
                </div>

                {hasMore && (
                  <div className="mt-8 text-center">
                    <button
                      onClick={() => loadProperties(page + 1)}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-2 rounded-full border px-6 py-2.5 text-[13px] font-medium transition-colors hover:border-line-hi disabled:opacity-50"
                      style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
                    >
                      {loadingMore ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</> : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Map */}
          {showMap && (
            <div
              className="relative overflow-hidden rounded-2xl border lg:sticky lg:top-[140px] lg:h-[calc(100vh-160px)]"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
