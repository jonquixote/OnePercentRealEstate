'use client';

// Basemap segmented control: vector styles (OpenFreeMap, free/unlimited) and
// optional Esri satellite (free tier, key-gated — the button simply does not
// render without a key).
import type maplibregl from 'maplibre-gl';
import type { BasemapId } from '../useOperMap';

export interface BasemapToggleProps {
  basemap: BasemapId;
  setBasemap: (id: BasemapId) => void;
  hasSatellite: boolean;
  /** Which vector style this app uses as its "Map" option. */
  vectorId?: 'positron' | 'liberty';
}

export function BasemapToggle({ basemap, setBasemap, hasSatellite, vectorId = 'positron' }: BasemapToggleProps) {
  const options: Array<{ id: BasemapId; label: string }> = [
    { id: vectorId, label: 'Map' },
    ...(hasSatellite ? [{ id: 'satellite' as BasemapId, label: 'Satellite' }] : []),
  ];
  if (options.length < 2) return null;
  return (
    <div
      className="flex overflow-hidden rounded-full border text-[12px] font-medium backdrop-blur"
      style={{ borderColor: 'var(--line)', background: 'rgba(250,247,242,.92)' }}
      role="group"
      aria-label="Basemap"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setBasemap(o.id)}
          className="px-3 py-1.5 transition-colors"
          style={
            basemap === o.id
              ? { background: 'var(--pass)', color: 'var(--ink)' }
              : { color: 'var(--haze)' }
          }
          aria-pressed={basemap === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 3D buildings garnish: fill-extrusion from the OpenFreeMap building layer
 *  at z15.5+. Idempotent; no-op on styles without the source (satellite). */
export function addBuildings3D(map: maplibregl.Map): void {
  if (map.getLayer('oper-3d-buildings')) return;
  const style = map.getStyle();
  // OpenFreeMap styles use the OpenMapTiles schema: source 'openmaptiles'
  // (name varies by style), source-layer 'building'.
  const srcName = Object.keys(style.sources ?? {}).find((s) => {
    const src = style.sources[s];
    return src.type === 'vector';
  });
  if (!srcName) return;
  map.addLayer({
    id: 'oper-3d-buildings',
    type: 'fill-extrusion',
    source: srcName,
    'source-layer': 'building',
    minzoom: 15.5,
    paint: {
      'fill-extrusion-color': '#d8d2c8',
      'fill-extrusion-opacity': 0.6,
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    },
  });
}

export function removeBuildings3D(map: maplibregl.Map): void {
  if (map.getLayer('oper-3d-buildings')) map.removeLayer('oper-3d-buildings');
}
