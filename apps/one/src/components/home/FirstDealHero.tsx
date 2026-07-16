'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CountUpRatio } from './CountUpRatio';
import type { Spotlight } from '@/lib/spotlight';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function FirstDealHero() {
  const [metroLabel, setMetroLabel] = useState('');
  const [metroZip, setMetroZip] = useState('');
  const [deal, setDeal] = useState<Spotlight | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  async function load(zip?: string) {
    setLoading(true);
    try {
      const url = zip ? `/api/spotlight?zip=${encodeURIComponent(zip)}` : '/api/spotlight';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMetroLabel(data.metro?.label ?? '');
      setMetroZip(data.metro?.zip ?? '');
      setDeal(data.deal ?? null);
    } catch (err) {
      console.error('Failed to load spotlight deal:', err);
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  // Typed-ZIP reveal: re-fetch the spotlight for that ZIP and re-reveal in place
  // (client-side, no full reload). `action="/search"` is the no-JS fallback; we
  // only reach it if JS is disabled since we preventDefault below.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const zip = q.trim().match(/^\d{5}$/)?.[0];
    if (zip) void load(zip);
  }

  return (
    <section aria-labelledby="hero-h" className="border-b border-line">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <p className="prov">Real listings · live rent estimates</p>
        <h1 id="hero-h" className="mt-2 max-w-3xl font-sans text-4xl font-semibold tracking-[-0.02em] sm:text-5xl" style={{ color: 'var(--text)' }}>
          The best cash-flowing property {metroLabel ? `in ${metroLabel}` : 'near you'}, right now.
        </h1>
        <form action="/search" onSubmit={handleSubmit} className="mt-6 flex max-w-md gap-2">
          <label htmlFor="hero-q" className="sr-only">City or ZIP</label>
          <input
            id="hero-q" name="q" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Try a ZIP — e.g. 77002"
            className="mat h-11 flex-1 px-3 text-[15px]" style={{ color: 'var(--text)' }}
          />
          <button type="submit" className="h-11 rounded-[6px] px-4 text-[14px] font-semibold" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>
            Show me
          </button>
        </form>

        <div className="mt-10">
          {loading ? (
            <div className="mat max-w-3xl overflow-hidden p-0 animate-pulse" aria-hidden>
              {/* Skeleton mirrors the revealed card box exactly (same mat/grid/aspect)
                  so the reveal causes zero layout shift (Lighthouse CLS). */}
              <div className="grid sm:grid-cols-[1.2fr_1fr]">
                <div className="relative aspect-[4/3]" style={{ background: 'var(--ink-2)' }} />
                <div className="flex flex-col justify-center gap-2 p-6">
                  <div className="h-4 w-1/3 rounded" style={{ background: 'var(--ink-2)' }} />
                  <div className="h-10 w-2/3 rounded" style={{ background: 'var(--ink-2)' }} />
                  <div className="h-4 w-1/2 rounded" style={{ background: 'var(--ink-2)' }} />
                  <div className="mt-3 h-10 w-40 rounded-[6px]" style={{ background: 'var(--ink-2)' }} />
                </div>
              </div>
            </div>
          ) : deal ? (
            <article className="mat max-w-3xl overflow-hidden p-0 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <div className="grid sm:grid-cols-[1.2fr_1fr]">
                <div className="relative aspect-[4/3]">
                  {/* unoptimized: primary_photo is a free-form scraper URL (COALESCE of
                      primary_photo / images->>0) that can come from any host; the tight
                      next.config remotePatterns allowlist would 400 on unlisted hosts.
                      One hero image, so we skip the optimizer rather than widen the
                      security-sensitive allowlist. */}
                  {deal.primary_photo && (
                    <Image src={deal.primary_photo} alt={deal.address} fill className="object-cover" sizes="(max-width:640px) 100vw, 400px" unoptimized />
                  )}
                </div>
                <div className="flex flex-col justify-center gap-2 p-6">
                  <p className="prov">Clears the line</p>
                  <div className="text-4xl"><CountUpRatio value={deal.ratio} /></div>
                  <p className="text-[15px]" style={{ color: 'var(--text)' }}>{deal.address}</p>
                  <p className="text-[13px]" style={{ color: 'var(--mute)' }}>
                    {usd0.format(deal.listing_price)} · est. rent {usd0.format(deal.estimated_rent)}/mo
                  </p>
                  <Link href={`/search?q=${deal.zip || metroZip}`}
                    className="mt-3 inline-flex h-10 items-center justify-center rounded-[6px] px-4 text-[14px] font-semibold"
                    style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
                    See more like this →
                  </Link>
                </div>
              </div>
            </article>
          ) : (
            <p className="prov">No live deal for that area yet — <Link href="/search" className="underline">browse all markets</Link>.</p>
          )}
        </div>
      </div>
    </section>
  );
}
