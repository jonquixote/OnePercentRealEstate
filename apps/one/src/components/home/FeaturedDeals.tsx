'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useFeatured, type FeaturedItem } from '@oper/api-client';
import { type Strategy } from '@/lib/strategies';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

interface FeaturedDealsProps {
  strategy: Strategy;
  rentCalcPending?: number;
}

export function FeaturedDeals({ strategy, rentCalcPending = 0 }: FeaturedDealsProps) {
  const { data, error } = useFeatured(strategy, 6);
  const items = data?.items ?? null;

  if (error) {
    return (
      <section aria-labelledby="featured-headline" className="border-t border-line bg-ink">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
          <p className="text-sm" style={{ color: 'var(--haze)' }}>Failed to load featured deals.</p>
        </div>
      </section>
    );
  }

  const hasItems = items && items.length > 0;

  return (
    <section aria-labelledby="featured-headline" className="border-t border-line bg-ink">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
        <div className="flex items-baseline justify-between">
          <h2
            id="featured-headline"
            style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}
          >
            Clears the line
          </h2>
          <Link
            href="/search"
            className="text-[13px]"
            style={{ color: 'var(--haze)' }}
          >
            Browse all →
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3">
          {!hasItems && items !== null ? (
            <div
              className="col-span-full rounded-2xl border border-dashed p-12 text-center"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}
            >
              <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                {rentCalcPending > 0
                  ? `${num.format(rentCalcPending)} listings are being analyzed`
                  : 'Featured deals are being calculated'}
              </p>
              <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>
                Top deals appear here once rent estimates complete.
              </p>
            </div>
          ) : (
            (items ?? Array.from({ length: 6 })).map((it: FeaturedItem | null, idx) => {
              if (!it) {
                return (
                  <div key={`s-${idx}`} className="mat animate-pulse">
                    <div className="aspect-[4/3] rounded-[6px] bg-[var(--ink-2)]" />
                  </div>
                );
              }
              const ratio = it.ratio_pct ?? 0;
              const rent = it.estimated_rent ?? 0;
              const price = it.price ?? 0;
              const lo = it.rent_low ?? null;
              const hi = it.rent_high ?? null;
              const target = it.target_ratio_pct ?? 1.0;

              return (
                <Link key={it.id} href={`/property/${it.id}`} className="group cursor-pointer">
                  {/* photo mat */}
                  <div className="mat aspect-[4/3] transition-colors group-hover:border-[var(--line-hi)]">
                    {it.primary_photo ? (
                      <div className="h-full w-full overflow-hidden rounded-[6px]">
                        <Image
                          src={it.primary_photo}
                          alt={it.address ?? 'Property photo'}
                          width={480}
                          height={360}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-[6px] bg-[var(--ink-2)]" style={{ color: 'var(--mute)' }}>
                        <div className="text-center">
                          <svg className="mx-auto h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 7.5h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                          </svg>
                          <p className="mt-1 text-[11px] uppercase tracking-wider">Photo pending</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* one loud metric: ratio vs the line */}
                  <div className="mt-5 flex items-baseline justify-between">
                    <span className="figure text-[28px] figure--pass">
                      {ratio > 0 ? `${ratio.toFixed(2)}%` : '—'}
                    </span>
                    <span className="text-[12px]" style={{ color: 'var(--mute)' }}>
                      target {target.toFixed(1)}%
                    </span>
                  </div>

                  {/* whispered facts */}
                  <p className="mt-1 text-[15px]" style={{ color: 'var(--text)' }}>
                    {price > 0 ? usd0.format(price) : '—'} · rent{' '}
                    {rent > 0 ? usd0.format(rent) : '—'}
                    <span style={{ color: 'var(--mute)' }}>/mo</span>
                  </p>

                  {/* spec strip */}
                  <div className="mt-1 flex items-center gap-2 text-[12px]" style={{ color: 'var(--haze)' }}>
                    {it.bedrooms != null && <span>{it.bedrooms} bd</span>}
                    {it.bedrooms != null && it.bathrooms != null && <span>·</span>}
                    {it.bathrooms != null && <span>{it.bathrooms} ba</span>}
                    {(it.bedrooms != null || it.bathrooms != null) && it.sqft != null && <span>·</span>}
                    {it.sqft != null && <span>{num.format(it.sqft)} sqft</span>}
                  </div>

                  {/* confidence band */}
                  <div className="band mt-3" aria-label={`Rent range ${lo != null ? usd0.format(lo) : '—'}–${hi != null ? usd0.format(hi) : '—'}`}>
                    <div className="band-fill" style={{ left: '18%', width: '58%' }} />
                    <div className="band-mark" style={{ left: '44%' }} />
                  </div>

                  {/* provenance chips */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="prov prov--est">rent estimate</span>
                    <span className="prov">model v1</span>
                  </div>

                  {/* address */}
                  <p className="mt-3 truncate text-[13px]" style={{ color: 'var(--haze)' }}>
                    {it.address}
                  </p>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
