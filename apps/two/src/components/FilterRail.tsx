"use client";

import * as React from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Filter,
  DollarSign,
  Home,
  Bath,
  SquareDashed,
} from "lucide-react";
import { cn } from "@oper/primitives";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Left rail filter panel. Controls are local-only for v1 — they don't yet
 * push into useViewport params. Plumbing comes in the next pass; what
 * matters now is the visual density and the collapse interaction.
 */
export function FilterRail({ collapsed, onToggle }: Props) {
  const [status, setStatus] = React.useState("for_sale");
  const [price, setPrice] = React.useState(500_000);
  const [beds, setBeds] = React.useState(0);
  const [baths, setBaths] = React.useState(0);
  const [maxPpsf, setMaxPpsf] = React.useState(400);

  if (collapsed) {
    return (
      <aside className="flex h-full w-full flex-col items-center border-r border-zinc-800/60 bg-zinc-950 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand filters"
          className="flex h-8 w-8 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
        <div className="mt-2 flex flex-col items-center gap-1 text-zinc-500">
          <IconButton label="Filters"><Filter className="h-4 w-4" /></IconButton>
          <IconButton label="Price"><DollarSign className="h-4 w-4" /></IconButton>
          <IconButton label="Beds"><Home className="h-4 w-4" /></IconButton>
          <IconButton label="Baths"><Bath className="h-4 w-4" /></IconButton>
          <IconButton label="$/sqft"><SquareDashed className="h-4 w-4" /></IconButton>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-zinc-800/60 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Filters
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse filters"
          className="flex h-6 w-6 items-center justify-center rounded-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section label="Status">
          <div className="grid grid-cols-3 gap-1">
            {(["for_sale", "pending", "sold"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-sm border px-2 py-1 font-mono text-[10px] uppercase",
                  status === s
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-900",
                )}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Max Price" value={`$${(price / 1000).toFixed(0)}k`}>
          <input
            type="range"
            min={50_000}
            max={2_000_000}
            step={25_000}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="terminal-range w-full"
          />
        </Section>

        <Section label="Beds" value={beds === 0 ? "Any" : `${beds}+`}>
          <Stepper value={beds} onChange={setBeds} max={6} />
        </Section>

        <Section label="Baths" value={baths === 0 ? "Any" : `${baths}+`}>
          <Stepper value={baths} onChange={setBaths} max={5} />
        </Section>

        <Section label="Max $/sqft" value={`$${maxPpsf}`}>
          <input
            type="range"
            min={50}
            max={1000}
            step={10}
            value={maxPpsf}
            onChange={(e) => setMaxPpsf(Number(e.target.value))}
            className="terminal-range w-full"
          />
        </Section>

        <Section label="Sort">
          <select
            defaultValue="onePct_desc"
            className="w-full rounded-sm border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-300 outline-none focus:border-primary/60"
          >
            <option value="onePct_desc">1% rule (desc)</option>
            <option value="cap_desc">Cap rate (desc)</option>
            <option value="price_asc">Price (asc)</option>
            <option value="ppsf_asc">$/sqft (asc)</option>
          </select>
        </Section>
      </div>

      <div className="border-t border-zinc-800/60 px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          v1 · local-only
        </p>
      </div>
    </aside>
  );
}

function Section({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-zinc-800/40 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          {label}
        </span>
        {value ? (
          <span className="num text-[11px] text-zinc-300">{value}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Stepper({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  max: number;
}) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {Array.from({ length: max + 1 }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className={cn(
            "rounded-sm border px-1 py-1 font-mono text-[10px]",
            value === i
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-zinc-800 text-zinc-400 hover:bg-zinc-900",
          )}
        >
          {i === 0 ? "Any" : i}
        </button>
      ))}
    </div>
  );
}

function IconButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-zinc-900 hover:text-zinc-200"
    >
      {children}
    </button>
  );
}
