'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

interface FeaturedItem {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  price: number | null;
  estimated_rent: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  primary_photo: string | null;
  ratio_pct: number | null;
}

function formatPrice(n: number | null): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function ratioColor(pct: number | null): string {
  if (pct == null) return 'bg-slate-900/80 text-white';
  if (pct >= 1.5) return 'bg-emerald-600 text-white';
  if (pct >= 1.0) return 'bg-emerald-500 text-white';
  return 'bg-amber-500 text-white';
}

/**
 * Featured deals strip — top-ranked 1% rule passes. Sits between the
 * stats strip and the full opportunities grid. Photo-led, with a
 * prominent ratio chip overlaid so the eye lands on the financial signal
 * before the address.
 */
export function FeaturedDeals() {
  const [items, setItems] = useState<FeaturedItem[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/featured?limit=6', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (!cancelled) setItems(j.items);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (errored) return null;

  return (
    <section
      aria-labelledby="featured-headline"
      className="bg-white"
    >
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8 lg:py-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-emerald-700">
              Featured
            </p>
            <h2
              id="featured-headline"
              className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"
            >
              Top 1% rule passes this week
            </h2>
          </div>
          <Link
            href="#opportunities"
            className="hidden whitespace-nowrap text-sm font-semibold leading-6 text-slate-700 hover:text-slate-900 sm:inline-flex sm:items-center sm:gap-1"
          >
            All opportunities <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {(items ?? Array.from({ length: 6 })).map((it: any, idx) => {
            if (!it) {
              return (
                <div
                  key={`skeleton-${idx}`}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <div className="aspect-[16/10] animate-pulse bg-slate-100" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                    <div className="h-5 w-3/4 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              );
            }
            return (
              <Link
                key={it.id}
                href={`/property/${it.id}`}
                className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg hover:-translate-y-0.5"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                  {it.primary_photo ? (
                    <Image
                      src={it.primary_photo}
                      alt={it.address ?? 'Property photo'}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">
                      no photo
                    </div>
                  )}
                  {it.ratio_pct != null && (
                    <span
                      className={`absolute left-3 top-3 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tracking-tight tabular-nums shadow-md backdrop-blur ${ratioColor(it.ratio_pct)}`}
                    >
                      1% rule · {it.ratio_pct.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
                    {[it.city, it.state].filter(Boolean).join(', ')}
                  </p>
                  <p className="mt-1 line-clamp-1 text-sm font-semibold text-slate-900">
                    {it.address}
                  </p>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">
                      {formatPrice(it.price)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {[
                        it.bedrooms != null ? `${it.bedrooms} bd` : null,
                        it.bathrooms != null ? `${it.bathrooms} ba` : null,
                        it.sqft != null ? `${new Intl.NumberFormat('en-US').format(it.sqft)} sqft` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
