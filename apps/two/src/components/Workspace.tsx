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
import { ChartPane } from "@/components/ChartPane";
import { X } from "lucide-react";

export type BottomPane = "map" | "chart" | null;

interface WorkspaceProps {
  rows: PropertyRow[];
  columns: ColumnDef[];
  sort: ScreenSort | null;
  onSortChange: (colId: string) => void;
  selectedId: string | null;
  onSelect: (row: PropertyRow) => void;
  /** 5-digit ZIP of the selected row — feeds the W4 chart pane. */
  selectedZip: string | null;
  /** Active bottom pane, or null when collapsed. Owned by the page. */
  bottomPane: BottomPane;
  /** Last query round-trip latency (ms), or null when unknown. */
  latencyMs?: number | null;
  /** Name of the active screen, or a fallback label for ad-hoc/live modes. */
  screenName?: string | null;
  /**
   * W4: applies a saved layout (its column ids + optional sort) chosen from
   * the layout bar. The page owns column/sort state, so the bar only emits.
   */
  onApplyLayout?: (layout: { columns: string[]; sort?: { col: string; dir: "asc" | "desc" } | null }) => void;
  /** When true, the layout bar is allowed to show the "Save as…" affordance
   * (Pro only). Free users can still load built-in layouts but not save. */
  canSaveLayout?: boolean;
}

const SPLIT_KEY = "two:workspace-split";
const DEFAULT_SPLIT = 0.62;
const TERMINAL_LISTINGS = "terminal-listings";
// Free-tier layout cap — mirrors FREE_CAP in the /api/layouts route. The bar
// only uses this as a fallback when the API omits `limits` (old shape/tests).
const FREE_CAP = 5;

