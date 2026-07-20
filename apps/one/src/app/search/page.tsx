'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useQueryStates } from 'nuqs';
import Link from 'next/link';
import { Loader2, SlidersHorizontal, Map, List } from 'lucide-react';
import type maplibregl from 'maplibre-gl';
import { PropertyMap } from '@/components/PropertyMap';
import { DrawSearch } from '@oper/map/controls/DrawSearch';
import { SearchCard } from '@/components/search/SearchCard';
import { ResultsTable } from '@/components/search/ResultsTable';
import { WatchSearchButton } from '@/components/WatchSearchButton';
import { FirstRunCoach } from '@/components/search/FirstRunCoach';
import { usePrefs } from '@/lib/prefs';
import { useSessionUser } from '@/lib/useSessionUser';
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
  const [tableView, setTableView] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list');

  const [qs, setQs] = useQueryStates(propertyFilterParsers, { history: 'replace', shallow: true });
  const filters = useMemo(() => toFilterState(qs), [qs]);

  const { prefs } = usePrefs();
  const myAreas = prefs.areas;
  const sessionUser = useSessionUser();

  const [welcomeCtaDismissed, setWelcomeCtaDismissed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('welcome-cta-dismissed') === '1') setWelcomeCtaDismissed(true);
    } catch { /* SSR/private mode */ }
  }, []);
  function dismissWelcomeCta() {
    try { localStorage.setItem('welcome-cta-dismissed', '1'); } catch { /* ignore */ }
    setWelcomeCtaDismissed(true);
  }

  function applyArea(zip: string) {
    setQs({ q: zip });
  }

  // Split-view sync (A2): hover both directions + viewport-bound list.
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null); // list -> map
  const [mapHoveredId, setMapHoveredId] = useState<string | null>(null);  // map -> list
  const [searchAsMove, setSearchAsMove] = useState(true);
  const [mapBounds, setMapBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [pendingArea, setPendingArea] = useState(false); // searchAsMove off + map moved
  const boundsRef = useRef(mapBounds);
  boundsRef.current = mapBounds;
  // A3: draw-to-search. Serialized 'lng,lat;...' — supersedes bounds server-side.
  const [polygon, setPolygon] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('oper:map:searchAsMove');
      if (stored != null) setSearchAsMove(stored === '1');
    } catch { /* SSR/private mode */ }
  }, []);

  // Viewport restore: /search?mv=lng,lat,zoom (written below on move).
  const initialView = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('mv');
    if (!raw) return null;
    const [lng, lat, z] = raw.split(',').map(Number);
    if (![lng, lat, z].every(Number.isFinite)) return null;
    return { center: [lng, lat] as [number, number], zoom: z };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleSearchAsMove = (on: boolean) => {
    setSearchAsMove(on);
    try { localStorage.setItem('oper:map:searchAsMove', on ? '1' : '0'); } catch { /* ignore */ }
  };

  // Map -> list: highlight + keep the row visible.
  useEffect(() => {
    if (!mapHoveredId) return;
    const el = document.querySelector(`[data-listing-id="${CSS.escape(mapHoveredId)}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [mapHoveredId]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadProperties(1), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, qs.sold, qs.pmin, qs.pmax, qs.beds, qs.baths, qs.op, qs.cap, qs.coc, qs.type, qs.sale, qs.strat, qs.hoamax, qs.dom, qs.cut, qs.q, mapBounds, polygon]);

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
        // Lifecycle opt-in (#53): the "Include sold" pill flips the `sold` nuqs
        // param → showSold → includeSold, relaxing the sold exclusion so SOLD
        // cards render. Stale + rental_misfiled stay hidden regardless.
        includeSold: filters.showSold || undefined,
        q: qs.q || undefined,
        bounds: showMap && mapBounds ? mapBounds : undefined,
        polygon: showMap && polygon ? polygon : undefined,
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
              <span className="hidden sm:inline text-[12px]" style={{ color: 'var(--mute)' }} aria-live="polite">
                {loading ? 'Loading…' : `${num.format(properties.length)} properties`}
              </span>
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
                onClick={() => setQs({ sold: !qs.sold })}
                aria-pressed={qs.sold}
                className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-line-hi"
                style={{ borderColor: qs.sold ? 'var(--pass)' : 'var(--line)', color: qs.sold ? 'var(--pass)' : 'var(--haze)' }}
                title={qs.sold ? 'Hide sold listings' : 'Include sold listings'}
              >
                Include sold
              </button>
              <button
                onClick={() => setTableView(!tableView)}
                className="hidden sm:flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-line-hi"
                style={{ borderColor: tableView ? 'var(--pass)' : 'var(--line)', color: tableView ? 'var(--pass)' : 'var(--haze)' }}
                title={tableView ? 'Card view' : 'Table view'}
              >
                {tableView ? 'Cards' : 'Table'}
              </button>
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
              <span data-coach="save" className="contents">
                <WatchSearchButton filters={filters} />
              </span>
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
      <div className="mx-auto max-w-7xl px-6 py-6 pb-24 lg:px-8 lg:pb-6">
        {sessionUser && myAreas.length === 0 && !welcomeCtaDismissed && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--r-panel)] border border-line bg-card px-4 py-3">
            <span className="prov flex-1">
              <Link href="/welcome" className="font-semibold text-pass transition-colors hover:text-pass-hi">
                Tell us your markets and we&apos;ll watch them for you →
              </Link>
            </span>
            <button
              type="button"
              onClick={dismissWelcomeCta}
              className="rounded-full border border-line px-3 py-1 text-xs font-medium text-haze transition-colors hover:border-line-hi hover:text-foreground"
              aria-label="Dismiss suggestion"
            >
              Dismiss ×
            </button>
          </div>
        )}
        {myAreas.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="prov">my areas</span>
            {myAreas.map((a) => (
              <button
                key={`${a.zip}`}
                onClick={() => applyArea(a.zip)}
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-haze transition-colors hover:border-pass hover:text-pass"
              >
                {a.label} <span className="tabular-nums">{a.zip}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`grid gap-6 ${showMap ? 'grid-cols-1 lg:grid-cols-[1fr_45%] lg:gap-8' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>

          {/* Cards */}
          <div data-coach="cards" className={mobileTab === 'map' ? 'hidden lg:block' : ''}>
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
            ) : tableView ? (
              <>
                <ResultsTable
                  properties={properties}
                  sortBy={sortBy}
                  onSort={setSortBy}
                  onHover={showMap ? setHoveredCardId : undefined}
                  highlightedId={mapHoveredId}
                />

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
            ) : (
              <>
                <div className={`grid gap-6 ${showMap ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'}`}>
                  {properties.map((p) => (
                    <SearchCard
                      key={p.id}
                      property={p}
                      onHover={showMap ? setHoveredCardId : undefined}
                      highlighted={mapHoveredId === p.id}
                    />
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
              data-coach="map"
              className={`relative overflow-hidden rounded-2xl border lg:sticky lg:top-[140px] lg:h-[calc(100vh-160px)] ${mobileTab === 'list' ? 'hidden lg:block' : 'h-[68vh]'}`}
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
                hoveredId={hoveredCardId}
                onFeatureHover={setMapHoveredId}
                onMapInstance={(m, r) => { setMapInstance(m); setMapReady(r); }}
                showLayerControls
                initialCenter={initialView?.center}
                initialZoom={initialView?.zoom}
                onViewportChange={(b) => {
                  // Shareable viewport: write ?mv= without a Next navigation.
                  try {
                    const u = new URL(window.location.href);
                    u.searchParams.set('mv', `${((b.east + b.west) / 2).toFixed(4)},${((b.north + b.south) / 2).toFixed(4)},${b.zoom.toFixed(1)}`);
                    window.history.replaceState(window.history.state, '', u);
                  } catch { /* ignore */ }
                  // Only bound the list once the user is looking at an area,
                  // not at the whole-country initial view.
                  if (b.zoom < 8) {
                    if (boundsRef.current) setMapBounds(null);
                    return;
                  }
                  const next = { north: b.north, south: b.south, east: b.east, west: b.west };
                  if (searchAsMove) setMapBounds(next);
                  else {
                    boundsRef.current = next; // stash for the chip
                    setPendingArea(true);
                  }
                }}
              />
              {/* search-as-move control */}
              <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                <label
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur"
                  style={{ background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)', color: 'var(--text)' }}
                >
                  <input
                    type="checkbox"
                    checked={searchAsMove}
                    onChange={(e) => toggleSearchAsMove(e.target.checked)}
                    className="h-3 w-3 accent-[var(--pass)]"
                  />
                  Search as I move
                </label>
                {!searchAsMove && pendingArea && (
                  <button
                    onClick={() => {
                      setPendingArea(false);
                      setMapBounds(boundsRef.current ? { ...boundsRef.current } : null);
                    }}
                    className="rounded-full border px-3 py-1.5 text-[12px] font-semibold backdrop-blur transition-colors hover:opacity-90"
                    style={{ background: 'var(--pass)', borderColor: 'var(--pass)', color: 'var(--ink)' }}
                  >
                    Search this area
                  </button>
                )}
                {mapBounds && !polygon && (
                  <button
                    onClick={() => { setMapBounds(null); setPendingArea(false); }}
                    className="rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur transition-colors hover:opacity-80"
                    style={{ background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)', color: 'var(--haze)' }}
                    title="Stop limiting results to the map area"
                  >
                    Clear area ×
                  </button>
                )}
                <DrawSearch
                  map={mapInstance}
                  ready={mapReady}
                  onPolygon={(coords) =>
                    setPolygon(coords ? coords.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(';') : null)
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile List|Map segmented control (thumb zone) — desktop keeps split view */}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center lg:hidden">
        <div
          className="pointer-events-auto flex overflow-hidden rounded-full border shadow-lg"
          style={{ borderColor: 'var(--line-hi)', background: 'var(--ink-panel)' }}
          role="tablist"
          aria-label="Search view"
        >
          {(['list', 'map'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={mobileTab === t}
              onClick={() => setMobileTab(t)}
              className="px-6 py-2.5 text-[13px] font-semibold capitalize"
              style={mobileTab === t ? { background: 'var(--text)', color: 'var(--ink)' } : { color: 'var(--haze)' }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <FirstRunCoach />
    </div>
  );
}
