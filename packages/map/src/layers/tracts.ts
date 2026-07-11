'use client';

// Census-tract choropleth from the `tract_context` view: one layer, three
// metric modes (income / rent / NRI risk) swapped via paint property only.
// The subtle border layer at z11+ is how users SEE split-ZIP structure.
import type maplibregl from 'maplibre-gl';
import type { LayerDef } from './registry';
import { tileSourceAvailable } from './registry';

const SRC = 'tract-context';
const FILL = 'tract-fill';
const LINE = 'tract-line';

export type TractMetric = 'income' | 'rent' | 'risk';

const RAMPS: Record<TractMetric, { prop: string; stops: Array<[number, string]>; fmt: (v: number) => string }> = {
  income: {
    prop: 'median_hh_income',
    stops: [
      [30000, '#3b4a6b'],
      [60000, '#2a7f7a'],
      [95000, '#1f9d6e'],
      [140000, '#c9a35c'],
      [200000, '#b0532f'],
    ],
    fmt: (v) => `$${Math.round(v / 1000)}K`,
  },
  rent: {
    prop: 'median_gross_rent',
    stops: [
      [800, '#3b4a6b'],
      [1300, '#2a7f7a'],
      [1900, '#1f9d6e'],
      [2600, '#c9a35c'],
      [3500, '#b0532f'],
    ],
    fmt: (v) => `$${v}`,
  },
  risk: {
    prop: 'nri_overall_score',
    stops: [
      [10, '#1f9d6e'],
      [25, '#7fae5e'],
      [45, '#c9a35c'],
      [70, '#b0532f'],
      [90, '#8c2f2f'],
    ],
    fmt: (v) => String(v),
  },
};


// MapLibre fetches tiles from a web worker where relative URLs fail Request
// construction — tile templates must be absolute.
function _defaultTileBase(): string {
  return typeof window !== 'undefined' ? `${window.location.origin}/tiles` : '/tiles';
}

export function tractLayer(tileBase = _defaultTileBase(), initialMetric: TractMetric = 'income'): LayerDef & {
  setMetric: (map: maplibregl.Map, m: TractMetric) => void;
} {
  let metric: TractMetric = initialMetric;

  const paintFor = (m: TractMetric): maplibregl.ExpressionSpecification =>
    [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', RAMPS[m].prop], 0],
      ...RAMPS[m].stops.flat(),
    ] as unknown as maplibregl.ExpressionSpecification;

  return {
    id: 'tracts',
    label: 'Tract context',
    get legend() {
      return RAMPS[metric].stops.map(([v, color]) => ({ color, label: RAMPS[metric].fmt(v) }));
    },
    minZoom: 9,
    available: () => tileSourceAvailable(`${tileBase}/public.tract_context.json`),
    add: (map: maplibregl.Map) => {
      if (map.getSource(SRC)) return;
      map.addSource(SRC, {
        type: 'vector',
        tiles: [`${tileBase}/public.tract_context/{z}/{x}/{y}.pbf`],
        minzoom: 7,
        maxzoom: 14,
      });
      const beforeId = map.getLayer('clusters') ? 'clusters' : undefined;
      map.addLayer(
        {
          id: FILL,
          type: 'fill',
          source: SRC,
          'source-layer': 'tract_context',
          minzoom: 9,
          paint: { 'fill-color': paintFor(metric), 'fill-opacity': 0.35 },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: LINE,
          type: 'line',
          source: SRC,
          'source-layer': 'tract_context',
          minzoom: 11,
          paint: { 'line-color': '#2a2520', 'line-width': 0.5, 'line-opacity': 0.25 },
        },
        beforeId,
      );
    },
    remove: (map: maplibregl.Map) => {
      for (const l of [FILL, LINE]) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
    setOpacity: (map: maplibregl.Map, opacity: number) => {
      if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', 0.35 * opacity * 2 > 1 ? 1 : 0.35 * opacity * 2);
    },
    setMetric: (map: maplibregl.Map, m: TractMetric) => {
      metric = m;
      if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-color', paintFor(m));
    },
  };
}