export function Workspace({
  rows,
  columns,
  sort,
  onSortChange,
  selectedId,
  onSelect,
  selectedZip,
  bottomPane,
  latencyMs,
  screenName,
  onApplyLayout,
  canSaveLayout = true,
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

  // Cleanup for an in-flight drag, so listeners never dangle on window if the
  // component unmounts mid-drag (before pointerup fires).
  const dragCleanup = React.useRef<(() => void) | null>(null);
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
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragCleanup.current = null;
    };
    const up = () => cleanup();
    dragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  React.useEffect(() => () => dragCleanup.current?.(), []);

  const tableHeight = bottomPane ? `${split * 100}%` : "100%";
  const paneHeight = bottomPane ? `${(1 - split) * 100}%` : "0%";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LayoutBar
        onApplyLayout={onApplyLayout}
        canSaveLayout={canSaveLayout}
        currentColumns={columns.map((c) => c.id)}
        currentSort={sort}
      />
      <StatBar rows={rows} latencyMs={latencyMs} screenName={screenName} />
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
                    <ChartPane zip={selectedZip} />
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
 * W4 layout bar — a single row above the grid with a saved-layout dropdown,
 * a "Save as…" input, and (for the active layout) a delete control. It talks
 * to /api/layouts directly and emits a chosen layout to the page via
 * `onApplyLayout` (the page owns column/sort state, so the bar never mutates
 * it). The last-used layout name is persisted to localStorage and re-fetched
 * from the server on mount so a saved screen survives reloads.
 *
 * NOTE: saving is a Pro affordance; `canSaveLayout=false` hides the save
 * input (the server also 403s free users, so this is cosmetic only).
 */
const LAYOUT_LS_KEY = "two:last-layout";

interface SavedLayout {
  id: number;
  name: string;
  layout: {
    columns?: { key: string; visible?: boolean; width?: number }[];
    sort?: { key?: string; dir?: "asc" | "desc" } | null;
  };
  updated_at: string;
}

export function LayoutBar({
  onApplyLayout,
  canSaveLayout,
  currentColumns,
  currentSort,
}: {
  onApplyLayout?: (layout: { columns: string[]; sort?: { col: string; dir: "asc" | "desc" } | null }) => void;
  canSaveLayout: boolean;
  currentColumns: string[];
  currentSort: ScreenSort | null;
}) {
  const [layouts, setLayouts] = React.useState<SavedLayout[]>([]);
  const [activeName, setActiveName] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");

  // Cap bookkeeping for the free-tier upgrade nudge. `limits` arrives from the
  // API; if absent (old shape / tests) we fall back to a conservative default.
  const [used, setUsed] = React.useState(0);
  const [max, setMax] = React.useState(FREE_CAP);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/layouts", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as
        | SavedLayout[]
        | { layouts?: SavedLayout[]; limits?: { max: number; used: number; tier: string } };
      const list = Array.isArray(data)
        ? data
        : (data.layouts ?? []);
      setLayouts(list);
      if (!Array.isArray(data) && data.limits) {
        setUsed(data.limits.used);
        setMax(data.limits.max);
      } else {
        setUsed(list.length);
        setMax(FREE_CAP);
      }
      // Re-apply the last-used layout on mount (server is source of truth).
      const last = window.localStorage.getItem(LAYOUT_LS_KEY);
      const match = last ? list.find((l) => l.name === last) : undefined;
      if (match && onApplyLayout) applyLayout(match);
    } catch {
      /* best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApplyLayout]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const applyLayout = React.useCallback(
    (l: SavedLayout) => {
      const cols = (l.layout.columns ?? [])
        .filter((c) => c.visible !== false)
        .map((c) => c.key);
      const sort = l.layout.sort?.key
        ? { col: l.layout.sort.key, dir: (l.layout.sort.dir ?? "desc") as "asc" | "desc" }
        : null;
      onApplyLayout?.({ columns: cols, sort });
      setActiveName(l.name);
      try {
        window.localStorage.setItem(LAYOUT_LS_KEY, l.name);
      } catch {
        /* ignore */
      }
    },
    [onApplyLayout],
  );

  const onSelect = (name: string) => {
    const l = layouts.find((x) => x.name === name);
    if (l) applyLayout(l);
  };

  const onSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    const payload = {
      name,
      layout: {
        columns: currentColumns.map((key) => ({ key, visible: true })),
        sort: currentSort ? { key: currentSort.col, dir: currentSort.dir } : null,
      },
    };
    try {
      const res = await fetch("/api/layouts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaveName("");
        await load();
        setActiveName(name);
        try {
          window.localStorage.setItem(LAYOUT_LS_KEY, name);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* best-effort */
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/layouts?id=${id}`, { method: "DELETE" });
      if (res.ok) await load();
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 bg-zinc-950 px-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">Layout</span>
      <select
        aria-label="Saved layouts"
        value={activeName ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="max-w-[12rem] rounded-sm border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[12px] text-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="">— default —</option>
        {layouts.map((l) => (
          <option key={l.id} value={l.name}>
            {l.name}
          </option>
        ))}
      </select>
      {activeName && (
        <button
          type="button"
          aria-label="Delete active layout"
          onClick={() => {
            const l = layouts.find((x) => x.name === activeName);
            if (l) {
              void onDelete(l.id);
              setActiveName(null);
            }
          }}
          className="text-zinc-600 hover:text-rose-400"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {canSaveLayout && (
        <span className="ml-auto flex items-center gap-1">
          <input
            type="text"
            value={saveName}
            placeholder="Save as…"
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onSave();
            }}
            className="w-32 rounded-sm border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || !saveName.trim()}
            className="rounded-sm border border-zinc-700 px-2 py-1 font-mono text-[11px] text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
          >
            Save
          </button>
        </span>
      )}
      {!canSaveLayout && used >= max && (
        <a
          href="https://one.octavo.press/pricing?from=layouts"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-amber-400 underline decoration-amber-400/50 underline-offset-2 hover:decoration-amber-400"
        >
          {max} layouts on the free desk — Pro takes it to 20 →
        </a>
      )}
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
 * Chart slot — see apps/two/src/components/ChartPane.tsx (W4). The stable
 * `id="terminal-chart"` / `data-chart-slot` hooks are now owned by ChartPane.
 */

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
  // re-apply the current selection so the highlight survives the swap. When
  // the new result set is non-empty we also re-frame the map (fitBounds) so
  // pins for a freshly applied screen aren't lost at country zoom.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.isStyleLoaded()) return;
    const src = map.getSource(TERMINAL_LISTINGS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    const fc = toFeatures(rows);
    src.setData(fc);
    applySelection(map, selectedId);
    if (fc.features.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const f of fc.features) {
        const c = (f.geometry as GeoJSON.Point).coordinates;
        bounds.extend(c as [number, number]);
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 12, duration: 0 });
    }
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
