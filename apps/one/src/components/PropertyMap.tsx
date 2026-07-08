'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type * as GeoJSON from 'geojson';

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
}

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

type ViewportResponse =
  | { type: 'clusters'; data: Array<{ latitude: number; longitude: number; count: number; avg_price: number; min_price: number; max_price: number }> }
  | { type: 'properties'; data: Array<{ id: number | string; address: string; price: number; bedrooms: number; bathrooms: number; sqft: number; primary_photo: string | null; latitude: number; longitude: number }> };

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function PropertyMap({ filters, onMarkerClick }: PropertyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const router = useRouter();
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const reqIdRef = useRef(0);
  const lastSelectedRef = useRef<string | number | null>(null);

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

  const refresh = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !map.getSource('listings')) return;
    const myId = ++reqIdRef.current;
    try {
      const res = await fetch(buildUrl(map), { cache: 'no-store' });
      if (!res.ok) return;
      const json: ViewportResponse = await res.json();
      if (myId !== reqIdRef.current) return; // stale
      const features: GeoJSON.Feature[] = [];
      if (json.type === 'clusters') {
        for (const c of json.data) {
          if (c.longitude == null || c.latitude == null) continue;
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(c.longitude), Number(c.latitude)] },
            properties: { cluster: true, count: Number(c.count), avg_price: Number(c.avg_price), min_price: Number(c.min_price), max_price: Number(c.max_price) },
          });
        }
      } else {
        for (const pt of json.data) {
          if (pt.longitude == null || pt.latitude == null) continue;
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(pt.longitude), Number(pt.latitude)] },
            properties: { id: String(pt.id), address: pt.address, price: Number(pt.price) || 0, bedrooms: pt.bedrooms, bathrooms: pt.bathrooms, sqft: pt.sqft, primary_photo: pt.primary_photo },
          });
        }
      }
      (map.getSource('listings') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
    } catch {
      /* ignore */
    }
  }, [buildUrl]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-98.6, 39.8],
      zoom: 3.5,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // The map lives in a sticky / calc()-height column that may not have its
    // final size when Mapbox measures the container at construction (canvas can
    // stick at a wrong height and never paint tiles). A ResizeObserver keeps the
    // canvas matched to the container — the standard fix for dynamic layouts.
    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);

      map.on('load', () => {
      map.resize();

      // Fix N2: Basemap label contrast overrides
      const labelLayers = map.getStyle().layers.filter(l => l.id.includes('label') || l.id.includes('place') || l.id.includes('road'));
      for (const layer of labelLayers) {
        try {
          map.setPaintProperty(layer.id, 'text-color', '#2a2520');
          map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(250,247,242,.85)');
          map.setPaintProperty(layer.id, 'text-halo-width', 1.5);
        } catch { /* skip non-text layers */ }
      }
      map.addSource('listings', { type: 'geojson', data: EMPTY });
      map.addSource('listings-mvt', {
        type: 'vector',
        tiles: [getTileUrl()],
        minzoom: 0,
        maxzoom: 20,
      });

      // cluster circles — visible through z9 to overlap with MVT minzoom 9
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'listings',
        maxzoom: 10,
        filter: ['==', ['get', 'cluster'], true],
        paint: {
          'circle-color': '#0e7a52',
          'circle-opacity': 0.85,
          'circle-stroke-color': '#faf7f2',
          'circle-stroke-width': 1.5,
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 12, 50, 18, 500, 26, 5000, 36, 50000, 48],
        },
      });
      // cluster counts — visible through z9 for overlap
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'listings',
        maxzoom: 10,
        filter: ['==', ['get', 'cluster'], true],
        layout: {
          'text-field': ['to-string', ['get', 'count']],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 12,
          'text-allow-overlap': true,
        },
         paint: { 'text-color': '#faf7f2' },
      });

      // Fix 1: Invisible hit layer under mvt-points — radius 22 for Fitts-friendly clicks
      map.addLayer({
        id: 'mvt-hit',
        type: 'circle',
        source: 'listings-mvt',
        'source-layer': 'listings',
        minzoom: 9,
        paint: {
          'circle-color': '#000',
          'circle-opacity': 0,
          'circle-radius': 22,
        },
      });

      // Fix 1+3: MVT points with brass for cut listings, ink stroke, feature-state halo
      map.addLayer({
        id: 'mvt-points',
        type: 'circle',
        source: 'listings-mvt',
        'source-layer': 'listings',
        minzoom: 9,
        paint: {
          'circle-color': ['case',
            ['>', ['coalesce', ['get', 'price_cut_pct'], 0], 0], '#c9a35c', // brass for cuts
            '#1f9d6e', // emerald for normal
          ],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 7, 16, 10],
          'circle-stroke-color': '#faf7f2',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.95,
        },
      });

      // Selected halo layer (added below mvt-points so it renders behind)
      map.addLayer({
        id: 'mvt-selected-halo',
        type: 'circle',
        source: 'listings-mvt',
        'source-layer': 'listings',
        minzoom: 9,
        filter: ['==', ['feature-state', 'selected'], true],
        paint: {
          'circle-color': 'transparent',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 14, 12, 16, 15],
          'circle-stroke-color': '#2a2520',
          'circle-stroke-width': 2,
          'circle-opacity': 0.9,
        },
      });

      refresh();
    });

    let t: ReturnType<typeof setTimeout> | null = null;
    map.on('moveend', () => {
      if (t) clearTimeout(t);
      t = setTimeout(refresh, 150);
    });

    // cluster click → zoom in
    map.on('click', 'clusters', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2.5, 15), duration: 500 });
    });
    // Fix 1+2+4: click on hit layer OR visible points → navigate
    const handlePointClick = (e: maplibregl.MapMouseEvent & { features?: GeoJSON.Feature[] | undefined }) => {
      const f = e.features?.[0];
      const id = f?.properties?.id;
      if (!id) return;
      // Clear previous selection before setting new one
      if (lastSelectedRef.current !== null && lastSelectedRef.current !== id) {
        map.setFeatureState({ source: 'listings-mvt', sourceLayer: 'listings', id: lastSelectedRef.current }, { selected: false });
      }
      map.setFeatureState({ source: 'listings-mvt', sourceLayer: 'listings', id }, { selected: true });
      lastSelectedRef.current = id;
      if (onMarkerClick) onMarkerClick(String(id));
      else router.push(`/property/${id}`);
    };
    map.on('click', 'mvt-points', handlePointClick);
    map.on('click', 'mvt-hit', handlePointClick);

    // Fix 4: Mini-dossier card on hover (replaces bare popup)
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'op-map-popup', offset: 12 });
    popupRef.current = popup;
    const showMiniDossier = (e: maplibregl.MapMouseEvent & { features?: GeoJSON.Feature[] | undefined }) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as any;
      const geom = f.geometry as GeoJSON.Point;
      if (!geom?.coordinates) return;
      const [lng, lat] = geom.coordinates as [number, number];

      const root = document.createElement('div');
       root.style.cssText = 'background:var(--ink-panel);border:1px solid var(--line-hi);border-radius:12px;padding:12px;min-width:220px;box-shadow:0 12px 40px rgba(42,37,32,.18);font-family:var(--font-geist-sans)';

      // Photo mat
      if (p.primary_photo) {
        const img = document.createElement('div');
        img.style.cssText = 'background:var(--ink-mat);border:1px solid var(--line);border-radius:6px;margin-bottom:8px;overflow:hidden';
        const imgEl = document.createElement('img');
        imgEl.src = p.primary_photo;
        imgEl.style.cssText = 'width:100%;height:80px;object-fit:cover;display:block';
        img.append(imgEl);
        root.append(img);
      }

      // Ratio + Price
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
      priceEl.style.cssText = 'font-family:var(--font-geist-mono);font-size:14px;font-weight:600;color:var(--text)';
      priceEl.textContent = usd0.format(price);
      row.append(ratio, priceEl);
      root.append(row);

      // Band (placeholder bar)
      if (p.rent_low != null && p.rent_high != null && rent > 0) {
        const loPct = (Number(p.rent_low) / rent) * 100;
        const hiPct = (Number(p.rent_high) / rent) * 100;
        const band = document.createElement('div');
        band.style.cssText = 'position:relative;height:4px;border-radius:2px;background:var(--line);margin-top:6px';
        const fill = document.createElement('div');
        fill.style.cssText = `position:absolute;top:0;bottom:0;left:${Math.max(0, loPct)}%;width:${Math.min(100 - loPct, hiPct - loPct)}%;border-radius:2px;background:rgba(14,122,82,.12)`;
        band.append(fill);
        const mark = document.createElement('div');
        mark.style.cssText = `position:absolute;top:-3px;left:44%;width:2px;height:10px;border-radius:1px;background:var(--pass-hi)`;
        band.append(mark);
        root.append(band);
      }

      // Address
      const addr = document.createElement('div');
      addr.style.cssText = 'font-size:12px;color:var(--haze);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px';
      addr.textContent = p.address ?? '';
      root.append(addr);

      // Open link
      const link = document.createElement('a');
      link.style.cssText = 'display:block;margin-top:8px;text-align:center;font-size:13px;font-weight:600;color:var(--pass-hi);text-decoration:none;cursor:pointer';
      link.textContent = 'Open the dossier →';

      // Use router push on click — but we need the id context
      const id = p.id;
      if (id) {
        link.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (onMarkerClick) onMarkerClick(String(id));
          else router.push(`/property/${id}`);
        });
      }
      root.append(link);

      popup.setLngLat([lng, lat]).setDOMContent(root).addTo(map);
    };
    map.on('mouseenter', 'mvt-points', showMiniDossier);
    map.on('mouseenter', 'mvt-hit', showMiniDossier);
    map.on('mouseleave', 'mvt-points', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('mouseleave', 'mvt-hit', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

    return () => {
      if (t) clearTimeout(t);
      ro.disconnect();
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // refetch when filters change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource('listings-mvt');
    if (src) (src as maplibregl.VectorTileSource).setTiles([getTileUrl()]);
    refresh();
  }, [filters?.minPrice, filters?.maxPrice, filters?.minBeds, filters?.minBaths, filters?.status, filters?.saleType, filters?.propertyType, refresh, getTileUrl]);

  return (
    <div className="relative h-full w-full" aria-label="Property map" role="application">
      <div ref={containerRef} className="h-full w-full" style={{ minHeight: '400px' }} />
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
