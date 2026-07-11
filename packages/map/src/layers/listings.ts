'use client';

// Listings layers: server-side clusters (geojson source fed by the viewport
// API) below z10, MVT points from pg_tileserv at z9+. Extracted verbatim
// from apps/one PropertyMap.tsx — visual + interaction parity is the
// contract; both apps consume this module.
import maplibregl from 'maplibre-gl';
import type * as GeoJSON from 'geojson';

export type ViewportResponse =
  | {
      type: 'clusters';
      data: Array<{ latitude: number; longitude: number; count: number; avg_price: number; min_price: number; max_price: number }>;
    }
  | {
      type: 'properties';
      data: Array<{
        id: number | string;
        address: string;
        price: number;
        bedrooms: number;
        bathrooms: number;
        sqft: number;
        primary_photo: string | null;
        latitude: number;
        longitude: number;
      }>;
    };

export interface ListingsLayerOptions {
  /** () => current pg_tileserv URL template incl. filter params */
  tileUrl: () => string;
  onSelect: (id: string) => void;
  /** Optional hover callbacks for list<->map sync (A2). */
  onHoverFeature?: (id: string | null) => void;
  /** Build the hover card DOM for a feature's properties; return null to skip. */
  buildHoverCard?: (props: Record<string, unknown>, navigate: () => void) => HTMLElement | null;
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const LISTINGS_SOURCE = 'listings';
export const LISTINGS_MVT_SOURCE = 'listings-mvt';
export const MVT_SOURCE_LAYER = 'listings';

export function addListingsLayers(map: maplibregl.Map, opts: ListingsLayerOptions): void {
  // Idempotent: a basemap swap replays this installer.
  if (map.getSource(LISTINGS_SOURCE)) return;

  map.addSource(LISTINGS_SOURCE, { type: 'geojson', data: EMPTY });
  map.addSource(LISTINGS_MVT_SOURCE, {
    type: 'vector',
    tiles: [opts.tileUrl()],
    minzoom: 0,
    maxzoom: 20,
  });

  // cluster circles — visible through z9 to overlap with MVT minzoom 9
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: LISTINGS_SOURCE,
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
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: LISTINGS_SOURCE,
    maxzoom: 10,
    filter: ['==', ['get', 'cluster'], true],
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-font': ['Noto Sans Medium', 'Noto Sans Regular'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#faf7f2' },
  });

  // Invisible hit layer under mvt-points — radius 22 for Fitts-friendly clicks
  map.addLayer({
    id: 'mvt-hit',
    type: 'circle',
    source: LISTINGS_MVT_SOURCE,
    'source-layer': MVT_SOURCE_LAYER,
    minzoom: 9,
    paint: { 'circle-color': '#000', 'circle-opacity': 0, 'circle-radius': 22 },
  });

  // Selected halo (behind points). feature-state is NOT allowed in layer
  // filters (silently broken in the original implementation) — drive
  // visibility through paint opacity instead.
  map.addLayer({
    id: 'mvt-selected-halo',
    type: 'circle',
    source: LISTINGS_MVT_SOURCE,
    'source-layer': MVT_SOURCE_LAYER,
    minzoom: 9,
    paint: {
      'circle-color': 'transparent',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8, 14, 12, 16, 15],
      'circle-stroke-color': '#2a2520',
      'circle-stroke-width': 2,
      'circle-opacity': 0,
      'circle-stroke-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        0.9,
        0,
      ],
    },
  });

  // MVT dots: z9–12.99. Brass for price cuts, emerald otherwise; hover state
  // enlarges via feature-state (list->map sync uses the same state).
  map.addLayer({
    id: 'mvt-points',
    type: 'circle',
    source: LISTINGS_MVT_SOURCE,
    'source-layer': MVT_SOURCE_LAYER,
    minzoom: 9,
    maxzoom: 13,
    paint: {
      'circle-color': [
        'case',
        ['>', ['coalesce', ['get', 'price_cut_pct'], 0], 0],
        '#c9a35c',
        '#1f9d6e',
      ],
      // Only ONE zoom interpolate is allowed per expression — the hover
      // branch goes inside the interpolate outputs, not around it.
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['case', ['boolean', ['feature-state', 'hover'], false], 6, 4],
        14,
        ['case', ['boolean', ['feature-state', 'hover'], false], 10, 7],
      ],
      'circle-stroke-color': '#faf7f2',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.95,
    },
  });

  // Price pills at z13+: the standard serious-real-estate pattern. Short
  // price text on a pill; hover/selected via feature-state paint.
  map.addLayer({
    id: 'mvt-pills',
    type: 'symbol',
    source: LISTINGS_MVT_SOURCE,
    'source-layer': MVT_SOURCE_LAYER,
    minzoom: 13,
    layout: {
      'text-field': ['coalesce', ['get', 'price_short'], ''],
      'text-font': ['Noto Sans Medium', 'Noto Sans Regular'],
      'text-size': 12,
      'text-padding': 6,
      'text-allow-overlap': false,
      'text-optional': false,
    },
    paint: {
      'text-color': '#faf7f2',
      'text-halo-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#2a2520',
        ['>', ['coalesce', ['get', 'price_cut_pct'], 0], 0],
        '#a8853f',
        '#0e7a52',
      ],
      'text-halo-width': 8,
    },
  });

  wireInteractions(map, opts);
}

