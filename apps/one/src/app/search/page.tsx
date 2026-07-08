'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useQueryStates } from 'nuqs';
import { Loader2 } from 'lucide-react';
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

  // Build active filter chips from nuqs state
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (qs.pmin > 0) {
      chips.push({
        key: 'pmin',
        label: `≥ $${num.format(qs.pmin)}`,
        onRemove: () => setQs({ pmin: null }),
      });
    }
    if (qs.pmax < 2000000) {
      chips.push({
        key: 'pmax',
        label: `≤ $${num.format(qs.pmax)}`,
        onRemove: () => setQs({ pmax: null }),
      });
    }
    if (qs.beds > 0) {
      chips.push({
        key: 'beds',
        label: `${qs.beds}+ bd`,
        onRemove: () => setQs({ beds: null }),
      });
    }
    if (qs.baths > 0) {
      chips.push({
        key: 'baths',
        label: `${qs.baths}+ ba`,
        onRemove: () => setQs({ baths: null }),
      });
    }
    if (qs.op) {
      chips.push({
        key: 'op',
        label: 'Clears the line',
        onRemove: () => setQs({ op: null }),
      });
    }
    if (qs.cut) {
      chips.push({
        key: 'cut',
        label: 'Price reduced',
        onRemove: () => setQs({ cut: null }),
      });
    }
    if (qs.type) {
      chips.push({
        key: 'type',
        label: qs.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        onRemove: () => setQs({ type: null }),
      });
    }
    return chips;
  }, [qs, setQs]);

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>

      {/* sticky pill toolbar */}
      <div
        className="sticky top-0 z-20 border-b px-6 py-3 backdrop-blur"
        style={{ background: 'rgba(11,13,16,.92)', borderColor: 'var(--line)' }}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="rounded-full border px-4 py-1.5 text-[13px] font-medium whitespace-nowrap"
            style={{ borderColor: 'var(--line-hi)' }}
          >
            {showFilters ? 'Done' : 'Filters'}
          </button>

          {/* active filter chips */}
          {activeChips.map((chip, i) => (
            <span
              key={chip.key}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] cursor-pointer"
              style={{
                background: chip.key === 'cut' ? 'var(--brass-dim)' : 'var(--pass-dim)',
                color: chip.key === 'cut' ? 'var(--brass-hi)' : 'var(--pass-hi)',
              }}
              onClick={chip.onRemove}
              role="button"
              aria-label={`Remove filter: ${chip.label}`}
            >
              {chip.label} <span style={{ color: 'var(--mute)' }}>×</span>
            </span>
          ))}

          {activeChips.length === 0 && !showFilters && (
            <span className="text-[12.5px]" style={{ color: 'var(--mute)' }}>
              {properties.length > 0
                ? `${num.format(properties.length)} properties`
                : loading ? 'Loading…' : 'No filters active'}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded-full border bg-transparent px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
              }}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{ border: '1px solid var(--line)', color: 'var(--haze)' }}
              title="Copy search link"
              aria-label="Copy search link to clipboard"
            >
              Copy link
            </button>
            <WatchSearchButton filters={filters} />
          </div>
        </div>

        {/* expandable filter panel */}
        {showFilters && (
          <div className="mx-auto mt-3 max-w-7xl border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <PropertyFilters />
          </div>
        )}
      </div>

      {/* gallery + map split */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-2">
        {/* gallery cards */}
        <div>
          {loading ? (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="mat animate-pulse">
                    <div className="aspect-[4/3] rounded-[6px] bg-ink-2" />
                  <div className="mt-4 space-y-2">
                    <div className="h-5 w-20 rounded bg-ink-2" />
                    <div className="h-3 w-32 rounded bg-ink-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : properties.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed p-12 text-center"
              style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,.02)' }}
            >
              <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>No properties match your search</p>
              <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>Try adjusting your filters or criteria.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
              {properties.map((p) => (
                <SearchCard key={p.id} property={p} />
              ))}
            </div>
          )}

          {hasMore && !loading && (
            <div className="mt-10 text-center">
              <button
                onClick={() => loadProperties(page + 1)}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-full border px-6 py-2.5 text-[13px] font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
              >
                {loadingMore ? <><Loader2 className="h-4 w-4 animate-spin" />Loading…</> : 'Load more'}
              </button>
            </div>
          )}
        </div>

        {/* map panel (desktop only) */}
        <div
          className={`relative overflow-hidden rounded-[var(--r-panel)] border lg:block ${showMap ? 'block h-[60vh]' : 'hidden'}`}
          style={{ borderColor: 'var(--line)', background: 'var(--ink-2)', minHeight: 560 }}
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
      </div>
    </div>
  );
}
