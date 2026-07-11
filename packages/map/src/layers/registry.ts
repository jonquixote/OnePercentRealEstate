'use client';

// Overlay layer registry: declarative LayerDefs, persisted toggle state,
// availability gating (a layer whose tile endpoint 404s renders as a
// disabled toggle, not a broken map), and replay after basemap swaps.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';

export interface LayerDef {
  id: string; // 'rent-heat' | 'tracts' | 'flood' | 'transit' | 'schools'
  label: string;
  legend: Array<{ color: string; label: string }>;
  minZoom?: number;
  /** Idempotent: installs sources + layers. */
  add: (map: maplibregl.Map) => void;
  remove: (map: maplibregl.Map) => void;
  /** Set paint opacity (0..1) on the layer's visible paint props. */
  setOpacity?: (map: maplibregl.Map, opacity: number) => void;
  /** Probe the data endpoint once; false disables the toggle ("coming soon"). */
  available: () => Promise<boolean>;
}

export interface LayerToggle {
  def: LayerDef;
  on: boolean;
  available: boolean | null; // null = probing
  opacity: number;
  set: (on: boolean) => void;
  setOpacity: (o: number) => void;
}

const STORAGE_KEY = 'oper:map:layers';

interface Persisted {
  on: Record<string, boolean>;
  opacity: Record<string, number>;
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Persisted;
  } catch {
    /* SSR / private mode */
  }
  return { on: {}, opacity: {} };
}

/** Probe a tile endpoint cheaply. pg_tileserv returns JSON metadata at
 *  /tiles/<table>.json; a 200 means the table exists and is served. */
export async function tileSourceAvailable(metaUrl: string): Promise<boolean> {
  try {
    const res = await fetch(metaUrl, { method: 'GET', cache: 'force-cache' });
    return res.ok;
  } catch {
    return false;
  }
}

export function useLayerRegistry(
  map: maplibregl.Map | null,
  ready: boolean,
  defs: LayerDef[],
): { toggles: LayerToggle[] } {
  const [persisted, setPersisted] = useState<Persisted>({ on: {}, opacity: {} });
  const [availability, setAvailability] = useState<Record<string, boolean | null>>({});
  const defsRef = useRef(defs);
  defsRef.current = defs;

  useEffect(() => {
    setPersisted(loadPersisted());
  }, []);

  // Probe availability once per def.
  useEffect(() => {
    let cancelled = false;
    for (const def of defsRef.current) {
      if (availability[def.id] !== undefined) continue;
      setAvailability((a) => ({ ...a, [def.id]: null }));
      def
        .available()
        .then((ok) => {
          if (!cancelled) setAvailability((a) => ({ ...a, [def.id]: ok }));
        })
        .catch(() => {
          if (!cancelled) setAvailability((a) => ({ ...a, [def.id]: false }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs.map((d) => d.id).join(',')]);

  // Apply on/off + opacity to the map; re-applies after basemap swaps
  // because `ready`/style reload re-runs the effect via the styledata tick.
  const apply = useCallback(() => {
    if (!map || !ready) return;
    for (const def of defsRef.current) {
      const on = !!persisted.on[def.id] && availability[def.id] === true;
      try {
        if (on) {
          def.add(map);
          const o = persisted.opacity[def.id];
          if (o != null && def.setOpacity) def.setOpacity(map, o);
        } else {
          def.remove(map);
        }
      } catch (err) {
        console.warn(`[oper-map] layer ${def.id} apply failed`, err);
      }
    }
  }, [map, ready, persisted, availability]);

  useEffect(() => {
    apply();
    if (!map) return;
    // Basemap swap wipes layers; styledata after idle → re-apply.
    const onIdle = () => apply();
    map.on('idle', onIdle);
    return () => {
      map.off('idle', onIdle);
    };
  }, [apply, map]);

  const persist = useCallback((next: Persisted) => {
    setPersisted(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const toggles = useMemo<LayerToggle[]>(
    () =>
      defs.map((def) => ({
        def,
        on: !!persisted.on[def.id],
        available: availability[def.id] ?? null,
        opacity: persisted.opacity[def.id] ?? 1,
        set: (on: boolean) =>
          persist({ ...persisted, on: { ...persisted.on, [def.id]: on } }),
        setOpacity: (o: number) =>
          persist({ ...persisted, opacity: { ...persisted.opacity, [def.id]: o } }),
      })),
    [defs, persisted, availability, persist],
  );

  return { toggles };
}
