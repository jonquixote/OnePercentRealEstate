'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MapGL, { Layer, Source, type MapRef, type MapMouseEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const TILE_URL = process.env.NEXT_PUBLIC_TILE_URL ?? '/tiles';

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

interface PopupInfo {
  longitude: number;
  latitude: number;
  id: string;
  address: string;
  city: string;
  state: string;
  price: number;
  estimated_rent: number;
  ratio_pct: number;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
}

function formatPrice(n: number): string {
  if (!n) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Property map using MVT vector tiles from pg_tileserv.
 *
 * Previous version used GeoJSON clustering which double-clustered
 * (backend pre-clustered + Mapbox client cluster = 1 mega-pin).
 * This version renders individual points from vector tiles with
 * zoom-based sizing and ratio-based coloring.
 */
export function PropertyMap({ filters, onMarkerClick }: PropertyMapProps) {
  const mapRef = useRef<MapRef>(null);
  const router = useRouter();
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [cursor, setCursor] = useState<string>('');

  // Build tile URL with filter params
  const listingStatus = filters?.status ?? 'for_sale';
  const saleType = filters?.saleType && filters.saleType !== '' ? filters.saleType : 'standard';
  const tileUrl = `${TILE_URL}/public.listings_mvt/{z}/{x}/{y}.pbf?p_listing_status=${listingStatus}&p_sale_type=${saleType}`;

  const onMouseEnter = useCallback(() => setCursor('pointer'), []);
  const onMouseLeave = useCallback(() => {
    setCursor('');
    setPopup(null);
  }, []);

  const onClick = useCallback(
    (event: MapMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature || !feature.properties) return;

      const props = feature.properties;

      // Cluster: zoom in
      if (props.count != null && !props.id) {
        const map = mapRef.current;
        if (map && event.lngLat) {
          map.flyTo({
            center: [event.lngLat.lng, event.lngLat.lat],
            zoom: Math.min((map.getZoom() ?? 3) + 2, 14),
            duration: 500,
          });
        }
        return;
      }

      // Individual point: navigate
      const id = String(props.id);
      if (onMarkerClick) {
        onMarkerClick(id);
      } else {
        router.push(`/property/${id}`);
      }
    },
    [onMarkerClick, router]
  );

  const onHover = useCallback((event: MapMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature || !feature.properties) {
      setPopup(null);
      return;
    }

    const props = feature.properties;
    // MVT features have coordinates in the geometry
    const [lng, lat] = event.lngLat ? [event.lngLat.lng, event.lngLat.lat] : [0, 0];

    setPopup({
      longitude: lng,
      latitude: lat,
      id: String(props.id),
      address: props.address ?? '',
      city: props.city ?? '',
      state: props.state ?? '',
      price: Number(props.price) || 0,
      estimated_rent: Number(props.estimated_rent) || 0,
      ratio_pct: Number(props.ratio_pct) || 0,
      property_type: props.property_type ?? '',
      bedrooms: Number(props.bedrooms) || 0,
      bathrooms: Number(props.bathrooms) || 0,
    });
  }, []);

  return (
    <div
      className="relative h-full w-full"
      aria-label="Property map showing investment opportunities across the United States"
      role="application"
    >
      <MapGL
        ref={mapRef}
        initialViewState={{
          latitude: 39.8,
          longitude: -98.6,
          zoom: 3.5,
        }}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={['listings-circle', 'listings-cluster']}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseMove={onHover}
        cursor={cursor}
        attributionControl={false}
        reuseMaps
      >
        <Source
          id="listings-tiles"
          type="vector"
          tiles={[tileUrl]}
          minzoom={2}
          maxzoom={14}
        >
          {/* ── Cluster circles (z <= 7): MVT returns grid-aggregated centroids with 'count' ── */}
          <Layer
            id="listings-cluster"
            type="circle"
            source-layer="listings"
            filter={['has', 'count']}
            paint={{
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'count'],
                1, 8,
                50, 16,
                500, 24,
                5000, 36,
                50000, 48,
              ],
              'circle-color': [
                'interpolate', ['linear'], ['to-number', ['get', 'ratio_pct'], 0],
                0, '#94a3b8',
                0.3, '#ef4444',
                0.6, '#f59e0b',
                1.0, '#10b981',
                1.5, '#059669',
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.85,
            }}
          />

          {/* Cluster count labels */}
          <Layer
            id="listings-cluster-label"
            type="symbol"
            source-layer="listings"
            filter={['has', 'count']}
            layout={{
              'text-field': ['to-string', ['get', 'count']],
              'text-size': 11,
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#ffffff',
            }}
          />

          {/* ── Individual property circles (z > 7): MVT returns full point details ── */}
          <Layer
            id="listings-circle"
            type="circle"
            source-layer="listings"
            filter={['has', 'id']}
            paint={{
              'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                8, 3,
                10, 5,
                12, 6,
                14, 10,
              ],
              'circle-color': [
                'interpolate', ['linear'], ['to-number', ['get', 'ratio_pct'], 0],
                0, '#94a3b8',
                0.3, '#ef4444',
                0.6, '#f59e0b',
                1.0, '#10b981',
                1.5, '#059669',
              ],
              'circle-stroke-width': [
                'interpolate', ['linear'], ['zoom'],
                8, 0.5,
                12, 1,
              ],
              'circle-stroke-color': '#ffffff',
              'circle-opacity': [
                'interpolate', ['linear'], ['zoom'],
                8, 0.75,
                12, 0.85,
                14, 0.95,
              ],
            }}
          />
        </Source>
      </MapGL>

      {/* Hover tooltip */}
      {popup && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-ink-panel/95 p-3 shadow-xl backdrop-blur"
          style={{
            left: mapRef.current?.project([popup.longitude, popup.latitude]).x ?? 0,
            top: (mapRef.current?.project([popup.longitude, popup.latitude]).y ?? 0) - 12,
          }}
        >
          <p className="text-xs font-semibold text-white line-clamp-1">{popup.address}</p>
          <p className="text-[10px] text-muted-foreground">
            {[popup.city, popup.state].filter(Boolean).join(', ')}
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-sm font-semibold tabular-nums text-white">
              {formatPrice(popup.price)}
            </span>
            {popup.ratio_pct > 0 && (
              <span
                className={`font-mono text-[11px] font-semibold tabular-nums ${
                  popup.ratio_pct >= 1.0 ? 'text-pass-hi' : 'text-brass-hi'
                }`}
              >
                {popup.ratio_pct.toFixed(2)}%
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {popup.bedrooms}bd · {popup.bathrooms}ba
            {popup.property_type && ` · ${popup.property_type.replace(/_/g, ' ')}`}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-line bg-ink-panel/90 p-2 shadow-sm backdrop-blur">
        <p className="mb-1 text-[10px] font-medium text-haze">Rent / Price Ratio</p>
        <div className="flex items-center gap-1.5">
          {[
            { color: '#ef4444', label: '<0.6%' },
            { color: '#f59e0b', label: '0.6–1%' },
            { color: '#10b981', label: '≥1%' },
            { color: '#059669', label: '≥1.5%' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-0.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[9px] text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
