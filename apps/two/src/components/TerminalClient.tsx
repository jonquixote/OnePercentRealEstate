"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useViewport } from "@oper/api-client";
import { useHotkey } from "@oper/primitives";
import { toRows } from "@/lib/coerce";
import type { ViewportResponse } from "@oper/api-client";
import { useSelection } from "@/lib/selection";
import { Workspace, type BottomPane } from "@/components/Workspace";
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
 * Persistent demo banner. Shown only in demo mode (!isPro). Amber, sticky at
 * the top of the terminal, always visible — it links to /pricing with the
 * real Pro price so free/anon users can upgrade. The Pro price ($19/mo) is
 * kept in sync with the pricing page.
 */
function DemoBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-40 shrink-0 border-b border-amber-700 bg-amber-500/15 px-3 py-2 font-mono text-[12px] text-amber-200"
    >
      Terminal is a Pro feature — full access from{" "}
      <span className="font-semibold text-amber-100">$19/mo</span>.{" "}
      <Link
        href="/pricing"
        className="underline underline-offset-2 hover:text-amber-50"
      >
        See pricing →
      </Link>
    </div>
  );
}

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

export function TerminalClient({
  isPro,
}: {
  isPro: boolean;
}) {
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
  const [latencyMs, setLatencyMs] = React.useState<number | null>(null);
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
    name: string;
  } | null>(null);

  // ---- W3: bottom pane (map | chart) --------------------------------
  // m toggles map, x toggles chart, esc returns focus to the table. The
  // active pane (or null = collapsed) is persisted so the layout survives a
  // reload. Hydrated after mount to stay SSR-safe.
  const [bottomPane, setBottomPane] = React.useState<BottomPane>(null);
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem('two:bottom-pane');
      if (v === 'map' || v === 'chart') setBottomPane(v);
    } catch {
      /* ignore */
    }
  }, []);
  React.useEffect(() => {
    try {
      window.localStorage.setItem('two:bottom-pane', bottomPane ?? '');
    } catch {
      /* ignore */
    }
  }, [bottomPane]);

  const columns = React.useMemo(() => resolveColumns(columnIds), [columnIds]);

  // Live screen sort surfaced to ScreenTabs (dirty tracking).
  const liveSort: ScreenSort | null = sort;

  // Toggle server-side sort on a column id. Same column flips direction;
  // a new column starts descending (metrics read high→low by default).
  const onSortChange = React.useCallback((colId: string) => {
    setSort((prev) =>
      prev && prev.col === colId
        ? { col: colId, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
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
      name: string;
      expression: string;
      sort: ScreenSort | null;
      columns: string[];
    }) => {
      const expr = s.expression.trim();
      setExpression(expr);
      setSort(s.sort ?? DEFAULT_SORT);
      setActiveScreen({ id: s.id, kind: s.kind, name: s.name });
      // Keep the top filter bar in sync with the applied screen by routing
      // through the same `two:filter-change` channel the bar emits on edit.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("two:filter-change", { detail: expr }));
      }
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
      // A free-form (ad-hoc) expression means we're no longer on an applied
      // screen — fall back to "live filter" in the StatBar.
      setActiveScreen(null);
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
    setLatencyMs(null);
    const t0 = performance.now();
    const serverKey = serverSortKey(sort?.col);
    const orderBy = serverKey && sort ? { col: serverKey, dir: sort.dir } : undefined;
    fetch('/api/properties/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expression, limit: 500, orderBy }),
      signal: ctrl.signal,
    })
      .then((r) => {
        if (r.ok) return r.json();
        // Non-ok: read the body so we can surface the parser's message +
        // caret position (backward compatible — the worker only reads
        // `.message`, which we still emit).
        return r.json().then((body) => {
          const message = body?.message ?? body?.error ?? `query ${r.status}`;
          const position: number | null = body?.position ?? null;
          window.dispatchEvent(
            new CustomEvent('two:query-error', { detail: { message, position } }),
          );
          return Promise.reject(new Error(message));
        });
      })
      .then((d) => {
        setQueryRows(Array.isArray(d?.items) ? d.items : []);
        setLatencyMs(Math.round(performance.now() - t0));
        setQueryState('idle');
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setQueryRows(null);
        setQueryState('error');
      });
    return () => ctrl.abort();
  }, [expression, sort]);

  // Active screen name for the StatBar: an applied screen wins; otherwise fall
  // back to "live filter" when an ad-hoc expression is driving the grid, or
  // "live feed" for the raw viewport tape.
  const screenName = React.useMemo(() => {
    if (activeScreen?.name) return activeScreen.name;
    return expression.trim() ? "live filter" : "live feed";
  }, [activeScreen, expression]);

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

  // ---- W3: pane toggles + focus moves -------------------------------
  // `m` shows the map pane (toggle off if already open), `x` the chart pane.
  useHotkey(
    "m",
    () => setBottomPane((p) => (p === "map" ? null : "map")),
    { description: "Toggle map pane", group: "Panes" },
  );
  useHotkey(
    "x",
    () => setBottomPane((p) => (p === "chart" ? null : "chart")),
    { description: "Toggle chart pane", group: "Panes" },
  );
  // `enter` moves keyboard focus to the inspector (right pane).
  useHotkey(
    "enter",
    () => {
      document.getElementById("terminal-inspector")?.focus();
    },
    { description: "Focus inspector", group: "Panes" },
  );
  // `esc` returns focus to the table.
  useHotkey(
    "escape",
    () => {
      document.getElementById("terminal-table")?.focus();
    },
    { description: "Focus table", group: "Panes" },
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

  // ---- X1: pro CSV export (⌘E) ------------------------------------------
  // Server-generated, streamed CSV of the CURRENT screen's full result set
  // (same compiled query as the grid, LIMIT 10K). Pro-gated: the server 402s
  // free users and we surface the upsell. Saved user screens export by id (the
  // server reloads their stored expression + columns); built-in / free-form
  // expressions ship the live expression + visible columns, which the server
  // re-compiles. Row set therefore matches what the table/StatBar show.
  const exportCsv = React.useCallback(async () => {
    const serverKey = serverSortKey(sort?.col);
    const orderBy = serverKey && sort ? { col: serverKey, dir: sort.dir } : undefined;

    let payload: Record<string, unknown>;
    if (activeScreen?.kind === 'user') {
      payload = { screenId: Number(activeScreen.id), orderBy };
    } else if (expression.trim()) {
      payload = {
        expression: expression.trim(),
        columns: columnIds,
        orderBy,
        name: activeScreen?.name,
      };
    } else {
      showErrorToast('Apply a screen or filter to export');
      return;
    }

    try {
      const res = await fetch('/api/properties/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (res.status === 402) {
        showUpsellToast();
        return;
      }
      if (!res.ok) {
        showErrorToast('Export failed');
        return;
      }
      const blob = await res.blob();
      // Prefer the server-authored filename (proper screen slug); fall back to
      // a generic dated name.
      const cd = res.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(cd);
      const filename =
        match?.[1] ?? `oper-screen-${new Date().toISOString().slice(0, 10)}.csv`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      // Deferred revoke: synchronous revocation can cancel the download in
      // some browsers.
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      showErrorToast('Export failed');
    }
  }, [activeScreen, expression, columnIds, sort]);

  useHotkey("cmd+e", () => void exportCsv(), {
    description: "Export current screen to CSV (Pro)",
    group: "Data",
    preventDefault: true,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {!isPro ? <DemoBanner /> : null}

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
            columnIds={columnIds}
            onApply={applyScreen}
            onExport={() => void exportCsv()}
          />
          <Workspace
            rows={rows}
            columns={columns}
            sort={sort}
            onSortChange={onSortChange}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            selectedZip={selected?.zip_code ?? null}
            bottomPane={bottomPane}
            latencyMs={latencyMs}
            screenName={screenName}
          />
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

function showUpsellToast() {
  showTransientToast("CSV export is a Terminal Pro feature — upgrade to export", "bg-amber-600");
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
