"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronUp, ChevronDown, ChevronsUpDown, Rows3 } from "lucide-react";
import { cn } from "@oper/primitives";
import {
  formatBeds,
  formatInt,
  formatPct,
  formatPpsf,
  formatPrice,
  onePctColor,
  statusStyle,
} from "@/lib/format";
import { DENSITY_ROW_HEIGHT, type Density, type PropertyRow } from "@/lib/types";

interface Props {
  rows: PropertyRow[];
  selectedId: string | null;
  onSelect: (row: PropertyRow) => void;
}

const DENSITY_STORAGE_KEY = "two:density";

/**
 * Virtualized property grid. The pattern mirrors the TanStack Table virtual
 * recipe: outer scroll container holds an absolutely-positioned spacer +
 * positioned rows. This is the only way to keep 60fps with 2000 rows at
 * dense row heights.
 *
 * Header is sticky inside the scroll container so column meanings stay put
 * while the user scans the tape.
 */
export function PropertyTable({ rows, selectedId, onSelect }: Props) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "onePct", desc: true },
  ]);
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

  const columns = React.useMemo<ColumnDef<PropertyRow>[]>(
    () => [
      {
        id: "address",
        header: "Address",
        accessorFn: (r) => r.address,
        cell: (info) => (
          <span className="line-clamp-1 text-zinc-200">
            {info.getValue<string>()}
          </span>
        ),
        size: 280,
        enableSorting: true,
      },
      {
        id: "price",
        header: "Price",
        accessorFn: (r) => r.price,
        cell: (info) => (
          <span className="num text-zinc-100">
            {formatPrice(info.getValue<number | null>())}
          </span>
        ),
        size: 100,
      },
      {
        id: "ppsf",
        header: "$/sqft",
        accessorFn: (r) => r.ppsf,
        cell: (info) => (
          <span className="num text-zinc-300">
            {formatPpsf(info.getValue<number | null>())}
          </span>
        ),
        size: 70,
      },
      {
        id: "beds",
        header: "Bd",
        accessorFn: (r) => r.bedrooms,
        cell: (info) => (
          <span className="num text-zinc-300">
            {formatBeds(info.getValue<number | null>())}
          </span>
        ),
        size: 44,
      },
      {
        id: "baths",
        header: "Ba",
        accessorFn: (r) => r.bathrooms,
        cell: (info) => (
          <span className="num text-zinc-300">
            {formatBeds(info.getValue<number | null>())}
          </span>
        ),
        size: 44,
      },
      {
        id: "sqft",
        header: "Sqft",
        accessorFn: (r) => r.sqft,
        cell: (info) => (
          <span className="num text-zinc-300">
            {formatInt(info.getValue<number | null>())}
          </span>
        ),
        size: 70,
      },
      {
        id: "onePct",
        header: "1%",
        accessorFn: (r) => r.onePct,
        cell: (info) => {
          const v = info.getValue<number | null>();
          return (
            <span className={cn("num font-medium", onePctColor(v))}>
              {formatPct(v, 2)}
            </span>
          );
        },
        size: 64,
      },
      {
        id: "estRent",
        header: "Est. Rent",
        accessorFn: (r) => r.estimated_rent,
        cell: (info) => (
          <span className="num text-zinc-300">
            {formatPrice(info.getValue<number | null>())}
          </span>
        ),
        size: 90,
      },
      {
        id: "cap",
        header: "Cap",
        accessorFn: (r) => r.cap,
        cell: (info) => (
          <span className="num text-zinc-300">
            {formatPct(info.getValue<number | null>(), 1)}
          </span>
        ),
        size: 60,
      },
      {
        id: "dom",
        header: "DOM",
        accessorFn: (r) => r.dom,
        cell: (info) => (
          <span className="num text-zinc-400">
            {formatInt(info.getValue<number | null>())}
          </span>
        ),
        size: 52,
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (info) => {
          const s = statusStyle(info.getValue<string | null>());
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[9px] tracking-wider",
                s.bg,
                s.text,
              )}
            >
              {s.label}
            </span>
          );
        },
        size: 78,
        enableSorting: false,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const tableRows = table.getRowModel().rows;
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = DENSITY_ROW_HEIGHT[density];

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // Reset the virtualizer's cached measurements when density changes; without
  // this you get gaps where the previous row height was assumed.
  React.useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      {/* Density toggle strip */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-1 font-mono text-[10px] text-zinc-500">
        <span className="uppercase tracking-widest">
          {tableRows.length.toLocaleString()} rows
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

      <div
        ref={parentRef}
        className="relative flex-1 overflow-auto"
        // The grid template + numeric right-align is driven by column meta on
        // every cell below; keeping this here in case we add CSS-grid mode.
      >
        <table className="w-full border-separate border-spacing-0 font-mono text-[12px]">
          <thead className="sticky top-0 z-10 bg-zinc-950">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-zinc-800/60">
                {hg.headers.map((header, idx) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  const isNum = idx > 0 && header.column.id !== "status";
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.column.getSize() }}
                      className={cn(
                        "select-none border-b border-zinc-800/60 px-2 py-1.5 font-mono text-[10px] font-normal uppercase tracking-widest text-zinc-500",
                        isNum ? "text-right" : "text-left",
                        canSort && "cursor-pointer hover:text-zinc-300",
                      )}
                      onClick={
                        canSort ? header.column.getToggleSortingHandler() : undefined
                      }
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          isNum && "justify-end w-full",
                        )}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {canSort ? (
                          sortDir === "asc" ? (
                            <ChevronUp className="h-3 w-3 text-primary" />
                          ) : sortDir === "desc" ? (
                            <ChevronDown className="h-3 w-3 text-primary" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" />
                          )
                        ) : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = tableRows[vRow.index];
              const isSelected = row.original.id === selectedId;
              return (
                <tr
                  key={row.id}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelect(row.original)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                    height: `${rowHeight}px`,
                  }}
                  className={cn(
                    "flex cursor-pointer border-b border-zinc-900 hover:bg-zinc-900/50",
                    isSelected && "border-l-2 border-l-primary bg-primary/5",
                  )}
                >
                  {row.getVisibleCells().map((cell, idx) => {
                    const isNum = idx > 0 && cell.column.id !== "status";
                    return (
                      <td
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          height: rowHeight,
                        }}
                        className={cn(
                          "flex items-center px-2",
                          isNum ? "justify-end" : "justify-start",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
