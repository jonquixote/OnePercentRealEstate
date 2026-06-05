"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useProperties } from "@oper/api-client";
import type { PropertyListItem } from "@oper/api-client";
import { ThemeToggle } from "@oper/primitives";
import {
  formatPct,
  formatPrice,
  formatCompact,
} from "@/lib/format";
import { calculatePortfolioMetrics } from "./portfolio";

/**
 * Portfolio page: renders a grid of starred properties (from localStorage)
 * and shows aggregate portfolio metrics.
 */
export default function PortfolioPage() {
  const [watchlistIds, setWatchlistIds] = React.useState<string[]>([]);

  // Load watchlist from localStorage on mount
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem("two:watchlist");
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        if (Array.isArray(ids)) {
          setWatchlistIds(ids);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const { data: properties = [], isLoading } = useProperties(watchlistIds);

  const metrics = React.useMemo(
    () => calculatePortfolioMetrics(properties),
    [properties]
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950 px-6">
        <Link
          href="/"
          className="flex items-center gap-1 rounded-sm border border-transparent px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
        >
          <ArrowLeft className="h-3 w-3" />
          Terminal
        </Link>

        <div className="flex items-baseline gap-2 font-mono">
          <span className="text-base font-semibold uppercase tracking-widest text-zinc-100">
            octavo
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">
            · portfolio
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {watchlistIds.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Aggregate stats */}
            <div className="mb-8 grid grid-cols-4 gap-4">
              <AggregateCard
                label="IRR"
                value={formatPct(metrics.irr, 1)}
              />
              <AggregateCard
                label="MoM"
                value={formatPct(metrics.mom, 1)}
              />
              <AggregateCard
                label="Avg Cap"
                value={formatPct(metrics.avgCapRate, 1)}
              />
              <AggregateCard
                label="Monthly CF"
                value={formatPrice(metrics.totalMonthlyCashflow)}
              />
            </div>

            {/* Properties grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-40 animate-pulse rounded border border-zinc-800 bg-zinc-900"
                  />
                ))
              ) : (
                properties.map((prop) => (
                  <PropertyCard key={prop.id} property={prop} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <p className="font-mono text-[12px] uppercase tracking-widest text-zinc-500">
          No properties starred
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Press <code className="bg-zinc-900 px-1 font-mono">s</code> on rows in the terminal to star them. Starred listings appear here.
        </p>
      </div>
    </div>
  );
}

function AggregateCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-900/40 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl tabular-nums text-zinc-100">
        {value}
      </p>
    </div>
  );
}

function PropertyCard({ property }: { property: PropertyListItem }) {
  // Calculate metrics for this property
  const price = property.listing_price ?? 0;
  const rent = property.estimated_rent ?? 0;
  const onePct = price > 0 ? ((rent / price) * 100).toFixed(2) : "—";
  const cap = price > 0 ? (((rent * 12) / price) * 100).toFixed(1) : "—";
  const monthlyCf = rent;

  return (
    <div className="flex flex-col rounded border border-zinc-800/60 bg-zinc-900/40 p-4">
      {/* Address */}
      <h3
        className="line-clamp-2 font-mono text-[12px] font-medium text-zinc-100"
        title={property.address}
      >
        {property.address}
      </h3>

      {/* Stats grid */}
      <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div>
          <p className="text-zinc-500">Price</p>
          <p className="tabular-nums text-zinc-100">
            {formatPrice(price)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Est. Rent</p>
          <p className="tabular-nums text-zinc-100">
            {formatPrice(rent)}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">1%</p>
          <p className="tabular-nums text-zinc-100">{onePct}%</p>
        </div>
        <div>
          <p className="text-zinc-500">Cap</p>
          <p className="tabular-nums text-zinc-100">{cap}%</p>
        </div>
      </div>

      {/* Monthly cashflow footer */}
      <div className="mt-3 border-t border-zinc-800/40 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Monthly CF
        </p>
        <p className="font-mono text-lg tabular-nums text-zinc-100">
          {formatPrice(monthlyCf)}
        </p>
      </div>
    </div>
  );
}
