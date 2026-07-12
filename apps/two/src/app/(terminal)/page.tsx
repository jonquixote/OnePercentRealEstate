"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useViewport } from "@oper/api-client";
import { useHotkey } from "@oper/primitives";
import { toRows } from "@/lib/coerce";
import type { ViewportResponse } from "@oper/api-client";
import { useSelection } from "@/lib/selection";
import { StatBar } from "@/components/StatBar";
import { PropertyTable } from "@/components/PropertyTable";
import { ScreenTabs } from "@/components/ScreenTabs";
import { ColumnPicker } from "@/components/ColumnPicker";
import { DEFAULT_SORT, type ScreenSort } from "@/lib/screens";
import {
  DEFAULT_COLUMN_IDS,
  resolveColumns,
  serverSortKey,
} from "@/lib/columns";
import { DENSITY_ROW_HEIGHT } from "@/lib/types";

/**
 * Eastern/central US bbox at zoom=14 — covers the densest listing regions
 * (Florida triangle, Atlanta, DC/NY corridor, Chicago, Dallas, Houston).
 * The span must fit within the viewport API's limit for zoom > 10
 * ((latSpan > 50 || lonSpan > 50) && zoom > 10 is rejected).
 */
const VIEWPORT = {
  north: 42,
  south: 24.5,
  east: -66,
  west: -106,
  zoom: 14,
} as const;

