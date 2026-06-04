"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useViewport } from "@oper/api-client";
import { useHotkey } from "@oper/primitives";
import { toRows } from "@/lib/coerce";
import { useSelection } from "@/lib/selection";
import { StatBar } from "@/components/StatBar";
import { PropertyTable } from "@/components/PropertyTable";
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

  // One pass to coerce numeric strings -> numbers and derive 1%/cap/$/sqft.
  // Memoised so the table + StatBar don't recompute on every selection change.
  const rows = React.useMemo(() => toRows(data), [data]);

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

  // ---- Top-bar status portal ------------------------------------------
  // Layout reserves a `#topbar-status` slot; we render the count + zoom into
  // it from here so the header chrome stays a layout-time concern and the
  // data is page-driven.
  const status = React.useMemo(() => {
    if (isLoading) return "loading…";
    if (isError) return "error";
    return `${rows.length.toLocaleString()} listings · zoom ${VIEWPORT.zoom}`;
  }, [isLoading, isError, rows.length]);

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
          <StatBar rows={rows} />
          <div className="flex-1 min-h-0">
            <PropertyTable
              rows={rows}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
          </div>
        </>
      ) : null}
    </div>
  );
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
