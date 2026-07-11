'use client';

// H3 rent-heat surface: the nightly market-stats hexes (median rent $/sqft
// at H3 res-8), served as MVT by pg_tileserv from the `rent_heat` view.
// The flagship overlay — it makes the model's hyperlocal worldview visible.
import type maplibregl from 'maplibre-gl';
import type { LayerDef } from './registry';
import { tileSourceAvailable } from './registry';

const SRC = 'rent-heat';
const LAYER = 'rent-heat-fill';

// Colorblind-safe low→high ramp (viridis-adjacent, matched to app accents).
export const RENT_HEAT_STOPS: Array<[number, string]> = [
  [0.8, '#3b4a6b'],
  [1.5, '#2a7f7a'],
  [2.2, '#1f9d6e'],
  [3.2, '#c9a35c'],
  [4.5, '#b0532f'],
];


// MapLibre fetches tiles from a web worker where relative URLs fail Request
// construction — tile templates must be absolute.
function _defaultTileBase(): string {
  return typeof window !== 'undefined' ? `${window.location.origin}/tiles` : '/tiles';
}

export function rentHeatLayer(tileBase = _defaultTileBase()): LayerDef {
  return {
    id: 'rent-heat',
    label: 'Rent $/sqft',
    legend: RENT_HEAT_STOPS.map(([v, color]) => ({ color, label: `$${v.toFixed(1)}` })),
    minZoom: 9,
    available: () => tileSourceAvailable(`${tileBase}/public.rent_heat.json`),
    add: (map: maplibregl.Map) => {
      if (map.getSource(SRC)) return;
      map.addSource(SRC, {
        type: 'vector',
        tiles: [`${tileBase}/public.rent_heat/{z}/{x}/{y}.pbf`],
        minzoom: 6,
        maxzoom: 14,
      });
      // Insert under the listings layers so pins stay on top.
      const beforeId = map.getLayer('clusters') ? 'clusters' : undefined;
      map.addLayer(
        {
          id: LAYER,
          type: 'fill',
          source: SRC,
          'source-layer': 'rent_heat',
          minzoom: 9,
          paint: {
            'fill-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'med_rent_psf'], 0],
              ...RENT_HEAT_STOPS.flat(),
            ] as unknown as maplibregl.ExpressionSpecification,
            // Thin data reads faint — honest visualization: full strength
            // needs >= 5 observations behind the hex median.
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'n_rent'], 0],
              1, 0.15,
              5, 0.45,
            ] as unknown as maplibregl.ExpressionSpecification,
          },
        },
        beforeId,
      );
    },
    remove: (map: maplibregl.Map) => {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
    setOpacity: (map: maplibregl.Map, opacity: number) => {
      if (!map.getLayer(LAYER)) return;
      map.setPaintProperty(LAYER, 'fill-opacity', [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'n_rent'], 0],
        1, 0.15 * opacity,
        5, 0.45 * opacity * 2 > 1 ? 1 : 0.45 * opacity * 2,
      ] as unknown as maplibregl.ExpressionSpecification);
    },
  };
}
