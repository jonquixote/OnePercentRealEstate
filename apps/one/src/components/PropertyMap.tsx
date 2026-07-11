'use client';

// Thin wrapper over @oper/map. Owns app-specific concerns only: the
// viewport/tile URL construction from filter state, the mini-dossier hover
// card (app design tokens), and navigation. Map lifecycle + layers live in
// the shared package so apps/one and apps/two render the same map.
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMemo } from 'react';
import {
  useOperMap,
  addListingsLayers,
  updateViewportData,
  setMvtTiles,
  setHoveredListing,
  useLayerRegistry,
  rentHeatLayer,
  tractLayer,
  floodLayer,
  transitLayer,
  schoolsLayer,
  LayerSwitcher,
  BasemapToggle,
  type ViewportResponse,
} from '@oper/map';

interface PropertyMapProps {
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    minBaths?: number;
    status?: string;
    propertyType?: string;
    saleType?: string;
  };
  onMarkerClick?: (id: string) => void;
  /** A2: list->map hover sync (id of the row being hovered, or null). */
  hoveredId?: string | null;
  /** A2: map->list hover sync. */
  onFeatureHover?: (id: string | null) => void;
  /** A2: viewport sync — fired (debounced) after every map move. */
  onViewportChange?: (b: { north: number; south: number; east: number; west: number; zoom: number }) => void;
  /** A3+: hands the live map instance to sibling controls (DrawSearch, LayerSwitcher). */
  onMapInstance?: (map: maplibregl.Map | null, ready: boolean) => void;
  /** A4/A5/B: render the layer switcher + basemap toggle inside the map. */
  showLayerControls?: boolean;
  /** Overlays on by default (property MiniMap turns rent-heat on). */
  defaultLayers?: string[];
  /** Initial camera (viewport restore from URL / property page focus). */
  initialCenter?: [number, number];
  initialZoom?: number;
  /** Static context map: no drag/zoom interactions (property MiniMap). */
  interactive?: boolean;
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function PropertyMap({ filters, onMarkerClick, hoveredId, onFeatureHover, onViewportChange, onMapInstance, showLayerControls, defaultLayers, initialCenter, initialZoom, interactive }: PropertyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const reqIdRef = useRef(0);

  const buildUrl = useCallback((map: maplibregl.Map) => {
    const b = map.getBounds()!;
    const zoom = Math.floor(map.getZoom());
    const f = filtersRef.current ?? {};
    const p = new URLSearchParams({
      north: String(b.getNorth()),
      south: String(b.getSouth()),
      east: String(b.getEast()),
      west: String(b.getWest()),
      zoom: String(zoom),
    });
    if (f.minPrice) p.set('minPrice', String(f.minPrice));
    if (f.maxPrice && f.maxPrice < 10000000) p.set('maxPrice', String(f.maxPrice));
    if (f.minBeds) p.set('beds', String(f.minBeds));
    if (f.minBaths) p.set('baths', String(f.minBaths));
    if (f.propertyType) p.set('propertyType', f.propertyType);
    if (f.status) p.set('status', f.status);
    if (f.saleType) p.set('saleType', f.saleType);
    return `/api/properties/viewport?${p.toString()}`;
  }, []);

  const getTileUrl = useCallback(() => {
    const f = filtersRef.current ?? {};
    const p = new URLSearchParams({ p_listing_status: f.status ?? 'for_sale' });
    if (f.minPrice) p.set('p_min_price', String(f.minPrice));
    if (f.maxPrice && f.maxPrice < 10000000) p.set('p_max_price', String(f.maxPrice));
    if (f.minBeds) p.set('p_min_beds', String(f.minBeds));
    if (f.minBaths) p.set('p_min_baths', String(f.minBaths));
    if (f.propertyType) p.set('p_property_type', f.propertyType);
    return `/tiles/public.listings_mvt/{z}/{x}/{y}.pbf?${p.toString()}`;
  }, []);

  const navigate = useCallback(
    (id: string) => {
      if (onMarkerClick) onMarkerClick(id);
      else router.push(`/property/${id}`);
    },
    [onMarkerClick, router],
  );

  const onFeatureHoverRef = useRef(onFeatureHover);
  onFeatureHoverRef.current = onFeatureHover;

  // Mini-dossier hover card (design-approved DOM, moved verbatim).
  const buildHoverCard = useCallback(
    (p: Record<string, unknown>, open: () => void): HTMLElement => {
      const root = document.createElement('div');
      root.style.cssText =
        'background:var(--ink-panel);border:1px solid var(--line-hi);border-radius:12px;padding:12px;min-width:220px;box-shadow:0 12px 40px rgba(42,37,32,.18);font-family:var(--font-geist-sans)';

      if (p.primary_photo) {
        const img = document.createElement('div');
        img.style.cssText =
          'background:var(--ink-mat);border:1px solid var(--line);border-radius:6px;margin-bottom:8px;overflow:hidden';
        const imgEl = document.createElement('img');
        imgEl.src = String(p.primary_photo);
        imgEl.style.cssText = 'width:100%;height:80px;object-fit:cover;display:block';
        img.append(imgEl);
        root.append(img);
      }

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between';
      const cutPct = Number(p.price_cut_pct) || 0;
      const ratioColor = cutPct > 0 ? 'var(--brass-hi)' : 'var(--pass-hi)';
      const ratio = document.createElement('span');
      ratio.style.cssText = `font-family:var(--font-geist-mono);font-size:18px;font-weight:600;color:${ratioColor}`;
      const price = Number(p.price) || 0;
      const rent = Number(p.estimated_rent) || 0;
      const rpct = price > 0 && rent > 0 ? ((rent / price) * 100).toFixed(2) : null;
      ratio.textContent = rpct ? `${rpct}%` : '—';
      const priceEl = document.createElement('span');
      priceEl.style.cssText =
        'font-family:var(--font-geist-mono);font-size:14px;font-weight:600;color:var(--text)';
      priceEl.textContent = usd0.format(price);
      row.append(ratio, priceEl);
      root.append(row);

      if (p.rent_low != null && p.rent_high != null && rent > 0) {
        const loPct = (Number(p.rent_low) / rent) * 100;
        const hiPct = (Number(p.rent_high) / rent) * 100;
        const band = document.createElement('div');
        band.style.cssText =
          'position:relative;height:4px;border-radius:2px;background:var(--line);margin-top:6px';
        const fill = document.createElement('div');
        fill.style.cssText = `position:absolute;top:0;bottom:0;left:${Math.max(0, loPct)}%;width:${Math.min(100 - loPct, hiPct - loPct)}%;border-radius:2px;background:rgba(14,122,82,.12)`;
        band.append(fill);
        const mark = document.createElement('div');
        mark.style.cssText =
          'position:absolute;top:-3px;left:44%;width:2px;height:10px;border-radius:1px;background:var(--pass-hi)';
        band.append(mark);
        root.append(band);
      }

      const addr = document.createElement('div');
      addr.style.cssText =
        'font-size:12px;color:var(--haze);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px';
      addr.textContent = String(p.address ?? '');
      root.append(addr);

      const link = document.createElement('a');
      link.style.cssText =
        'display:block;margin-top:8px;text-align:center;font-size:13px;font-weight:600;color:var(--pass-hi);text-decoration:none;cursor:pointer';
      link.textContent = 'Open the dossier →';
      link.addEventListener('click', (ev) => {
        ev.stopPropagation();
        open();
      });
      root.append(link);
      return root;
    },
    [],
  );

  const refresh = useCallback(async (map: maplibregl.Map) => {
    const myId = ++reqIdRef.current;
    try {
      const res = await fetch(buildUrl(map), { cache: 'no-store' });
      if (!res.ok) return;
      const json: ViewportResponse = await res.json();
      if (myId !== reqIdRef.current) return; // stale
      updateViewportData(map, json);
    } catch {
      /* ignore */
    }
  }, [buildUrl]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const esriKey = process.env.NEXT_PUBLIC_ESRI_API_KEY;
  const { mapRef, ready, onStyleLoad, setBasemap, basemap } = useOperMap({
    container: containerRef,
    esriKey,
    center: initialCenter,
    zoom: initialZoom,
    interactive,
    onMoveEnd: (map) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        refresh(map);
        const b = map.getBounds();
        if (b && onViewportChangeRef.current) {
          onViewportChangeRef.current({
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
            zoom: map.getZoom(),
          });
        }
      }, 150);
    },
  });

  const installedRef = useRef(false);
  useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;
    onStyleLoad((map) => {
      addListingsLayers(map, {
        tileUrl: getTileUrl,
        onSelect: navigate,
        onHoverFeature: (id) => onFeatureHoverRef.current?.(id),
        buildHoverCard,
      });
      refresh(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refetch when filters change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    setMvtTiles(map, getTileUrl());
    refresh(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.minPrice, filters?.maxPrice, filters?.minBeds, filters?.minBaths, filters?.status, filters?.saleType, filters?.propertyType]);

  // A2: list -> map hover sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setHoveredListing(map, hoveredId ?? null);
  }, [hoveredId, ready, mapRef]);

  // A3+: expose the live instance to sibling controls.
  useEffect(() => {
    onMapInstance?.(mapRef.current, ready);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // A5/B: overlay registry. Defs are stable for the component lifetime.
  const overlayDefs = useMemo(
    () => [rentHeatLayer(), tractLayer(), floodLayer(), transitLayer(), schoolsLayer()],
    [],
  );
  const { toggles } = useLayerRegistry(showLayerControls || defaultLayers ? mapRef.current : null, ready, overlayDefs);

  // Default-on layers (e.g. rent-heat on the property MiniMap) — applied once.
  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (!defaultLayers?.length || defaultsAppliedRef.current || !ready) return;
    defaultsAppliedRef.current = true;
    for (const t of toggles) {
      if (defaultLayers.includes(t.def.id) && !t.on) t.set(true);
    }
  }, [defaultLayers, toggles, ready]);

  return (
    <div className="relative h-full w-full" aria-label="Property map" role="application">
      <div ref={containerRef} className="h-full w-full" style={{ minHeight: '400px' }} />
      {showLayerControls && (
        <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
          <BasemapToggle basemap={basemap} setBasemap={setBasemap} hasSatellite={!!esriKey} />
          <LayerSwitcher toggles={toggles} />
        </div>
      )}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-line bg-ink-panel/90 p-2 shadow-sm backdrop-blur">
        <p className="mb-1 text-[10px] font-medium text-haze">Map</p>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-pass" />Cluster</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-pass-hi" />Listing</span>
        </div>
      </div>
    </div>
  );
}
