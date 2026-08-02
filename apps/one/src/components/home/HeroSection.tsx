// Server component — no 'use client'. The entire above-the-fold ships as HTML;
// the only client islands are GlobalSearch and SpotlightRotator.
//
// This merges what used to be two competing first impressions: HomeHero
// (headline + ticker + search) and FirstDealHero (a rotating spotlight with its
// OWN zip box), the latter sitting second-to-last on the page, below the whole
// tool. The strongest proof asset — a real, local, line-clearing deal — was
// under the fold. Now: claim on the left, live proof on the right.
import { headers } from 'next/headers';
import Link from 'next/link';
import GlobalSearch from '@/components/GlobalSearch';
import { getSpotlightTour } from '@/lib/spotlight';
import { metroFromHeaders } from '@/lib/geo';
import { SpotlightCard } from './SpotlightCard';
import { SpotlightRotator } from './SpotlightRotator';

const num = new Intl.NumberFormat('en-US');
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export interface HeroStats {
  total: number;
  onePercentPasses: number;
  /** ISO timestamp of the nightly rescore — already present on StatsPayload. */
  lastUpdated?: string;
}

interface Props {
  stats: HeroStats | null;
  priceCuts?: number;
  medianRent?: number | null;
}

export async function HeroSection({ stats, priceCuts, medianRent }: Props) {
  // headers() is async in Next 16. Geo comes from nginx-injected x-geo-*
  // headers, which nginx overwrites — never client-supplied, so it cannot be
  // spoofed to fake a metro.
  const geo = metroFromHeaders(await headers());
  const { entries, startIndex } = await getSpotlightTour(geo);
  const idx = startIndex >= 0 ? startIndex : 0;
  const first = entries[idx] ?? null;

  return (
    <section aria-labelledby="hero-headline" className="relative isolate overflow-hidden bg-ink">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8 lg:py-14">
        <p className="prov mb-4 inline-block">
          {stats ? num.format(stats.total) : '—'} listings · rescored nightly
          {stats?.lastUpdated && (
            <>
              {' '}· last run{' '}
              {new Date(stats.lastUpdated).toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit',
                timeZone: 'America/Los_Angeles', timeZoneName: 'short',
              })}
            </>
          )}
        </p>

        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
          {/* ── Left: claim → line → proof → action ── */}
          <div>
            <h1
              id="hero-headline"
              className="text-balance"
              style={{ font: '300 var(--display-1)/1.04 var(--font-display)' }}
            >
              Every property in America,<br />
              <em style={{ fontStyle: 'italic', color: 'var(--pass-hi)' }}>
                measured against the line.
              </em>
            </h1>

            <div className="rule-line mt-8" />

            <div className="mt-4 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
              <span>
                <b className="figure" style={{ color: 'var(--text)' }}>
                  {stats ? num.format(stats.onePercentPasses) : '—'}
                </b>{' '}clear the 1% line
              </span>
              <span>
                <b className="figure" style={{ color: 'var(--brass-hi)' }}>
                  {priceCuts != null ? num.format(priceCuts) : '—'}
                </b>{' '}price cuts live
              </span>
              <span>
                <b className="figure" style={{ color: 'var(--text)' }}>
                  {medianRent != null ? usd0.format(medianRent) : '—'}
                </b>{' '}median rent estimate
              </span>
            </div>

            <div className="mt-8">
              <GlobalSearch variant="hero" />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              {/* The CTA localizes for free: the button, the headline-adjacent
                  proof and the card all agree on where "near you" is. */}
              <Link
                href="#opportunities"
                className="inline-flex h-11 items-center rounded-[6px] px-5 text-[14px] font-semibold"
                style={{ background: 'var(--brass)', color: 'var(--ink)' }}
              >
                See deals {first ? `in ${first.metro.label}` : 'near you'} →
              </Link>
              <Link href="/the-1-percent-index" className="text-[13px]" style={{ color: 'var(--haze)' }}>
                How the line works
              </Link>
            </div>
          </div>

          {/* ── Right: the proof — a live deal clearing the line ── */}
          <div className="lg:pt-6">
            {first ? (
              <SpotlightRotator entries={entries} startIndex={idx}>
                {/* Server-rendered first frame: real HTML at TTFB, and the LCP
                    candidate, so the photo is priority-loaded. */}
                <SpotlightCard entry={first} priority />
              </SpotlightRotator>
            ) : (
              <div
                className="rounded-2xl border border-dashed p-10 text-center"
                style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}
              >
                <p className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>
                  Tonight&apos;s deals are being scored
                </p>
                <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>
                  The tour resumes when rent estimates complete.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
