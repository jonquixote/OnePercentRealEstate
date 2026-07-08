import pool from '@/lib/db';
import type { Metadata } from 'next';
import { cache } from 'react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

export const dynamic = 'force-dynamic';

// cache() dedupes across generateMetadata + page within one request —
// one pk lookup instead of two.
const getSoldListing = cache(async (id: string) => {
  const result = await pool.query('SELECT * FROM sold_listings WHERE id = $1', [id]);
  return result.rows[0] ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const addr = (await getSoldListing(id))?.address;
    return {
      title: addr ? `${addr} — Sold` : 'Sold Property',
      description: addr ? `Sold property details for ${addr}.` : 'Sold property details.',
    };
  } catch {
    return { title: 'Sold Property', description: 'Sold property details.' };
  }
}

export default async function SoldPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = await getSoldListing(id);
  if (!property) return <div className="flex h-screen items-center justify-center" style={{ background: 'var(--ink)' }}><p className="text-muted-foreground">Sold property not found.</p></div>;

  const price = Number(property.sold_price) || 0;
  const ppsf = property.sqft ? Math.round(price / Number(property.sqft)) : null;

  return (
    <div className="min-h-screen" style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="prov mb-6">sold comp</p>

        <h1 style={{ font: '400 var(--display-2)/1.15 var(--font-display)' }}>
          {property.address || 'Sold Property'}
        </h1>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
            <p className="text-sm" style={{ color: 'var(--haze)' }}>Sold price</p>
            <p className="figure text-2xl">{usd0.format(price)}</p>
          </div>
          {ppsf && (
            <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
              <p className="text-sm" style={{ color: 'var(--haze)' }}>Price per sqft</p>
              <p className="figure text-2xl">${ppsf}/sqft</p>
            </div>
          )}
          {property.sold_date && (
            <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
              <p className="text-sm" style={{ color: 'var(--haze)' }}>Sold date</p>
              <p className="figure text-xl">{String(property.sold_date).slice(0, 10)}</p>
            </div>
          )}
          {property.bedrooms && (
            <div className="rounded-[var(--r-panel)] p-4" style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
              <p className="text-sm" style={{ color: 'var(--haze)' }}>Beds / Baths / Sqft</p>
              <p className="figure text-xl">{property.bedrooms}bd / {property.bathrooms || '?'}ba / {property.sqft ? num.format(property.sqft) : '?'}sqft</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
