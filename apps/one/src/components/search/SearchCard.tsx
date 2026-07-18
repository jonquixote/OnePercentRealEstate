'use client';

import Link from 'next/link';
import { rentToPriceMonthly } from '@oper/primitives';
import { Photo } from '@/components/Photo';
import { useCompare } from '@/components/compare/useCompare';
import SaveButton from '@/components/SaveButton';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface SearchCardProps {
  property: {
    id: string;
    address: string;
    listing_price?: number | null;
    estimated_rent?: number | null;
    rent_low?: number | null;
    rent_high?: number | null;
    primary_photo?: string | null;
    property_type?: string | null;
    price_cut_pct?: number | null;
    days_on_market?: number | null;
    is_rentable?: boolean | null;
    target_ratio?: number | null;
    // Lifecycle: `status` mirrors listings.listing_status (aliased in the properties shaper, property.ts), and now also in /api/properties/query.
    // Only reachable as 'sold' when the caller opted into sold inventory.
    status?: string | null;
    sold_price?: number | null;
    sold_date?: string | null;
  };
  /** Split-view sync: list -> map hover. */
  onHover?: (id: string | null) => void;
  /** Split-view sync: map -> list highlight (accent ring + scroll target). */
  highlighted?: boolean;
}

export function SearchCard({ property, onHover, highlighted }: SearchCardProps) {
  const {
    id, address, listing_price, estimated_rent, rent_low, rent_high,
    primary_photo, property_type, price_cut_pct, days_on_market, is_rentable,
    target_ratio, status, sold_price, sold_date,
  } = property;

  const compare = useCompare();
  const inCompare = compare.has(id);

  // Lifecycle: a sold row (only present when the user opted into sold inventory)
  // gets a SOLD ribbon over the mat and a muted CTA — it's a comp, not a buyable.
  const isSold = status === 'sold';

  const price = listing_price ?? 0;
  const rent = estimated_rent ?? 0;
  const cutPct = price_cut_pct ?? null;
  const dom = days_on_market ?? null;
  const hasRent = rent > 0;
  const lo = rent_low ?? null;
  const hi = rent_high ?? null;

  // Compute ratio from raw data
  const displayRatio = hasRent && price > 0 ? (rentToPriceMonthly(price, rent) ?? 0) * 100 : null;
  const targetPct = target_ratio != null ? target_ratio * 100 : 1.0;

  return (
    <div className="group">
      <Link
        href={`/property/${id}`}
        className="group cursor-pointer"
        data-listing-id={id}
        onMouseEnter={onHover ? () => onHover(id) : undefined}
        onMouseLeave={onHover ? () => onHover(null) : undefined}
      >
        {/* photo mat */}
        <div
          className="mat relative aspect-[4/3] transition-colors group-hover:border-[var(--line-hi)]"
          style={highlighted ? { borderColor: 'var(--pass-hi)', boxShadow: '0 0 0 1px var(--pass-hi)' } : undefined}
        >
          {typeof primary_photo === 'string' && primary_photo.length > 0 ? (
            <div className="h-full w-full overflow-hidden rounded-[6px]">
              <Photo
                src={primary_photo}
                alt={address ?? 'Property photo'}
                width={480}
                height={360}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                // Scraper-sourced URL from arbitrary hosts (images->>0 fallback);
                // the optimizer 400s hosts outside remotePatterns. Same call the
                // FirstDealHero made — skip the optimizer, keep the allowlist tight.
                unoptimized
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
          {/* SOLD ribbon — lifecycle: an off-market comp the user opted to see */}
          {isSold && (
            <div
              className="prov absolute inset-x-0 bottom-0 flex items-center justify-center px-2 py-1.5 text-[11px] uppercase tracking-wider"
              style={{ background: 'rgba(10,10,10,.72)', color: 'var(--paper, #faf7f2)' }}
            >
              Sold{sold_date ? ` ${sold_date}` : ''}
              {sold_price != null && sold_price > 0 ? ` · ${usd0.format(sold_price)}` : ''}
            </div>
          )}
          {/* brass cut overlay */}
          {cutPct != null && cutPct > 0 && (
            <span
              className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{ background: 'var(--brass)', color: 'var(--ink)' }}
            >
              −{(cutPct * 100).toFixed(cutPct >= 0.1 ? 0 : 1)}%
            </span>
          )}
        </div>

        {/* one metric — tri-state */}
        <div className="mt-4 flex items-baseline justify-between">
          {is_rentable === false ? (
            <span className="prov">
              {property_type?.replace(/_/g, ' ')?.toLowerCase() || 'property'} · not rentable
            </span>
          ) : displayRatio != null && hasRent ? (
            <span
              className={`figure text-[22px] ${displayRatio >= targetPct ? 'figure--pass' : ''}`}
              style={displayRatio < targetPct ? { color: 'var(--haze)' } : undefined}
            >
              {displayRatio.toFixed(2)}%
            </span>
          ) : (
            <span className="prov">estimate queued</span>
          )}
          <span className="figure text-[16px]" style={{ color: 'var(--text)' }}>
            {price > 0 ? usd0.format(price) : '—'}
          </span>
        </div>

        {/* confidence band + rent whisper */}
        {hasRent && (() => {
          const loPct = lo != null && rent > 0 ? Math.max(0, (lo / rent) * 100) : 10;
          const hiPct = hi != null && rent > 0 ? Math.min(100, (hi / rent) * 100) : 90;
          const markPct = (loPct + hiPct) / 2;
          return (
            <>
              <div className="band mt-2.5">
                <div className="band-fill" style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }} />
                <div className="band-mark" style={{ left: `${markPct}%` }} />
              </div>
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--mute)' }}>
              rent {usd0.format(rent)}/mo{lo != null && hi != null ? ` · range ${usd0.format(lo)}–${usd0.format(hi)}` : ''}
            </p>
            </>
          );
        })()}

          {/* address + DOM */}
        <p className="mt-2 truncate text-[13px]" style={{ color: 'var(--haze)' }}>
          {address}<span style={{ color: 'var(--mute)' }}>{dom != null ? ` · ${dom} DOM` : ''}</span>
        </p>
      </Link>

      {/* controls — siblings of the Link (valid HTML, not nested buttons) */}
      {/* save button — top-right, stop propagation so card link doesn't fire */}
      <div
        className="absolute right-3 top-12 z-10 transition-opacity opacity-0 group-hover:opacity-100 focus-within:opacity-100 focus-visible:opacity-100"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <SaveButton listingId={id} />
      </div>
      {/* compare toggle — visible on hover, focus, or when selected; muted for sold comps */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          compare.toggle(id);
        }}
        className={`absolute right-3 top-3 z-10 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur transition-opacity ${isSold ? 'opacity-40 group-hover:opacity-70' : inCompare ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 focus-visible:opacity-100'}`}
        style={
          inCompare
            ? { background: 'var(--pass)', borderColor: 'var(--pass)', color: 'var(--ink)' }
            : { background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)', color: 'var(--text)' }
        }
        aria-pressed={inCompare}
        aria-label={inCompare ? 'Remove from comparison' : 'Add to comparison'}
      >
        {inCompare ? '✓ Comparing' : '+ Compare'}
      </button>
    </div>
  );
}