export function setMvtTiles(map: maplibregl.Map, url: string): void {
  const src = map.getSource(LISTINGS_MVT_SOURCE);
  if (src) (src as maplibregl.VectorTileSource).setTiles([url]);
}

export function updateViewportData(map: maplibregl.Map, json: ViewportResponse): void {
  const src = map.getSource(LISTINGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const features: GeoJSON.Feature[] = [];
  if (json.type === 'clusters') {
    for (const c of json.data) {
      if (c.longitude == null || c.latitude == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(c.longitude), Number(c.latitude)] },
        properties: {
          cluster: true,
          count: Number(c.count),
          avg_price: Number(c.avg_price),
          min_price: Number(c.min_price),
          max_price: Number(c.max_price),
        },
      });
    }
  } else {
    for (const pt of json.data) {
      if (pt.longitude == null || pt.latitude == null) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(pt.longitude), Number(pt.latitude)] },
        properties: {
          id: String(pt.id),
          address: pt.address,
          price: Number(pt.price) || 0,
          bedrooms: pt.bedrooms,
          bathrooms: pt.bathrooms,
          sqft: pt.sqft,
          primary_photo: pt.primary_photo,
        },
      });
    }
  }
  src.setData({ type: 'FeatureCollection', features });
}

// --- feature-state helpers (shared by map interactions and list hover) ---

let lastSelected: string | number | null = null;
let lastHovered: string | number | null = null;

export function setSelectedListing(map: maplibregl.Map, id: string | number | null): void {
  if (lastSelected !== null && lastSelected !== id) {
    map.setFeatureState(
      { source: LISTINGS_MVT_SOURCE, sourceLayer: MVT_SOURCE_LAYER, id: lastSelected },
      { selected: false },
    );
  }
  if (id !== null) {
    map.setFeatureState(
      { source: LISTINGS_MVT_SOURCE, sourceLayer: MVT_SOURCE_LAYER, id },
      { selected: true },
    );
  }
  lastSelected = id;
}

export function setHoveredListing(map: maplibregl.Map, id: string | number | null): void {
  if (lastHovered !== null && lastHovered !== id) {
    map.setFeatureState(
      { source: LISTINGS_MVT_SOURCE, sourceLayer: MVT_SOURCE_LAYER, id: lastHovered },
      { hover: false },
    );
  }
  if (id !== null) {
    map.setFeatureState(
      { source: LISTINGS_MVT_SOURCE, sourceLayer: MVT_SOURCE_LAYER, id },
      { hover: true },
    );
  }
  lastHovered = id;
}

function wireInteractions(map: maplibregl.Map, opts: ListingsLayerOptions): void {
  // cluster click → zoom in
  map.on('click', 'clusters', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2.5, 15), duration: 500 });
  });

  const handlePointClick = (e: maplibregl.MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
    const f = e.features?.[0];
    const id = f?.properties?.id ?? f?.id;
    if (id == null) return;
    setSelectedListing(map, id as string | number);
    opts.onSelect(String(id));
  };
  for (const layer of ['mvt-points', 'mvt-hit', 'mvt-pills']) {
    map.on('click', layer, handlePointClick);
  }

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'op-map-popup',
    offset: 12,
  });

  const onEnter = (e: maplibregl.MapMouseEvent & { features?: GeoJSON.Feature[] }) => {
    map.getCanvas().style.cursor = 'pointer';
    const f = e.features?.[0];
    if (!f) return;
    const props = f.properties as Record<string, unknown>;
    const id = (props.id ?? f.id) as string | number | undefined;
    if (id != null) {
      setHoveredListing(map, id);
      opts.onHoverFeature?.(String(id));
    }
    if (!opts.buildHoverCard) return;
    const geom = f.geometry as GeoJSON.Point;
    if (!geom?.coordinates) return;
    const el = opts.buildHoverCard(props, () => opts.onSelect(String(id)));
    if (el) popup.setLngLat(geom.coordinates as [number, number]).setDOMContent(el).addTo(map);
  };
  const onLeave = () => {
    map.getCanvas().style.cursor = '';
    setHoveredListing(map, null);
    opts.onHoverFeature?.(null);
    popup.remove();
  };
  for (const layer of ['mvt-points', 'mvt-hit', 'mvt-pills']) {
    map.on('mouseenter', layer, onEnter);
    map.on('mouseleave', layer, onLeave);
  }
  map.on('mouseenter', 'clusters', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'clusters', () => {
    map.getCanvas().style.cursor = '';
  });
}
