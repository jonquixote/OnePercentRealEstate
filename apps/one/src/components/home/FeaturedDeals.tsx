'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { RatioGauge } from './RatioGauge';
import { STRATEGY_BY_ID, type Strategy } from '@/lib/strategies';
import { useFeatured, type FeaturedItem } from '@oper/api-client';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

function formatPropertyType(type: string | null): string {
  if (!type) return '';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FeaturedDealsProps {
  strategy: Strategy;
  rentCalcPending?: number;
}

export function FeaturedDeals({ strategy, rentCalcPending = 0 }: FeaturedDealsProps) {
  const { data, error } = useFeatured(strategy, 6);
  const meta = STRATEGY_BY_ID[strategy];
  const items = data?.items ?? null;

  if (error) {
    return (
      <section aria-labelledby="featured-headline" className="border-t border-line bg-ink">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <p className="text-sm text-muted-foreground">Failed to load featured deals.</p>
        </div>
      </section>
    );
  }
  const hasItems = items && items.length > 0;

  return (
    <section aria-labelledby="featured-headline" className="border-t border-line bg-ink">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-pass-hi">Clears the line</p>
            <h2 id="featured-headline" className="mt-1.5 font-sans text-[clamp(26px,3vw,34px)] font-semibold tracking-[-0.02em] text-white">
              {meta.label} deals worth running this week
            </h2>
          </div>
          <Link href="#opportunities" className="hidden whitespace-nowrap text-[14px] font-semibold text-haze hover:text-white sm:inline-flex sm:items-center sm:gap-1.5">
            All opportunities <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {!hasItems && items !== null ? (
            <div className="col-span-full rounded-2xl border border-dashed border-line bg-white/[0.02] p-12 text-center">
              <p className="text-[15px] font-semibold text-white">
                {rentCalcPending > 0 ? `${num.format(rentCalcPending)} listings are being analyzed` : 'Featured deals are being calculated'}
              </p>
              <p className="mt-1 text-[14px] text-muted-foreground">Top deals appear here once rent estimates complete.</p>
            </div>
          ) : (
            (items ?? Array.from({ length: 6 })).map((it: FeaturedItem | null, idx) => {
              if (!it) {
                return (
                  <div key={`s-${idx}`} className="overflow-hidden rounded-2xl border border-line bg-ink-panel">
                    <div className="aspect-[16/10] animate-pulse bg-white/[0.04]" />
                    <div className="space-y-2 p-4">
                      <div className="h-4 w-24 animate-pulse rounded bg-white/[0.04]" />
                      <div className="h-5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
                    </div>
                  </div>
                );
              }
              const tr = it.target_ratio_pct ?? 1;
              return (
                <Link
                  key={it.id}
                  href={`/property/${it.id}`}
                  className="group block overflow-hidden rounded-2xl border border-line bg-ink-panel transition hover:-translate-y-1 hover:border-pass/40 hover:shadow-[0_26px_50px_-28px_rgba(0,0,0,0.7)]"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-ink-2">
                    {it.primary_photo ? (
                      <Image
                        src={it.primary_photo}
                        alt={it.address ?? 'Property photo'}
                        fill
                        sizes="(max-width:640px) 100vw, (max-width:1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">no photo</div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/40 to-transparent" />
                    {it.ratio_pct != null && (
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-pass px-2.5 py-1 font-mono text-[12px] font-semibold tabular-nums text-white shadow-[0_6px_16px_-6px_rgba(14,159,110,0.7)]">
                        clears · {it.ratio_pct.toFixed(2)}%
                      </span>
                    )}
                    {it.property_type && (
                      <span className="absolute right-3 top-3 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[10px] font-medium text-haze backdrop-blur">
                        {formatPropertyType(it.property_type)}
                      </span>
                    )}
                  </div>

                  <div className="p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      {[it.city, it.state].filter(Boolean).join(', ')}
                    </p>
                    <p className="mt-1.5 line-clamp-1 text-[15px] font-semibold text-white">{it.address}</p>

                    <div className="mt-3 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[21px] font-semibold tabular-nums text-white">{usd0.format(it.price ?? 0)}</span>
                      <span className="text-[12.5px] text-muted-foreground">
                        {[
                          it.bedrooms != null ? `${it.bedrooms} bd` : null,
                          it.bathrooms != null ? `${it.bathrooms} ba` : null,
                          it.sqft != null ? `${num.format(it.sqft)} sf` : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">vs {tr.toFixed(2)}% line</span>
                      <RatioGauge ratioPct={it.ratio_pct} thresholdPct={tr} />
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
