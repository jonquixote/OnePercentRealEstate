import pool from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 86400;

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-US');

export async function generateMetadata({ params }: { params: Promise<{ zipcode: string }> }) {
    const { zipcode } = await params;
    return {
        title: `Real Estate Investment in ${zipcode} | Market Analysis`,
        description: `Analyze cap rates, rent-to-price ratios, and investment opportunities in ${zipcode}.`,
    };
}

export default async function MarketPage({ params }: { params: Promise<{ zipcode: string }> }) {
    const { zipcode } = await params;

    const client = await pool.connect();
    try {
        // Fetch hud_safmr — all bedroom sizes for this zip
        const hudRes = await client.query(`
            SELECT bedrooms, safmr FROM hud_safmr
            WHERE zip_code = $1 AND fy = (SELECT MAX(fy) FROM hud_safmr WHERE zip_code = $1)
            ORDER BY bedrooms
        `, [zipcode]);
        const hudRows = hudRes.rows;

        // Fetch model median rents per bedroom from listings
        const modelRes = await client.query(`
            SELECT bedrooms,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)::numeric(10,2) AS model_median
            FROM listings
            WHERE raw_data->>'zip_code' = $1
              AND estimated_rent IS NOT NULL AND estimated_rent > 0
              AND listing_type = 'for_sale'
            GROUP BY bedrooms
            ORDER BY bedrooms
        `, [zipcode]);
        const modelRows = modelRes.rows;

        // Fetch ACS ZCTA demographics
        const acsResult = await client.query(`
            SELECT median_hh_income, median_gross_rent, median_home_value, population, vacant_units, total_units
            FROM zcta_demographics
            WHERE zcta = $1
            ORDER BY acs_year DESC
            LIMIT 1
        `, [zipcode]);
        const acs = acsResult.rows[0] || null;

        // Fetch sold listings stats (90 days)
        const soldRes = await client.query(`
            SELECT count(*)::int AS count,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY sold_price / NULLIF(sqft, 0))::numeric(10,2) AS med_ppsf
            FROM sold_listings
            WHERE zip_code = $1 AND sold_date >= now() - interval '90 days'
        `, [zipcode]);
        const soldStats = soldRes.rows[0] || { count: 0, med_ppsf: null };

        // Fetch aggregate counts from listings
        const aggRes = await client.query(`
            SELECT
                count(*)::int AS total_listings,
                count(*) FILTER (WHERE estimated_rent IS NOT NULL AND estimated_rent > 0
                    AND (estimated_rent / NULLIF(price, 0)) >= COALESCE(
                        (SELECT target_ratio FROM resolve_rule(property_type, sale_type, 'buy_hold')), 0.01
                    ))::int AS clearing,
                count(*) FILTER (WHERE price_cut_pct > 0)::int AS cuts,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::numeric(10,2) AS med_price
            FROM listings
            WHERE raw_data->>'zip_code' = $1
              AND listing_type = 'for_sale' AND sale_type = 'standard'
              AND price > 10000
        `, [zipcode]);
        const agg = aggRes.rows[0] || { total_listings: 0, clearing: 0, cuts: 0, med_price: null };

        // Fetch flood risk from census_tracts (worst NRI score in ZIP)
        const floodRes = await client.query(`
            SELECT t.nri_overall_rating, t.nri_overall_score
            FROM listings l
            JOIN census_tracts t ON t.geoid = l.census_tract
            WHERE l.raw_data->>'zip_code' = $1
              AND l.census_tract IS NOT NULL
              AND t.nri_overall_score IS NOT NULL
            ORDER BY t.nri_overall_score DESC
            LIMIT 1
        `, [zipcode]);
        const floodRow = floodRes.rows[0] || null;
        const floodRiskLabel = floodRow?.nri_overall_rating || null;

        // Get place name from first listing city/state
        const placeRes = await client.query(`
            SELECT raw_data->>'city' AS city, raw_data->>'state' AS state
            FROM listings
            WHERE raw_data->>'zip_code' = $1
            LIMIT 1
        `, [zipcode]);
        const placeRow = placeRes.rows[0] || null;
        const placeName = placeRow
            ? `${placeRow.city || ''}${placeRow.city && placeRow.state ? ', ' : ''}${placeRow.state || ''}`
            : zipcode;
        const displayName = placeName ? `${placeName} · ${zipcode}` : zipcode;

        if (!hudRows.length && !agg.total_listings && !acs) {
            return notFound();
        }

        // Build FMR vs Model data
        const bedLabels: Record<number, string> = { 0: 'Studio', 1: '1 BR', 2: '2 BR', 3: '3 BR', 4: '4 BR', 5: '5 BR' };
        const fmrVsModel = hudRows.map((h: any) => {
            const br = Number(h.bedrooms);
            const modelRow = modelRows.find((m: any) => Number(m.bedrooms) === br);
            return {
                br: bedLabels[br] || `${br} BR`,
                fmr: Number(h.safmr),
                model: modelRow ? Number(modelRow.model_median) : null,
            };
        });
        const maxRent = Math.max(1, ...fmrVsModel.map((r: any) => Math.max(r.fmr, r.model ?? 0)));

        // Vacancy rate
        const vacancyPct = acs?.total_units && Number(acs.total_units) > 0
            ? (Number(acs.vacant_units || 0) / Number(acs.total_units)) * 100
            : null;

        return (
            <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
                <div className="mx-auto max-w-5xl px-6 py-14">

                    {/* ── Masthead ──────────────────────────────────────────── */}
                    <header className="pb-10" style={{ borderBottom: '1px solid var(--line)' }}>
                        <p className="prov mb-4 inline-block">market statement · {zipcode}</p>
                        <h1 style={{ font: '400 var(--display-1)/1.05 var(--font-display)' }}>{displayName}</h1>
                        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
                            <span><b className="figure" style={{ color: 'var(--text)' }}>{num.format(agg.total_listings)}</b> active listings</span>
                            <span><b className="figure" style={{ color: 'var(--pass-hi)' }}>{num.format(agg.clearing)}</b> clear the line</span>
                            <span><b className="figure" style={{ color: 'var(--brass-hi)' }}>{num.format(agg.cuts)}</b> price cuts</span>
                            <span><b className="figure" style={{ color: 'var(--text)' }}>{agg.med_price ? usd0.format(Number(agg.med_price)) : '—'}</b> median ask</span>
                        </div>
                    </header>

                    {/* ── Signature chart: model rent vs HUD FMR ───────────── */}
                    {fmrVsModel.length > 0 && (
                        <section className="py-14" style={{ borderBottom: '1px solid var(--line)' }}>
                            <h2 className="prov mb-8 inline-block">modeled rent vs HUD fair market rent</h2>
                            <div className="space-y-6">
                                {fmrVsModel.map((r: any) => (
                                    <div key={r.br} className="grid grid-cols-[64px_1fr] items-center gap-4">
                                        <span className="text-[13px]" style={{ color: 'var(--haze)' }}>{r.br}</span>
                                        <div className="relative h-8">
                                            {/* FMR: hairline reference bar */}
                                            <div className="absolute top-1 h-2 rounded-full"
                                                style={{ width: `${(r.fmr / maxRent) * 100}%`, background: 'var(--line-hi)' }} />
                                            {/* Model: emerald bar (or brass if below FMR) */}
                                            {r.model != null && (
                                                <>
                                                    <div className="absolute bottom-1 h-2 rounded-full"
                                                        style={{
                                                            width: `${(r.model / maxRent) * 100}%`,
                                                            background: r.model >= r.fmr ? 'var(--pass)' : 'var(--brass)',
                                                        }} />
                                                    <span className="figure absolute -bottom-0.5 text-[11px]"
                                                        style={{ left: `calc(${(r.model / maxRent) * 100}% + 8px)`, color: r.model >= r.fmr ? 'var(--pass-hi)' : 'var(--brass-hi)' }}>
                                                        {usd0.format(r.model)}
                                                    </span>
                                                </>
                                            )}
                                            <span className="figure absolute -top-0.5 text-[11px]"
                                                style={{ left: `calc(${(r.fmr / maxRent) * 100}% + 8px)`, color: 'var(--mute)' }}>
                                                FMR {usd0.format(r.fmr)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-6 text-[12px]" style={{ color: 'var(--mute)' }}>
                                Model = OnePercent v1 median for this ZIP. FMR = HUD SAFMR FY2026. Where the model bar
                                is emerald, the market rents above the federal floor.
                            </p>
                        </section>
                    )}

                    {/* ── ACS strip ────────────────────────────────────────── */}
                    {acs && (
                        <section className="grid grid-cols-2 gap-y-8 py-14 md:grid-cols-4" style={{ borderBottom: '1px solid var(--line)' }}>
                            {[
                                ['Median household income', acs.median_hh_income ? usd0.format(Number(acs.median_hh_income)) : '—'],
                                ['Median area rent', acs.median_gross_rent ? `${usd0.format(Number(acs.median_gross_rent))}/mo` : '—'],
                                ['Median home value', acs.median_home_value ? usd0.format(Number(acs.median_home_value)) : '—'],
                                ['Population', acs.population ? num.format(Number(acs.population)) : '—'],
                            ].map(([k, v]) => (
                                <div key={k as string}>
                                    <p className="figure text-[24px]">{v}</p>
                                    <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>{k}</p>
                                </div>
                            ))}
                            <p className="prov col-span-full">
                                american community survey {acs?.acs_year || '2024'} ·{vacancyPct != null ? ` vacancy ${vacancyPct.toFixed(0)}% ·` : ''} flood risk {floodRiskLabel || '—'} (FEMA NRI)
                            </p>
                        </section>
                    )}

                    {/* ── Sold market truth ────────────────────────────────── */}
                    <section className="flex flex-wrap items-baseline gap-x-12 gap-y-4 py-14">
                        <div>
                            <p className="figure text-[24px]">{soldStats.count > 0 ? num.format(soldStats.count) : '—'}</p>
                            <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>closed sales · 90 days</p>
                        </div>
                        <div>
                            <p className="figure text-[24px]">
                                {soldStats.med_ppsf ? `$${Number(soldStats.med_ppsf).toFixed(0)}` : '—'}
                                <span className="text-[14px]">/sqft</span>
                            </p>
                            <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>median sold $/sqft</p>
                        </div>
                        <Link
                            href={`/search?pmin=${Math.max(0, Number(agg.med_price || 0) * 0.5).toFixed(0)}&pmax=${(Number(agg.med_price || 0) * 1.5).toFixed(0)}`}
                            className="ml-auto text-[13px]" style={{ color: 'var(--pass-hi)' }}>
                            Browse the {agg.total_listings} listings in {zipcode} →
                        </Link>
                    </section>

                </div>
            </div>
        );
    } catch (error) {
        console.error('Database error:', error);
        return (
            <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
                <div className="mx-auto max-w-5xl px-6 py-20 text-center">
                    <h1 style={{ font: '400 var(--display-1)/1.05 var(--font-display)' }}>Market data unavailable</h1>
                    <p className="mt-4" style={{ color: 'var(--haze)' }}>Could not load data for {zipcode}.</p>
                    <Link href="/market" className="mt-6 inline-block rounded-full px-6 py-2.5 text-sm font-semibold transition-colors" style={{ background: 'var(--pass)', color: '#fff' }}>
                        Browse markets
                    </Link>
                </div>
            </div>
        );
    } finally {
        client.release();
    }
}
