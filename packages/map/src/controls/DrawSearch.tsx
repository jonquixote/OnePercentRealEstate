'use client';

// Freehand draw-to-search. ~90 lines of plain MapLibre events instead of a
// draw library: press the button, drag once across the map, ring closes on
// release. Emits simplified vertices (max 100) as [lng, lat] pairs.
import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type * as GeoJSON from 'geojson';

const SRC = 'draw-search';
const MAX_VERTICES = 100;

export interface DrawSearchProps {
  map: maplibregl.Map | null;
  ready: boolean;
  /** Fired with closed-ring vertices on finish, null on clear. */
  onPolygon: (coords: [number, number][] | null) => void;
  /** Current polygon (e.g. restored from URL) to render on mount. */
  initial?: [number, number][] | null;
}

function installSources(map: maplibregl.Map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'draw-search-fill',
    type: 'fill',
    source: SRC,
    paint: { 'fill-color': '#0e7a52', 'fill-opacity': 0.08 },
  });
  map.addLayer({
    id: 'draw-search-line',
    type: 'line',
    source: SRC,
    paint: { 'line-color': '#0e7a52', 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
}

function setRing(map: maplibregl.Map, ring: [number, number][] | null) {
  const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  if (!ring || ring.length < 3) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  const closed = [...ring, ring[0]];
  const feature: GeoJSON.Feature = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [closed] },
    properties: {},
  };
  src.setData({ type: 'FeatureCollection', features: [feature] });
}

/** Evenly thin a dense freehand trace down to <= max vertices. */
export function thinVertices(pts: [number, number][], max = MAX_VERTICES): [number, number][] {
  if (pts.length <= max) return pts;
  const step = pts.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]);
  return out;
}

export function DrawSearch({ map, ready, onPolygon, initial }: DrawSearchProps) {
  const [drawing, setDrawing] = useState(false);
  const [hasPolygon, setHasPolygon] = useState(!!initial?.length);
  const traceRef = useRef<[number, number][]>([]);
  const onPolygonRef = useRef(onPolygon);
  onPolygonRef.current = onPolygon;

  // (Re)install sources on style load; render restored polygon.
  useEffect(() => {
    if (!map || !ready) return;
    installSources(map);
    if (initial?.length) setRing(map, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready]);

  const start = useCallback(() => {
    if (!map) return;
    setDrawing(true);
    traceRef.current = [];
    map.getCanvas().style.cursor = 'crosshair';
    map.dragPan.disable();

    const onMove = (e: maplibregl.MapMouseEvent) => {
      traceRef.current.push([e.lngLat.lng, e.lngLat.lat]);
      setRing(map, traceRef.current as [number, number][]);
    };
    const finish = () => {
      map.off('mousemove', onMove);
      map.off('mouseup', finish);
      map.off('touchmove', onTouchMove);
      map.off('touchend', finish);
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
      setDrawing(false);
      const ring = thinVertices(traceRef.current);
      if (ring.length >= 3) {
        setRing(map, ring);
        setHasPolygon(true);
        onPolygonRef.current(ring);
      } else {
        setRing(map, null);
        setHasPolygon(false);
        onPolygonRef.current(null);
      }
    };
    const onTouchMove = (e: maplibregl.MapTouchEvent) => {
      traceRef.current.push([e.lngLat.lng, e.lngLat.lat]);
      setRing(map, traceRef.current as [number, number][]);
    };
    map.once('mousedown', () => {
      map.on('mousemove', onMove);
      map.on('mouseup', finish);
    });
    map.once('touchstart', () => {
      map.on('touchmove', onTouchMove);
      map.on('touchend', finish);
    });
  }, [map]);

  const clear = useCallback(() => {
    if (map) setRing(map, null);
    setHasPolygon(false);
    onPolygonRef.current(null);
  }, [map]);

  // Esc cancels/clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (drawing || hasPolygon)) clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, hasPolygon, clear]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={hasPolygon ? clear : start}
        disabled={drawing}
        className="rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur transition-colors hover:opacity-90 disabled:opacity-60"
        style={{
          background: drawing ? 'var(--pass)' : 'rgba(250,247,242,.92)',
          borderColor: drawing || hasPolygon ? 'var(--pass)' : 'var(--line)',
          color: drawing ? 'var(--ink)' : hasPolygon ? 'var(--pass)' : 'var(--text)',
        }}
        title={hasPolygon ? 'Clear the drawn area' : 'Draw an area to search'}
      >
        {drawing ? 'Draw on the map…' : hasPolygon ? 'Clear drawing ×' : '✏ Draw area'}
      </button>
    </div>
  );
}
