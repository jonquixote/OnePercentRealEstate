'use client';

import Link from 'next/link';
import Image from 'next/image';
import { rentToPriceMonthly } from '@oper/primitives';

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
  };
}

export function SearchCard({ property }: SearchCardProps) {
  const {
    id, address, listing_price, estimated_rent, rent_low, rent_high,
    primary_photo, property_type, price_cut_pct, days_on_market, is_rentable,
    target_ratio,
  } = property;

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
    <Link href={`/property/${id}`} className="group cursor-pointer">
      {/* photo mat */}
      <div className="mat relative aspect-[4/3] transition-colors group-hover:border-[var(--line-hi)]">
        {primary_photo ? (
          <div className="h-full w-full overflow-hidden rounded-[6px]">
            <Image
              src={primary_photo}
              alt={address ?? 'Property photo'}
              width={480}
              height={360}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-[6px] bg-[var(--ink-2)] text-[11px] uppercase tracking-wider" style={{ color: 'var(--mute)' }}>
            no photo
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
  );
}