export default function TerminalPage() {
  const { data, isLoading, isError, error } = useViewport(VIEWPORT);
  const { selected, setSelected } = useSelection();

  // ---- Wave 6: SQL expression results ------------------------------------
  // The top-bar FilterExpression (layout) broadcasts valid expressions via
  // the `two:filter-change` CustomEvent, which we funnel into the `expression`
  // state below (the single source of truth). A non-empty expression switches
  // the grid's data source from the viewport feed to /api/properties/query
  // (same-origin via nginx; the server re-parses + re-compiles — client
  // output is never trusted). Empty expression -> back to the viewport tape.
  // ScreenTabs also drives `expression`/`sort`/`columnIds` when a screen is applied.
  const [queryRows, setQueryRows] = React.useState<unknown[] | null>(null);
  const [queryState, setQueryState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const queryAbort = React.useRef<AbortController | null>(null);

  const [expression, setExpression] = React.useState('');
  const [sort, setSort] = React.useState<ScreenSort | null>(DEFAULT_SORT);

  // ---- W2: column layout (per screen) ------------------------------------
  // Visible column ids in render order. Screens carry their own `columns`
  // JSONB; user edits persist back to the active user screen (PATCH) and to
  // localStorage keyed by screen id (so built-in / anon layouts survive a
  // reload too).
  const [columnIds, setColumnIds] = React.useState<string[]>(DEFAULT_COLUMN_IDS);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [activeScreen, setActiveScreen] = React.useState<{
    id: string;
    kind: 'builtin' | 'user';
  } | null>(null);

  const columns = React.useMemo(() => resolveColumns(columnIds), [columnIds]);

  // Live screen sort surfaced to ScreenTabs (dirty tracking).
  const liveSort: ScreenSort | null = sort;

  // Toggle server-side sort on a column id. Same column flips direction;
  // a new column starts descending (metrics read high→low by default).
  const onSortChange = React.useCallback((colId: string) => {
    setSort((prev) =>
      prev && prev.col === colId
        ? { col: colId, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { col: colId, dir: 'desc' },
    );
  }, []);

  // Persist a column layout: PATCH the active user screen's `columns` JSONB and
  // mirror to localStorage (covers built-in + anonymous screens, whose layout
  // can't live server-side).
  const persistColumns = React.useCallback(
    (ids: string[], screen: { id: string; kind: 'builtin' | 'user' } | null) => {
      const key = `two:columns:${screen?.id ?? 'default'}`;
      try {
        window.localStorage.setItem(key, JSON.stringify(ids));
      } catch {
        /* ignore */
      }
      if (screen?.kind === 'user') {
        void fetch(`/api/screens?id=${screen.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ columns: ids }),
        }).catch(() => {
          /* non-fatal: localStorage still holds the layout */
        });
      }
    },
    [],
  );

  const onColumnsChange = React.useCallback(
    (ids: string[]) => {
      setColumnIds(ids.length > 0 ? ids : DEFAULT_COLUMN_IDS);
      persistColumns(ids, activeScreen);
    },
    [activeScreen, persistColumns],
  );

  // Apply a screen: set the expression + sort + columns and let the effect
  // below run the query. The FilterExpression bar stays the canonical place to
  // type a free-form expression; screens just pre-fill it.
  const applyScreen = React.useCallback(
    (s: {
      id: string;
      kind: 'builtin' | 'user';
      expression: string;
      sort: ScreenSort | null;
      columns: string[];
    }) => {
      setExpression(s.expression.trim());
      setSort(s.sort ?? DEFAULT_SORT);
      setActiveScreen({ id: s.id, kind: s.kind });
      // Prefer a localStorage override (last user edit for this screen), then
      // the screen's stored columns, then the default set.
      let ids = s.columns.filter(Boolean);
      try {
        const stored = window.localStorage.getItem(`two:columns:${s.id}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
            ids = parsed;
          }
        }
      } catch {
        /* ignore */
      }
      setColumnIds(ids.length > 0 ? ids : DEFAULT_COLUMN_IDS);
    },
    [],
  );

  React.useEffect(() => {
    const onFilter = (e: Event) => {
      setExpression(String((e as CustomEvent).detail ?? '').trim());
    };
    window.addEventListener('two:filter-change', onFilter);
    return () => window.removeEventListener('two:filter-change', onFilter);
  }, []);

  // Run the query whenever the live expression or sort changes. Sort is
  // server-side: we translate the column id to a whitelisted ORDER BY id
  // (serverSortKey) and ship only that — the server re-validates it against its
  // own whitelist, so an unmapped id is harmless (falls back to id DESC).
  React.useEffect(() => {
    if (!expression) {
      queryAbort.current?.abort();
      setQueryRows(null);
      setQueryState('idle');
      return;
    }
    const ctrl = new AbortController();
    queryAbort.current = ctrl;
    setQueryState('loading');
    const serverKey = serverSortKey(sort?.col);
    const orderBy = serverKey && sort ? { col: serverKey, dir: sort.dir } : undefined;
    fetch('/api/properties/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expression, limit: 500, orderBy }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`query ${r.status}`))))
      .then((d) => {
        setQueryRows(Array.isArray(d?.items) ? d.items : []);
        setQueryState('idle');
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setQueryRows(null);
        setQueryState('error');
      });
    return () => ctrl.abort();
  }, [expression, sort]);

  // One pass to coerce numeric strings -> numbers and derive 1%/cap/$/sqft.
  // Memoised so the table + StatBar don't recompute on every selection change.
  const rows = React.useMemo(() => {
    if (queryRows !== null) {
      return toRows({ type: 'properties', data: queryRows } as ViewportResponse);
    }
    return toRows(data);
  }, [data, queryRows]);

  // ---- j/k row navigation ----------------------------------------------
  // Re-derive the current index off the live rows array so sort changes
  // (the table can re-sort) don't desync. When nothing is selected, j picks
  // the first row and k picks the last — feels right for a tape.
  const goByOffset = React.useCallback(
    (offset: 1 | -1) => {
      if (rows.length === 0) return;
      if (!selected) {
        setSelected(offset === 1 ? rows[0] : rows[rows.length - 1]);
        return;
      }
      const idx = rows.findIndex((r) => r.id === selected.id);
      if (idx === -1) {
        setSelected(rows[0]);
        return;
      }
      const next = idx + offset;
      if (next < 0 || next >= rows.length) return;
      setSelected(rows[next]);
    },
    [rows, selected, setSelected],
  );

  useHotkey("j", () => goByOffset(1), {
    description: "Next row",
    group: "Navigation",
  });
  useHotkey("k", () => goByOffset(-1), {
    description: "Previous row",
    group: "Navigation",
  });

  // ---- Search focus (/) --------------------------------------------------
  useHotkey(
    "/",
    () => {
      const input = document.getElementById("terminal-search");
      if (input instanceof HTMLInputElement) {
        input.focus();
      }
    },
    { description: "Focus search", group: "Navigation", preventDefault: true },
  );

  // ---- Portfolio navigation (g p) ----------------------------------------
  const router = useRouter();
  useHotkey(
    "g p",
    () => {
      router.push("/portfolio");
    },
    { description: "Go to portfolio", group: "Navigation" },
  );

  // ---- Watchlist toggle (s) -----------------------------------------------
  useHotkey(
    "s",
    () => {
      if (selected?.id) {
        // eslint-disable-next-line no-console
        console.info("watchlist toggle stub:", selected.id);
        showWatchlistToast();
      }
    },
    { description: "Toggle watchlist for selected row", group: "Actions" },
  );

  // ---- Copy address to clipboard (y = yank) ------------------------------
  // `c` is reassigned to the W2 column picker below, so copy moves to the
  // vim-idiomatic yank key.
  useHotkey(
    "y",
    () => {
      if (selected?.address) {
        navigator.clipboard
          .writeText(selected.address)
          .then(() => {
            showCopiedToast();
          })
          .catch(() => {
            showErrorToast("Failed to copy");
          });
      }
    },
    { description: "Copy (yank) selected row address to clipboard", group: "Actions" },
  );

  // ---- Column picker (c) --------------------------------------------------
  useHotkey(
    "c",
    () => {
      setPickerOpen((v) => !v);
    },
    { description: "Toggle column picker", group: "Data" },
  );

  // ---- Top-bar status portal ------------------------------------------
  // Layout reserves a `#topbar-status` slot; we render the count + zoom into
  // it from here so the header chrome stays a layout-time concern and the
  // data is page-driven.
  const status = React.useMemo(() => {
    if (queryState === 'loading') return 'query…';
    if (queryState === 'error') return 'query error';
    if (queryRows !== null) return `${rows.length.toLocaleString()} matches · expression`;
    if (isLoading) return "loading…";
    if (isError) return "error";
    return `${rows.length.toLocaleString()} listings · zoom ${VIEWPORT.zoom}`;
  }, [isLoading, isError, rows.length, queryState, queryRows]);

  // ---- Wave 6: CSV export (e) --------------------------------------------
  useHotkey(
    "e",
    () => {
      if (rows.length === 0) return;
      const cols = ["id", "address", "price", "bedrooms", "bathrooms", "sqft", "estimated_rent"] as const;
      const esc = (v: unknown) => {
        let s = v == null ? "" : String(v);
        // CSV formula-injection guard: cell values are scraped external data
        // (addresses etc.); a leading = + - @ or tab/CR would execute as a
        // formula in Excel/Sheets. Neutralize with a leading apostrophe.
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [cols.join(",")]
        .concat(rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(",")))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `octavo-terminal-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      // Deferred revoke: synchronous revocation can cancel the download in
      // some browsers (PR #9 review).
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    },
    { description: "Export current rows to CSV", group: "Data" },
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <TopbarStatusPortal text={status} />

      {isError ? (
        <div
          role="alert"
          className="border-b border-rose-700 bg-rose-950 px-3 py-2 font-mono text-[11px] text-rose-200"
        >
          viewport fetch failed{error instanceof Error ? `: ${error.message}` : ""}
        </div>
      ) : null}

      {isLoading ? <TableSkeleton /> : null}

      {!isLoading && !isError ? (
        <>
          <ScreenTabs
            expression={expression}
            sort={liveSort}
            onApply={applyScreen}
          />
          <StatBar rows={rows} />
          <div className="flex-1 min-h-0">
            <PropertyTable
              rows={rows}
              columns={columns}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
              sort={sort}
              onSortChange={onSortChange}
            />
          </div>
          <ColumnPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            columnIds={columnIds}
            onChange={onColumnsChange}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Show a transient toast notification. Simple DOM-based; no external library.
 */
function showTransientToast(message: string, bgClass: string) {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-sm font-mono text-[12px] text-white animate-pulse z-50 ${bgClass}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 1500);
}

function showWatchlistToast() {
  showTransientToast("Added to watchlist", "bg-blue-600");
}

function showCopiedToast() {
  showTransientToast("Copied to clipboard", "bg-green-600");
}

function showErrorToast(message: string) {
  showTransientToast(message, "bg-red-600");
}

/**
 * Portal the live status text into the layout's `#topbar-status` slot. Two
 * mounts (this and the layout slot) coexist without prop-drilling at the
 * cost of a single DOM lookup on mount — fine for a header. SSR-safe: we
 * only attach after the effect runs.
 */
function TopbarStatusPortal({ text }: { text: string }) {
  const [host, setHost] = React.useState<Element | null>(null);
  React.useEffect(() => {
    setHost(document.getElementById("topbar-status"));
  }, []);
  if (!host) return null;
  return createPortal(<span>{text}</span>, host);
}

/**
 * Five-row skeleton sized to match the dense table density default. Keeps
 * the perceived layout shift to a few pixels when the real rows mount.
 */
function TableSkeleton() {
  const rowH = DENSITY_ROW_HEIGHT.compact;
  return (
    <div
      aria-busy
      aria-label="Loading listings"
      className="flex-1 animate-pulse divide-y divide-zinc-900 border-b border-zinc-800/60"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-3"
          style={{ height: rowH }}
        >
          <div className="h-2 w-1/3 rounded bg-zinc-800/80" />
          <div className="h-2 w-16 rounded bg-zinc-800/60" />
          <div className="h-2 w-12 rounded bg-zinc-800/60" />
          <div className="h-2 w-10 rounded bg-zinc-800/60" />
          <div className="ml-auto h-2 w-14 rounded bg-zinc-800/60" />
        </div>
      ))}
    </div>
  );
}
