"use client";

/**
 * Workspace — the W3 terminal grid: a main table region with a toggleable
 * bottom pane (map | chart) and a draggable horizontal splitter. The right
 * inspector lives in the `(terminal)` layout and is out of scope here; this
 * component owns everything inside the center `main` panel.
 *
 * Keyboard model (hotkeys are registered by the page; this is presentational):
 *  - the bottom pane is shown/hidden via the `bottomPane` prop
 *  - selecting a row (j/k) drives the map pin highlight through MapLibre
 *    feature-state (`selected`), and clicking a pin calls `onSelect`.
 *
 * The split ratio and the active bottom pane are persisted to localStorage so
 * the layout survives a reload. No external splitter dependency — the drag
 * handle is ~30 lines of pointer math.
 */
import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type * as GeoJSON from "geojson";
import { useOperMap } from "@oper/map";
import type { ScreenSort } from "@/lib/screens";
import type { ColumnDef } from "@/lib/columns";
import type { PropertyRow } from "@/lib/types";
import { PropertyTable } from "@/components/PropertyTable";
import { StatBar } from "@/components/StatBar";

export type BottomPane = "map" | "chart" | null;

interface WorkspaceProps {
  rows: PropertyRow[];
  columns: ColumnDef[];
  sort: ScreenSort | null;
  onSortChange: (colId: string) => void;
  selectedId: string | null;
  onSelect: (row: PropertyRow) => void;
  /** Active bottom pane, or null when collapsed. Owned by the page. */
  bottomPane: BottomPane;
}

const SPLIT_KEY = "two:workspace-split";
const DEFAULT_SPLIT = 0.62;
const TERMINAL_LISTINGS = "terminal-listings";

