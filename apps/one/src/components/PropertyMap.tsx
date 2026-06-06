'use client';

import * as React from 'react';
import Map, { Source, Layer, type MapRef, type ViewStateChangeEvent } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useRouter } from 'next/navigation';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const clusterLayer: any = {
  id: 'clusters',
  type: 'circle',
  source: 'listings-source',
  filter: ['>=', ['get', 'cluster'], 1],
  paint: {
    'circle-color': [
      'step',
      ['get', 'point_count'],
      '#51bbd6',
      10,
      '#f1f075',
      50,
      '#f28cb1',
    ],
    'circle-radius': [
      'step',
      ['get', 'point_count'],
      18,
      10,
      24,
      50,
      32,
    ],
    'circle-stroke-width': 3,
    'circle-stroke-color': '#ffffff',
    'circle-opacity': 0.9,
  },
};

const clusterCountLayer: any = {
  id: 'cluster-count',
  type: 'symbol',
  source: 'listings-source',
  filter: ['>=', ['get', 'cluster'], 1],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
    'text-size': 13,
  },
  paint: {
    'text-color': '#1a1a2e',
  },
};

const unclusteredPointLayer: any = {
  id: 'unclustered-point',
  type: 'circle',
  source: 'listings-source',
  filter: ['!', ['get', 'cluster']],
  paint: {
    'circle-color': [
      'interpolate',
      ['linear'],
      ['get', 'price'],
      100000,
      '#51bbd6',
      500000,
      '#f1f075',
      1000000,
      '#f28cb1',
    ],
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      6,
      4,
      14,
      8,
      18,
      12,
    ],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#fff',
    'circle-opacity': 0.9,
  },
};

const unclusteredLabelLayer: any = {
  id: 'unclustered-label',
  type: 'symbol',
  source: 'listings-source',
  filter: ['!', ['get', 'cluster']],
  layout: {
    'text-field': [
      'format',
      ['concat', '$', ['to-string', ['get', 'price_display']]],
      { 'font-scale': 0.75 },
    ],
    'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
    'text-size': 11,
    'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
    'text-radial-offset': 0.7,
    'text-justify': 'auto',
  },
  paint: {
    'text-color': '#1a1a2e',
    'text-halo-color': '#ffffff',
    'text-halo-width': 1.5,
  },
};

export interface PropertyMapProps {
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    minBaths?: number;
    status?: string;
  };
  onMarkerClick?: (propertyId: string) => void;
}

function formatPriceShort(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

export function PropertyMap({ filters, onMarkerClick }: PropertyMapProps) {
  const mapRef = React.useRef<MapRef>(null);
  const router = useRouter();

  const [viewState, setViewState] = React.useState({
    latitude: 39.8283,
    longitude: -98.5795,
    zoom: 3.5,
  });

  const [geojsonData, setGeojsonData] = React.useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = React.useState(false);

  const prevRequestRef = React.useRef<string>('');

  const buildViewportParams = React.useCallback(() => {
    if (!mapRef.current) return null;
    const bounds = mapRef.current.getBounds();
    if (!bounds) return null;
    const zoom = Math.floor(viewState.zoom);
    return {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
      zoom,
      minPrice: filters?.minPrice,
      maxPrice: filters?.maxPrice,
      beds: filters?.minBeds,
      baths: filters?.minBaths,
      status: filters?.status,
    };
  }, [viewState.zoom, filters]);

  const fetchViewport = React.useCallback(async () => {
    const params = buildViewportParams();
    if (!params) return;

    const requestKey = JSON.stringify(params);
    if (requestKey === prevRequestRef.current) return;
    prevRequestRef.current = requestKey;

    setLoading(true);
    try {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== '') search.set(k, String(v));
      }

      const res = await fetch(`/api/properties/viewport?${search.toString()}`);
      if (!res.ok) return;

      const data = await res.json();

      const features: GeoJSON.Feature[] = data.data.map((item: any) => {
        if (data.type === 'clusters') {
          const count = Number(item.count) || 1;
          const avgPrice = item.avg_price != null ? Number(item.avg_price) : null;
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [Number(item.longitude), Number(item.latitude)],
            },
            properties: {
              cluster: count > 1 ? true : false,
              point_count: count,
              price: avgPrice,
              price_display: formatPriceShort(avgPrice),
              avg_price: avgPrice,
              min_price: item.min_price != null ? Number(item.min_price) : null,
              max_price: item.max_price != null ? Number(item.max_price) : null,
            },
          };
        } else {
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [Number(item.longitude), Number(item.latitude)],
            },
            properties: {
              cluster: false,
              id: String(item.id),
              address: item.address,
              price: item.price != null ? Number(item.price) : null,
              price_display: formatPriceShort(item.price != null ? Number(item.price) : null),
              bedrooms: item.bedrooms,
              bathrooms: item.bathrooms,
              sqft: item.sqft,
              primary_photo: item.primary_photo,
              status: item.status,
            },
          };
        }
      });

      setGeojsonData({
        type: 'FeatureCollection',
        features,
      });
    } catch (err) {
      console.error('Viewport fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [buildViewportParams]);

  const debouncedFetch = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMoveEnd = React.useCallback(
    (evt: ViewStateChangeEvent) => {
      setViewState(evt.viewState);
      if (debouncedFetch.current) clearTimeout(debouncedFetch.current);
      debouncedFetch.current = setTimeout(() => {
        fetchViewport();
      }, 300);
    },
    [fetchViewport],
  );

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (mapRef.current) {
        fetchViewport();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fetchViewport]);

  React.useEffect(() => {
    prevRequestRef.current = '';
    if (debouncedFetch.current) clearTimeout(debouncedFetch.current);
    debouncedFetch.current = setTimeout(() => {
      fetchViewport();
    }, 100);
  }, [filters, fetchViewport]);

  const handleClick = React.useCallback(
    (event: any) => {
      const feature = event.features?.[0];
      if (!feature) return;

      const props = feature.properties;
      if (props?.cluster) {
        const clusterZoom = Math.min(viewState.zoom + 3, 18);
        mapRef.current?.flyTo({
          center: event.lngLat,
          zoom: clusterZoom,
          duration: 600,
        });
        return;
      }

      const propertyId = props?.id;
      if (propertyId) {
        if (onMarkerClick) {
          onMarkerClick(propertyId);
        } else {
          router.push(`/property/${propertyId}`);
        }
      }
    },
    [router, onMarkerClick, viewState.zoom],
  );

  if (!MAPBOX_TOKEN) {
    return <div className="p-4 text-red-500">Mapbox Token Missing</div>;
  }

  return (
    <div className="absolute inset-0">
      <Map
        {...viewState}
        onMoveEnd={handleMoveEnd}
        onMove={(evt) => setViewState(evt.viewState)}
        ref={mapRef}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        mapboxAccessToken={MAPBOX_TOKEN}
        interactiveLayerIds={['clusters', 'unclustered-point']}
        onClick={handleClick}
        style={{ width: '100%', height: '100%' }}
        reuseMaps
      >
        {geojsonData && (
          <Source
            id="listings-source"
            type="geojson"
            data={geojsonData}
            cluster={true}
            clusterMaxZoom={14}
            clusterRadius={50}
          >
            <Layer {...clusterLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...unclusteredPointLayer} />
            <Layer {...unclusteredLabelLayer} />
          </Source>
        )}
        {loading && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-md bg-white/90 px-2.5 py-1.5 text-xs text-zinc-600 shadow-sm backdrop-blur-sm">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
            Loading…
          </div>
        )}
      </Map>
    </div>
  );
}
