'use client';

// Dense table view for search results (D3) — the investor's spreadsheet
// eye. Sortable headers map onto the server sorts the card view already
// uses; no new API surface.
import Link from 'next/link';
import { rentToPriceMonthly } from '@oper/primitives';
import { useCompare } from '@/components/compare/useCompare';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

export interface TableProperty {
  id: string;
  address: string;
  listing_price?: number | null;
  estimated_rent?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  days_on_market?: number | null;
  price_cut_pct?: number | null;
  target_ratio?: number | null;
}

interface ResultsTableProps {
  properties: TableProperty[];
  sortBy: string;
  onSort: (sort: string) => void;
  onHover?: (id: string | null) => void;
  highlightedId?: string | null;
}

// column -> { asc, desc } server sort ids (subset that the server supports).
const SORTS: Record<string, { desc: string; asc?: string }> = {
  price: { desc: 'price_high', asc: 'price_low' },
  ratio: { desc: 'one_percent_high', asc: 'one_percent_low' },
  cut: { desc: 'biggest_cut' },
  dom: { desc: 'stalest' },
};

function SortHeader({ col, label, sortBy, onSort }: { col: keyof typeof SORTS; label: string; sortBy: string; onSort: (s: string) => void }) {
  const s = SORTS[col];
  const isDesc = sortBy === s.desc;
  const isAsc = s.asc != null && sortBy === s.asc;
  const next = isDesc && s.asc ? s.asc : s.desc;
  return (
    <th className="whitespace-nowrap px-3 py-2 text-left">
      <button
        type="button"
        onClick={() => onSort(next)}
        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors"
        style={{ color: isDesc || isAsc ? 'var(--pass-hi)' : 'var(--haze)' }}
      >
        {label}
        <span aria-hidden className="text-[9px]">{isDesc ? '▼' : isAsc ? '▲' : ''}</span>
      </button>
    </th>
  );
}

export function ResultsTable({ properties, sortBy, onSort, onHover, highlightedId }: ResultsTableProps) {
  const compare = useCompare();
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--line)', background: 'var(--ink-panel)' }}>
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--haze)' }}>Address</th>
            <SortHeader col="price" label="Price" sortBy={sortBy} onSort={onSort} />
            <SortHeader col="ratio" label="Rent/Price" sortBy={sortBy} onSort={onSort} />
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--haze)' }}>Est. rent</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--haze)' }}>Bd/Ba</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--haze)' }}>Sqft</th>
            <SortHeader col="cut" label="Cut" sortBy={sortBy} onSort={onSort} />
            <SortHeader col="dom" label="DOM" sortBy={sortBy} onSort={onSort} />
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => {
            const price = p.listing_price ?? 0;
            const rent = p.estimated_rent ?? 0;
            const ratio = price > 0 && rent > 0 ? (rentToPriceMonthly(price, rent) ?? 0) * 100 : null;
            const target = (p.target_ratio ?? 0.01) * 100;
            const inCompare = compare.has(p.id);
            return (
              <tr
                key={p.id}
                data-listing-id={p.id}
                onMouseEnter={onHover ? () => onHover(p.id) : undefined}
                onMouseLeave={onHover ? () => onHover(null) : undefined}
                className="border-b transition-colors last:border-b-0"
                style={{
                  borderColor: 'var(--line)',
                  background: highlightedId === p.id ? 'var(--pass-dim)' : undefined,
                }}
              >
                <td className="max-w-64 truncate px-3 py-2.5">
                  <Link href={`/property/${p.id}`} className="hover:underline" style={{ color: 'var(--text)' }}>
                    {p.address}
                  </Link>
                </td>
                <td className="figure px-3 py-2.5">{price > 0 ? usd0.format(price) : '—'}</td>
                <td className="figure px-3 py-2.5" style={ratio != null && ratio >= target ? { color: 'var(--pass-hi)', fontWeight: 600 } : { color: 'var(--haze)' }}>
                  {ratio != null ? `${ratio.toFixed(2)}%` : '—'}
                </td>
                <td className="figure px-3 py-2.5">{rent > 0 ? usd0.format(rent) : '—'}</td>
                <td className="px-3 py-2.5" style={{ color: 'var(--haze)' }}>{p.bedrooms ?? '—'}/{p.bathrooms ?? '—'}</td>
                <td className="figure px-3 py-2.5">{p.sqft ? num.format(p.sqft) : '—'}</td>
                <td className="px-3 py-2.5" style={{ color: p.price_cut_pct ? 'var(--brass-hi)' : 'var(--mute)' }}>
                  {p.price_cut_pct ? `−${(p.price_cut_pct * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--haze)' }}>{p.days_on_market ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => compare.toggle(p.id)}
                    className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
                    style={
                      inCompare
                        ? { background: 'var(--pass)', borderColor: 'var(--pass)', color: 'var(--ink)' }
                        : { borderColor: 'var(--line)', color: 'var(--haze)' }
                    }
                    aria-pressed={inCompare}
                  >
                    {inCompare ? '✓' : '+'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
