// No 'use client' — this renders on the server for the first frame AND inside
// the client rotator for later frames, so the markup is identical and swapping
// one for the other causes no layout shift.
import Link from 'next/link';
import Image from 'next/image';
import type { TourEntry } from '@/lib/spotlight';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  entry: TourEntry;
  /** True only for the server-rendered first frame — it is the LCP candidate. */
  priority?: boolean;
  /** Client frames crossfade in; the server frame must not. */
  animate?: boolean;
}

export function SpotlightCard({ entry, priority = false, animate = false }: Props) {
  const { deal, metro } = entry;
  return (
    <article
      className={`mat overflow-hidden p-0 ${animate ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500' : ''}`}
      aria-label={`Best deal in ${metro.label}: ${deal.address}`}
    >
      <div className="relative aspect-[16/10]">
        {deal.primary_photo ? (
          <Image
            src={deal.primary_photo}
            alt={deal.address}
            fill
            priority={priority}
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 480px"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0" style={{ background: 'var(--ink-2)' }} />
        )}
        {/* The ratio floats over the photo: the number is the brand, and this
            keeps the card compact enough to share the fold with the headline. */}
        <div
          className="absolute left-4 top-4 rounded-[6px] px-3 py-1.5 backdrop-blur"
          style={{ background: 'color-mix(in srgb, var(--ink) 78%, transparent)' }}
        >
          <span className="prov" style={{ color: 'var(--pass-hi)' }}>Clears the line</span>
          <div className="figure figure--pass text-2xl leading-tight tabular-nums">{pct.format(deal.ratio)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium" style={{ color: 'var(--text)' }}>{deal.address}</p>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--mute)' }}>
            {usd0.format(deal.listing_price)} · est. rent {usd0.format(deal.estimated_rent)}/mo
          </p>
        </div>
        {/* Links to the property, not a filtered search: the claim is that we
            underwrote THIS property, so the click should land on that analysis. */}
        <Link
          href={`/property/${deal.id}`}
          className="inline-flex h-9 shrink-0 items-center rounded-[6px] px-3.5 text-[13px] font-semibold"
          style={{ background: 'var(--brass)', color: 'var(--ink)' }}
        >
          See the math →
        </Link>
      </div>
    </article>
  );
}
