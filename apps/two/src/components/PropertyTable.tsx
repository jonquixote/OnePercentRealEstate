"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronUp, ChevronDown, ChevronsUpDown, Rows3 } from "lucide-react";
import { cn } from "@oper/primitives";
import type { ColumnDef } from "@/lib/columns";
import type { ScreenSort } from "@/lib/screens";
import { DENSITY_ROW_HEIGHT, type Density, type PropertyRow } from "@/lib/types";

interface Props {
  rows: PropertyRow[];
  /** Ordered, visible column defs (already resolved from the active screen). */
  columns: ColumnDef[];
  selectedId: string | null;
  onSelect: (row: PropertyRow) => void;
  /** Controlled sort ({col: columnId, dir}); server-side. */
  sort: ScreenSort | null;
  /** Toggle sort on a column id. The page maps it to a server ORDER BY. */
  onSortChange: (colId: string) => void;
}

const DENSITY_STORAGE_KEY = "two:density";

/**
 * Virtualized property grid. The pattern mirrors the TanStack virtual recipe:
 * outer scroll container holds an absolutely-positioned spacer + positioned
 * rows. This is the only way to keep 60fps with 2000 rows at dense row heights.
 *
 * W2: columns now come from the registry (`lib/columns.tsx`) via the `columns`
 * prop — the grid no longer hardcodes them. Sort is SERVER-SIDE: a header click
 * calls `onSortChange(colId)`; the page re-runs the query with a whitelisted
 * ORDER BY. Rows arrive pre-sorted, so the grid does not re-sort locally.
 *
 * Header is sticky inside the scroll container so column meanings stay put
 * while the user scans the tape.
 */
export function PropertyTable({ rows, columns, selectedId, onSelect, sort, onSortChange }: Props) {
  const [density, setDensity] = React.useState<Density>("compact");

  // Hydrate density from localStorage once after mount. We don't read in the
  // initializer so SSR + first paint stay in agreement.
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null;
      if (v === "cozy" || v === "compact" || v === "dense") setDensity(v);
    } catch {
      /* ignore — localStorage can throw under strict cookie policies */
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
    } catch {
      /* ignore */
    }
  }, [density]);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = DENSITY_ROW_HEIGHT[density];

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // Reset the virtualizer's cached measurements when density changes; without
  // this you get gaps where the previous row height was assumed.
  React.useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  const totalWidth = React.useMemo(
    () => columns.reduce((acc, c) => acc + c.width, 0),
    [columns],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {/* Density toggle strip */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-1 font-mono text-[10px] text-zinc-500">
        <span className="uppercase tracking-widest">
          {rows.length.toLocaleString()} rows
        </span>
        <div className="flex items-center gap-1">
          <Rows3 className="h-3 w-3" />
          {(["cozy", "compact", "dense"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 uppercase",
                density === d
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div ref={parentRef} className="relative flex-1 overflow-auto">
        <div style={{ minWidth: totalWidth }}>
          {/* Sticky header */}
          <div className="sticky top-0 z-10 flex border-b border-zinc-800/60 bg-zinc-950">
            {columns.map((col) => {
              const canSort = Boolean(col.sortKey);
              const active = sort?.col === col.id;
              const isNum = col.align === "right";
              return (
                <div
                  key={col.id}
                  style={{ width: col.width }}
                  className={cn(
                    "flex shrink-0 select-none items-center gap-1 px-2 py-1.5 font-mono text-[10px] font-normal uppercase tracking-widest text-zinc-500",
                    isNum ? "justify-end" : "justify-start",
                    canSort && "cursor-pointer hover:text-zinc-300",
                  )}
                  onClick={canSort ? () => onSortChange(col.id) : undefined}
                >
                  <span>{col.label}</span>
                  {canSort ? (
                    active ? (
                      sort?.dir === "asc" ? (
                        <ChevronUp className="h-3 w-3 text-primary" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-primary" />
                      )
                    ) : (
                      <ChevronsUpDown className="h-3 w-3 opacity-40" />
                    )
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Virtualized body */}
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index];
              const isSelected = row.id === selectedId;
              return (
                <div
                  key={row.id}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelect(row)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                    height: `${rowHeight}px`,
                  }}
                  className={cn(
                    "flex cursor-pointer border-b border-zinc-900 font-mono text-[12px] hover:bg-zinc-900/50",
                    isSelected && "border-l-2 border-l-primary bg-primary/5",
                  )}
                >
                  {columns.map((col) => (
                    <div
                      key={col.id}
                      style={{ width: col.width, height: rowHeight }}
                      className={cn(
                        "flex shrink-0 items-center px-2",
                        col.align === "right" ? "justify-end" : "justify-start",
                      )}
                    >
                      {col.render(row)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
