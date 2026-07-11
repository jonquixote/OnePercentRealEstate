'use client';

// Context overlays backed by data-expansion tables: flood zones, transit
// stops, schools. All availability-gated — the toggles disable themselves
// until the tables exist and pg_tileserv serves them.
import type maplibregl from 'maplibre-gl';
import type { LayerDef } from './registry';
import { tileSourceAvailable } from './registry';


// MapLibre fetches tiles from a web worker where relative URLs fail Request
// construction — tile templates must be absolute.
function _defaultTileBase(): string {
  return typeof window !== 'undefined' ? `${window.location.origin}/tiles` : '/tiles';
}

export function floodLayer(tileBase = _defaultTileBase()): LayerDef {
  const SRC = 'flood-zones';
  const FILL = 'flood-fill';
  return {
    id: 'flood',
    label: 'Flood zones (FEMA)',
    legend: [
      { color: '#b0532f', label: 'SFHA (high risk)' },
      { color: '#c9a35c', label: 'Other mapped zone' },
    ],
    minZoom: 10,
    available: () => tileSourceAvailable(`${tileBase}/public.flood_zones.json`),
    add: (map: maplibregl.Map) => {
      if (map.getSource(SRC)) return;
      map.addSource(SRC, {
        type: 'vector',
        tiles: [`${tileBase}/public.flood_zones/{z}/{x}/{y}.pbf`],
        minzoom: 9,
        maxzoom: 15,
      });
      const beforeId = map.getLayer('clusters') ? 'clusters' : undefined;
      map.addLayer(
        {
          id: FILL,
          type: 'fill',
          source: SRC,
          'source-layer': 'public.flood_zones',
          minzoom: 10,
          paint: {
            'fill-color': ['case', ['==', ['get', 'sfha'], true], '#b0532f', '#c9a35c'] as unknown as maplibregl.ExpressionSpecification,
            'fill-opacity': ['case', ['==', ['get', 'sfha'], true], 0.4, 0.2] as unknown as maplibregl.ExpressionSpecification,
          },
        },
        beforeId,
      );
    },
    remove: (map: maplibregl.Map) => {
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
    setOpacity: (map: maplibregl.Map, opacity: number) => {
      if (map.getLayer(FILL)) {
        map.setPaintProperty(FILL, 'fill-opacity', [
          'case', ['==', ['get', 'sfha'], true], 0.4 * opacity * 2 > 1 ? 1 : 0.4 * opacity * 2, 0.2 * opacity,
        ] as unknown as maplibregl.ExpressionSpecification);
      }
    },
  };
}

export function transitLayer(tileBase = _defaultTileBase()): LayerDef {
  const SRC = 'transit-stops';
  const CIRCLE = 'transit-circle';
  return {
    id: 'transit',
    label: 'Transit stops',
    legend: [
      { color: '#3b4a6b', label: 'Rail / subway / tram' },
      { color: '#8a94a6', label: 'Bus' },
    ],
    minZoom: 11,
    available: () => tileSourceAvailable(`${tileBase}/public.transit_stops.json`),
    add: (map: maplibregl.Map) => {
      if (map.getSource(SRC)) return;
      map.addSource(SRC, {
        type: 'vector',
        tiles: [`${tileBase}/public.transit_stops/{z}/{x}/{y}.pbf`],
        minzoom: 10,
        maxzoom: 15,
      });
      map.addLayer({
        id: CIRCLE,
        type: 'circle',
        source: SRC,
        'source-layer': 'public.transit_stops',
        minzoom: 11,
        paint: {
          // route_types is an int[]; rail types (0,1,2) render larger + accent.
          'circle-color': [
            'case',
            ['in', 0, ['coalesce', ['get', 'route_types'], ['literal', []]]], '#3b4a6b',
            ['in', 1, ['coalesce', ['get', 'route_types'], ['literal', []]]], '#3b4a6b',
            ['in', 2, ['coalesce', ['get', 'route_types'], ['literal', []]]], '#3b4a6b',
            '#8a94a6',
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-radius': [
            'case',
            ['in', 1, ['coalesce', ['get', 'route_types'], ['literal', []]]], 5,
            3,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-opacity': 0.8,
          'circle-stroke-color': '#faf7f2',
          'circle-stroke-width': 1,
        },
      });
    },
    remove: (map: maplibregl.Map) => {
      if (map.getLayer(CIRCLE)) map.removeLayer(CIRCLE);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
    setOpacity: (map: maplibregl.Map, opacity: number) => {
      if (map.getLayer(CIRCLE)) map.setPaintProperty(CIRCLE, 'circle-opacity', 0.8 * opacity);
    },
  };
}

export function schoolsLayer(tileBase = _defaultTileBase()): LayerDef {
  const SRC = 'schools';
  const CIRCLE = 'schools-circle';
  const LABEL = 'schools-label';
  return {
    id: 'schools',
    label: 'Schools (NCES)',
    legend: [{ color: '#7c5cbf', label: 'Public school' }],
    minZoom: 12,
    available: () => tileSourceAvailable(`${tileBase}/public.schools.json`),
    add: (map: maplibregl.Map) => {
      if (map.getSource(SRC)) return;
      map.addSource(SRC, {
        type: 'vector',
        tiles: [`${tileBase}/public.schools/{z}/{x}/{y}.pbf`],
        minzoom: 11,
        maxzoom: 15,
      });
      map.addLayer({
        id: CIRCLE,
        type: 'circle',
        source: SRC,
        'source-layer': 'public.schools',
        minzoom: 12,
        paint: {
          'circle-color': '#7c5cbf',
          'circle-radius': 4,
          'circle-opacity': 0.85,
          'circle-stroke-color': '#faf7f2',
          'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: LABEL,
        type: 'symbol',
        source: SRC,
        'source-layer': 'public.schools',
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Medium', 'Noto Sans Regular'],
          'text-size': 10,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#5a4a8a',
          'text-halo-color': 'rgba(250,247,242,.9)',
          'text-halo-width': 1.2,
        },
      });
    },
    remove: (map: maplibregl.Map) => {
      for (const l of [CIRCLE, LABEL]) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(SRC)) map.removeSource(SRC);
    },
    setOpacity: (map: maplibregl.Map, opacity: number) => {
      if (map.getLayer(CIRCLE)) map.setPaintProperty(CIRCLE, 'circle-opacity', 0.85 * opacity);
    },
  };
}