export function Workspace({
  rows,
  columns,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  bottomPane,
}: WorkspaceProps) {
  const [split, setSplit] = React.useState(DEFAULT_SPLIT);
  const splitRef = React.useRef<HTMLDivElement>(null);

  // Hydrate the persisted split ratio after mount (SSR-safe).
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(SPLIT_KEY);
      if (v != null) {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0.1 && n < 0.95) setSplit(n);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const startDrag = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const move = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const r = Math.min(0.9, Math.max(0.1, (ev.clientY - rect.top) / rect.height));
      setSplit(r);
      try {
        window.localStorage.setItem(SPLIT_KEY, String(r));
      } catch {
        /* ignore */
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const tableHeight = bottomPane ? `${split * 100}%` : "100%";
  const paneHeight = bottomPane ? `${(1 - split) * 100}%` : "0%";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatBar rows={rows} />
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
        {/* Top: the table region. A focusable wrapper so `esc` can return
            keyboard focus here. */}
        <div className="min-h-0" style={{ height: tableHeight }}>
          <div id="terminal-table" tabIndex={-1} className="h-full outline-none">
            <PropertyTable
              rows={rows}
              columns={columns}
              selectedId={selectedId}
              onSelect={onSelect}
              sort={sort}
              onSortChange={onSortChange}
            />
          </div>
        </div>

        {bottomPane ? (
          <>
            <div
              onPointerDown={startDrag}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize table and pane"
              className="h-1.5 shrink-0 cursor-row-resize bg-zinc-800/60 transition-colors hover:bg-primary"
            />
            <div className="min-h-0" style={{ height: paneHeight }}>
              <div className="flex h-full flex-col border-t border-zinc-800/60">
                <PaneTabs bottomPane={bottomPane} />
                <div className="min-h-0 flex-1">
                  {bottomPane === "map" ? (
                    <MapPane rows={rows} selectedId={selectedId} onSelect={onSelect} />
                  ) : (
                    <ChartPane />
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Small header strip inside the bottom pane labeling which pane is active.
 * The actual mode switching is driven by the page-level `m`/`x` hotkeys; this
 * is a read-only status line (and a click target could be added later).
 */
function PaneTabs({ bottomPane }: { bottomPane: Exclude<BottomPane, null> }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 bg-zinc-950 px-2 py-1 font-mono text-[10px] uppercase tracking-widest">
      <span
        className={bottomPane === "map" ? "text-zinc-200" : "text-zinc-600"}
      >
        Map
      </span>
      <span className="text-zinc-700">·</span>
      <span
        className={bottomPane === "chart" ? "text-zinc-200" : "text-zinc-600"}
      >
        Chart
      </span>
      <span className="ml-auto text-zinc-600">m / x toggle · esc table</span>
    </div>
  );
}

/**
 * Chart placeholder. W4 will replace the body with a real metrics chart; the
 * stable `id` / `data-chart-slot` hooks let W4 mount without touching this
 * shell.
 */
function ChartPane() {
  return (
    <div
      id="terminal-chart"
      data-chart-slot
      className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 text-center"
    >
      <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
        Chart
      </p>
      <p className="mt-1 font-mono text-[10px] text-zinc-600">
        W4 — metrics chart slot
      </p>
    </div>
  );
}

/**
 * Terminal map pane. Renders ONLY the rows the table already has (lat/lon from
 * the query viewport — never client SQL), as a GeoJSON source. Selection is
 * mirrored to the map via MapLibre feature-state `selected`, and a pin click
 * calls `onSelect` to drive the table/inspector.
 */
function MapPane({
  rows,
  selectedId,
  onSelect,
}: {
  rows: PropertyRow[];
  selectedId: string | null;
  onSelect: (row: PropertyRow) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { mapRef, ready, onStyleLoad } = useOperMap({
    container: containerRef,
    // Dark-leaning basemap. The shared package ships `positron` (light) and
    // `liberty`; `liberty` is the moodier of the two and is the terminal's
    // map style. (The app has no dedicated "dark" style yet — see report.)
    basemap: "liberty",
  });

  const onSelectRef = React.useRef(onSelect);
  onSelectRef.current = onSelect;
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;

  const lastSelected = React.useRef<string | null>(null);

  const toFeatures = React.useCallback(
    (rs: PropertyRow[]): GeoJSON.FeatureCollection => {
      const features: GeoJSON.Feature[] = rs
        .filter(
          (r) =>
            typeof r.latitude === "number" && typeof r.longitude === "number",
        )
        .map((r) => ({
          type: "Feature",
          id: r.id,
          geometry: {
            type: "Point",
            coordinates: [r.longitude, r.latitude] as [number, number],
          },
          properties: {
            id: r.id,
            address: r.address,
            price: r.price ?? 0,
            price_cut_pct: r.price_cut_pct ?? 0,
            motivated_score: r.motivated_score ?? 0,
          },
        }));
      return { type: "FeatureCollection", features };
    },
    [],
  );

  const applySelection = React.useCallback(
    (map: maplibregl.Map, id: string | null) => {
      if (lastSelected.current !== null && lastSelected.current !== id) {
        map.setFeatureState(
          { source: TERMINAL_LISTINGS, id: lastSelected.current },
          { selected: false },
        );
      }
      if (id !== null) {
        map.setFeatureState({ source: TERMINAL_LISTINGS, id }, { selected: true });
      }
      lastSelected.current = id;
    },
    [],
  );

  // Install the source + layers once the style is ready (idempotent across
  // basemap swaps — useOperMap replays onStyleLoad installers). Registered a
  // single time; the installer reads live data via refs so it never goes
  // stale.
  const installedRef = React.useRef(false);
  React.useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;
    onStyleLoad((map) => {
      if (map.getSource(TERMINAL_LISTINGS)) return;
      const fc = toFeatures(rowsRef.current);
      map.addSource(TERMINAL_LISTINGS, { type: "geojson", data: fc });

      map.addLayer({
        id: "terminal-halo",
        type: "circle",
        source: TERMINAL_LISTINGS,
        paint: {
          "circle-radius": 10,
          "circle-color": "transparent",
          "circle-stroke-color": "#2a2520",
          "circle-stroke-width": 2,
          "circle-stroke-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.9,
            0,
          ],
        },
      });
      map.addLayer({
        id: "terminal-points",
        type: "circle",
        source: TERMINAL_LISTINGS,
        paint: {
          "circle-radius": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            7,
            5,
          ],
          "circle-color": [
            "case",
            [">", ["coalesce", ["get", "price_cut_pct"], 0], 0],
            "#c9a35c",
            "#1f9d6e",
          ],
          "circle-stroke-color": "#faf7f2",
          "circle-stroke-width": 1.5,
        },
      });

      map.on("click", "terminal-points", (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (!id) return;
        const row = rowsRef.current.find((r) => r.id === id);
        if (row) onSelectRef.current(row);
      });

      // Frame the current result set so pins aren't lost at country zoom.
      if (fc.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of fc.features) {
          const c = (f.geometry as GeoJSON.Point).coordinates;
          bounds.extend(c as [number, number]);
        }
        map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 });
      }
      applySelection(map, selectedId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStyleLoad, toFeatures]);

  // Refresh the source when the row set changes (new query/filter), then
  // re-apply the current selection so the highlight survives the swap.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    const src = map.getSource(TERMINAL_LISTINGS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    src.setData(toFeatures(rows));
    applySelection(map, selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ready]);

  // Mirror the selected row onto the matching pin.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applySelection(map, selectedId);
  }, [selectedId, ready, applySelection]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
