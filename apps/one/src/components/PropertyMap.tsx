'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

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

/**
 * Map rebuilt on raw Mapbox GL + the /api/properties/viewport GeoJSON API.
 * No pg_tileserv / vector tiles / nginx tile proxy — a plain geojson source
 * whose data we refresh on every move. Server clusters below z14, individual
 * points at z14+. This is the canonical, reliable Mapbox clustering pattern.
 */
export function PropertyMap({ filters, onMarkerClick }: PropertyMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const router = useRouter();
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const reqIdRef = useRef(0);

  const buildUrl = useCallback((map: mapboxgl.Map) => {
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
      (map.getSource('listings') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features });
    } catch {
      /* ignore */
    }
  }, [buildUrl]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98.6, 39.8],
      zoom: 3.5,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    // The map lives in a sticky / calc()-height column that may not have its
    // final size when Mapbox measures the container at construction (canvas can
    // stick at a wrong height and never paint tiles). A ResizeObserver keeps the
    // canvas matched to the container — the standard fix for dynamic layouts.
    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);

    map.on('load', () => {
      map.resize();
      map.addSource('listings', { type: 'geojson', data: EMPTY });

      // cluster circles
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'listings',
        filter: ['==', ['get', 'cluster'], true],
        paint: {
          'circle-color': '#0e9f6e',
          'circle-opacity': 0.85,
          'circle-stroke-color': '#34e0a1',
          'circle-stroke-width': 1.5,
          'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 12, 50, 18, 500, 26, 5000, 36, 50000, 48],
        },
      });
      // cluster counts
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'listings',
        filter: ['==', ['get', 'cluster'], true],
        layout: {
          'text-field': ['to-string', ['get', 'count']],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#04140d' },
      });
      // individual points
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'listings',
        filter: ['!', ['has', 'cluster']],
        paint: {
          'circle-color': '#34e0a1',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 8, 16, 11],
          'circle-stroke-color': '#0b1220',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.95,
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
    // point click → navigate
    map.on('click', 'points', (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.id;
      if (!id) return;
      if (onMarkerClick) onMarkerClick(String(id));
      else router.push(`/property/${id}`);
    });

    // hover popup on points
    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'op-map-popup', offset: 12 });
    popupRef.current = popup;
    map.on('mouseenter', 'points', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as any;
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      // Build the popup with textContent (auto-escaped) — `address` is scraped
      // MLS data and must never be injected as raw HTML.
      const root = document.createElement('div');
      root.style.cssText = 'font-family:var(--font-geist-sans);min-width:150px';
      const addr = document.createElement('div');
      addr.style.cssText = 'font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px';
      addr.textContent = p.address ?? '';
      const price = document.createElement('div');
      price.style.cssText = 'font-family:var(--font-geist-mono);font-size:14px;font-weight:600;color:#34e0a1;margin-top:2px';
      price.textContent = usd0.format(Number(p.price) || 0);
      const specs = document.createElement('div');
      specs.style.cssText = 'font-size:10px;color:#8a93a6;margin-top:1px';
      specs.textContent = `${p.bedrooms ?? '–'} bd · ${p.bathrooms ?? '–'} ba`;
      root.append(addr, price, specs);
      popup.setLngLat([lng, lat]).setDOMContent(root).addTo(map);
    });
    map.on('mouseleave', 'points', () => {
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
    if (mapRef.current?.isStyleLoaded()) refresh();
  }, [filters?.minPrice, filters?.maxPrice, filters?.minBeds, filters?.minBaths, filters?.status, filters?.saleType, filters?.propertyType, refresh]);

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
