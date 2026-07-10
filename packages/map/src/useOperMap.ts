'use client';

// Core map hook shared by apps/one and apps/two. Owns lifecycle only:
// construction, basemap style, resize handling, nav control, and the
// label-contrast pass. Feature layers (listings, overlays) attach via the
// modules in ./layers — this hook knows nothing about them beyond replaying
// registered `onStyleLoad` callbacks after a basemap swap.
import { useEffect, useRef, useState, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';

export const BASEMAPS = {
  // OpenFreeMap: free, no key, unlimited. positron = light (current default),
  // liberty = richer alternative.
  positron: 'https://tiles.openfreemap.org/styles/positron',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
} as const;
export type BasemapId = keyof typeof BASEMAPS | 'satellite';

// Esri World Imagery via ArcGIS Location Platform (free tier 2M tiles/mo).
// Rendered only when a key is provided; attribution string is contractual.
export function satelliteStyle(esriKey: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    // Positron's glyphs so symbol layers (price pills, cluster counts) keep
    // working after a swap to the raster basemap.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      'esri-imagery': {
        type: 'raster',
        tiles: [
          `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${esriKey}`,
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
    },
    layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri-imagery' }],
  };
}

export interface OperMapOptions {
  container: RefObject<HTMLDivElement | null>;
  basemap?: BasemapId;
  esriKey?: string;
  center?: [number, number];
  zoom?: number;
  interactive?: boolean; // false → static context map (property MiniMap)
  onMoveEnd?: (map: maplibregl.Map) => void;
}

export interface OperMap {
  mapRef: RefObject<maplibregl.Map | null>;
  ready: boolean;
  /** Register a callback that (re)installs sources/layers. Runs on first
   *  style load AND after every basemap swap — must be idempotent. */
  onStyleLoad: (fn: (map: maplibregl.Map) => void) => void;
  setBasemap: (id: BasemapId) => void;
  basemap: BasemapId;
}

function applyLabelContrast(map: maplibregl.Map) {
  // Basemap label contrast overrides (kept verbatim from the original
  // PropertyMap implementation — design-approved values).
  const layers = map.getStyle()?.layers ?? [];
  const labelLayers = layers.filter(
    (l) => l.id.includes('label') || l.id.includes('place') || l.id.includes('road'),
  );
  for (const layer of labelLayers) {
    try {
      map.setPaintProperty(layer.id, 'text-color', '#2a2520');
      map.setPaintProperty(layer.id, 'text-halo-color', 'rgba(250,247,242,.85)');
      map.setPaintProperty(layer.id, 'text-halo-width', 1.5);
    } catch {
      /* skip non-text layers */
    }
  }
}

export function useOperMap(opts: OperMapOptions): OperMap {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemapState] = useState<BasemapId>(opts.basemap ?? 'positron');
  const styleLoadFns = useRef<Array<(map: maplibregl.Map) => void>>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const runStyleLoadFns = (map: maplibregl.Map) => {
    if (basemapRef.current !== 'satellite') applyLabelContrast(map);
    for (const fn of styleLoadFns.current) {
      try {
        fn(map);
      } catch (err) {
        // A failing overlay must never take down the map.
        console.warn('[oper-map] layer install failed', err);
      }
    }
  };
  const runRef = useRef(runStyleLoadFns);
  runRef.current = runStyleLoadFns;
  const basemapRef = useRef<BasemapId>(basemap);

  useEffect(() => {
    const container = optsRef.current.container.current;
    if (!container || mapRef.current) return;
    const o = optsRef.current;
    const initialStyle =
      basemapRef.current === 'satellite' && o.esriKey
        ? satelliteStyle(o.esriKey)
        : BASEMAPS[basemapRef.current as keyof typeof BASEMAPS] ?? BASEMAPS.positron;

    const map = new maplibregl.Map({
      container,
      style: initialStyle,
      center: o.center ?? [-98.6, 39.8],
      zoom: o.zoom ?? 3.5,
      attributionControl: false,
      interactive: o.interactive !== false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    if (o.interactive !== false) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    }

    // The map often lives in a sticky / calc()-height column that may not
    // have its final size when MapLibre measures the container at
    // construction (canvas can stick at a wrong height and never paint
    // tiles). A ResizeObserver keeps the canvas matched to the container —
    // the standard fix for dynamic layouts.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);

    map.on('load', () => {
      map.resize();
      runRef.current(map);
      setReady(true);
    });
    map.on('moveend', () => optsRef.current.onMoveEnd?.(map));

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStyleLoad = (fn: (map: maplibregl.Map) => void) => {
    styleLoadFns.current.push(fn);
    const map = mapRef.current;
    // If the style is already up, install immediately.
    if (map && map.isStyleLoaded()) {
      try {
        fn(map);
      } catch (err) {
        console.warn('[oper-map] layer install failed', err);
      }
    }
  };

  const setBasemap = (id: BasemapId) => {
    const map = mapRef.current;
    if (!map || id === basemapRef.current) return;
    if (id === 'satellite' && !optsRef.current.esriKey) return;
    basemapRef.current = id;
    setBasemapState(id);
    const style =
      id === 'satellite'
        ? satelliteStyle(optsRef.current.esriKey!)
        : BASEMAPS[id];
    map.setStyle(style as maplibregl.StyleSpecification | string);
    // setStyle wipes custom sources/layers; replay installers once the new
    // style settles. `styledata` fires several times — use idle to run once.
    map.once('idle', () => runRef.current(map));
  };

  return { mapRef, ready, onStyleLoad, setBasemap, basemap };
}
