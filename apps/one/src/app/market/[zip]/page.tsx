import pool from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Breadcrumbs from '@/components/Breadcrumbs';

// ISR: market stats move on the scrape cadence, not per-request. force-dynamic
// would silently disable revalidate — do not add it back alongside this.
export const revalidate = 86400;

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-US');
const pct1 = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';

interface ListingRow {
    id: number;
    address: string;
    city: string | null;
    state: string | null;
    price: number | null;
    estimated_rent: number | null;
    rent_price_ratio: number | null;
    primary_photo: string | null;
    sqft: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
}

interface MarketOk {
    kind: 'ok';
    zip: string;
    displayName: string;
    city: string | null;
    state: string | null;
    totalListings: number;
    medianPrice: number | null;
    medianRent: number | null;
    ratio: number | null;
    hpiSeries: Array<{ year: number; hpi: number }>;
    sparkline: string | null;
    walkScore: number | null;
    walkLabel: string | null;
    unemployment: number | null;
    medRentPsf: number | null;
    nRentPsf: number;
    medSoldPsf: number | null;
    nSoldPsf: number;
    acs: {
        median_hh_income: number | null;
        median_home_value: number | null;
        acs_year: number | null;
    } | null;
    nriRating: string | null;
    nriScore: number | null;
    schoolCount: number;
    top: ListingRow[];
    neighbors: string[];
    jsonLd: object;
}

type MarketData = MarketOk | { kind: 'notfound' } | { kind: 'error' };

// Top ~2000 ZIPs by active for_sale listing count → pre-rendered at build.
export async function generateStaticParams(): Promise<{ zip: string }[]> {
    try {
        const { default: p } = await import('@/lib/db');
        const client = await p.connect();
        try {
            const res = await client.query(`
                SELECT zip_code
                FROM listings
                WHERE listing_type = 'for_sale' AND sale_type = 'standard' AND zip_code ~ '^\\d{5}$'
                GROUP BY zip_code
                ORDER BY count(*) DESC
                LIMIT 2000
            `);
            return res.rows
                .map((r: { zip_code: string }) => r.zip_code)
                .filter((z): z is string => typeof z === 'string' && /^\d{5}$/.test(z))
                .map((zip) => ({ zip }));
        } finally {
            client.release();
        }
    } catch (error) {
        console.warn('[market] generateStaticParams failed, falling back to on-demand:', error);
        return [];
    }
}

export async function generateMetadata({ params }: { params: Promise<{ zip: string }> }): Promise<{
    title: string;
    description: string;
    alternates: { canonical: string };
    openGraph: { title: string; description: string; url: string };
}> {
    const { zip } = await params;
    if (!/^\d{5}$/.test(zip)) {
        return {
            title: 'Invalid market',
            description: '',
            alternates: { canonical: `${SITE}/market/${zip}` },
            openGraph: { title: '', description: '', url: `${SITE}/market/${zip}` },
        };
    }
    const place = await lookupPlace(zip);
    const name = place ? `${place.city}, ${place.state}` : zip;
    const title = `Real Estate Market Data for ${zip} (${name}) | OnePercent`;
    const description = `Live investment metrics for ${zip} ${name}: median list price, estimated rent, price-to-rent ratio, FHFA home-price trend, walkability, and the listings that clear the 1% rule.`;
    return {
        title,
        description,
        alternates: { canonical: `${SITE}/market/${zip}` },
        openGraph: { title, description, url: `${SITE}/market/${zip}` },
    };
}

async function lookupPlace(zip: string): Promise<{ city: string | null; state: string | null } | null> {
    try {
        const res = await pool.query(
            `SELECT raw_data->>'city' AS city, raw_data->>'state' AS state FROM listings WHERE zip_code = $1 LIMIT 1`,
            [zip],
        );
        const row = res.rows[0];
        if (!row) return null;
        return { city: row.city || null, state: row.state || null };
    } catch {
        return null;
    }
}

async function loadMarketData(zip: string): Promise<MarketData> {
    try {
        const [
            aggRes,
            hpiRes,
            rentPsfRes,
            acsRes,
            blsRes,
            walkRes,
            nriRes,
            schoolsRes,
            topRes,
            rankedRes,
            placeRes,
        ] = await Promise.all([
            pool.query(
                `SELECT
                    count(*)::int AS total_listings,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::numeric(12,2) AS median_price,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)
                        FILTER (WHERE estimated_rent > 0)::numeric(10,2) AS median_rent,
                    count(*) FILTER (WHERE price > 0 AND estimated_rent > 0)::int AS rentable_count
                 FROM listings
                 WHERE zip_code = $1 AND listing_type = 'for_sale' AND sale_type = 'standard' AND price > 10000`,
                [zip],
            ),
            pool.query(
                `SELECT year, hpi, annual_change_pct FROM fhfa_zip_hpi WHERE zip5 = $1 ORDER BY year`,
                [zip],
            ),
            pool.query(
                `SELECT
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent / NULLIF(sqft, 0))::numeric(8,2) AS med_rent_psf,
                    count(*) FILTER (WHERE sqft > 0 AND estimated_rent > 0)::int AS n_rent_psf,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY price / NULLIF(sqft, 0))::numeric(8,2) AS med_sold_psf,
                    count(*) FILTER (WHERE sqft > 0 AND price > 0)::int AS n_sold_psf
                 FROM listings
                 WHERE zip_code = $1 AND listing_type = 'for_sale' AND sale_type = 'standard'`,
                [zip],
            ),
            pool.query(
                `SELECT median_hh_income, median_gross_rent, median_home_value, population, vacant_units, total_units, acs_year
                 FROM zcta_demographics WHERE zcta = $1 ORDER BY acs_year DESC LIMIT 1`,
                [zip],
            ),
            pool.query(
                `SELECT unemployment_rate
                 FROM bls_county_laus
                 WHERE fips = (SELECT fips_code FROM listings WHERE zip_code = $1 AND fips_code IS NOT NULL LIMIT 1)
                 ORDER BY period DESC LIMIT 1`,
                [zip],
            ),
            pool.query(
                `SELECT avg(t.natwalkind)::numeric(6,2) AS walk_score
                 FROM listings l
                 JOIN tract_walkability t ON t.geoid = l.census_tract
                 WHERE l.zip_code = $1 AND l.census_tract IS NOT NULL`,
                [zip],
            ),
            pool.query(
                `SELECT t.nri_overall_rating, t.nri_overall_score
                 FROM listings l
                 JOIN census_tracts t ON t.geoid = l.census_tract
                 WHERE l.zip_code = $1 AND l.census_tract IS NOT NULL AND t.nri_overall_score IS NOT NULL
                 ORDER BY t.nri_overall_score DESC LIMIT 1`,
                [zip],
            ),
            pool.query(
                `SELECT count(*)::int AS school_count
                 FROM schools s
                 WHERE ST_DWithin(
                    s.geom,
                    (SELECT ST_SetSRID(ST_MakePoint(avg(longitude), avg(latitude)), 4326)
                     FROM listings WHERE zip_code = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL),
                    0.04
                 )`,
                [zip],
            ),
            pool.query(
                `SELECT id, address, city, state, price, estimated_rent, rent_price_ratio, primary_photo, sqft, bedrooms, bathrooms
                 FROM listings
                 WHERE zip_code = $1 AND listing_type = 'for_sale' AND sale_type = 'standard'
                   AND price > 0 AND estimated_rent > 0
                 ORDER BY rent_price_ratio DESC NULLS LAST
                 LIMIT 6`,
                [zip],
            ),
            pool.query(
                `SELECT zip_code FROM (
                    SELECT zip_code, count(*) AS c
                    FROM listings
                    WHERE listing_type = 'for_sale' AND sale_type = 'standard' AND zip_code ~ '^\\d{5}$'
                    GROUP BY zip_code
                ) t ORDER BY c DESC LIMIT 600`,
            ),
            pool.query(
                `SELECT raw_data->>'city' AS city, raw_data->>'state' AS state FROM listings WHERE zip_code = $1 LIMIT 1`,
                [zip],
            ),
        ]);

        const agg = aggRes.rows[0] || { total_listings: 0, median_price: null, median_rent: null, rentable_count: 0 };
        const hpiRows = hpiRes.rows as Array<{ year: number; hpi: number | null; annual_change_pct: number | null }>;
        const rentPsf = rentPsfRes.rows[0] || { med_rent_psf: null, n_rent_psf: 0, med_sold_psf: null, n_sold_psf: 0 };
        const acs = acsRes.rows[0] || null;
        const bls = blsRes.rows[0] || null;
        const walk = walkRes.rows[0] || null;
        const nri = nriRes.rows[0] || null;
        const schools = schoolsRes.rows[0] || { school_count: 0 };
        const top = topRes.rows as ListingRow[];
        const ranked = (rankedRes.rows as Array<{ zip_code: string }>).map((r) => r.zip_code);
        const placeRow = placeRes.rows[0] || null;

        const totalListings = Number(agg.total_listings) || 0;
        const medianPrice = agg.median_price != null ? Number(agg.median_price) : null;
        const medianRent = agg.median_rent != null ? Number(agg.median_rent) : null;
        const ratio = medianPrice && medianRent ? medianRent / medianPrice : null;

        // No data at all → 404 rather than render garbage.
        if (!totalListings && !hpiRows.length && !acs) return { kind: 'notfound' };

        const placeName = placeRow
            ? `${placeRow.city || ''}${placeRow.city && placeRow.state ? ', ' : ''}${placeRow.state || ''}`
            : zip;
        const displayName = placeName ? `${placeName} · ${zip}` : zip;

        // Adjacent ZIPs by listing-count rank (graceful when absent).
        const idx = ranked.indexOf(zip);
        const neighbors: string[] = [];
        if (idx >= 0) {
            for (let i = idx - 2; i <= idx + 2; i++) {
                if (i !== idx && i >= 0 && i < ranked.length) neighbors.push(ranked[i]);
            }
        }

        // ── FHFA HPI sparkline (inline SVG, last 10 years available) ──────
        const hpiSeries = hpiRows.filter((r) => r.hpi != null).slice(-10);
        const sparkline = buildSparkline(hpiSeries.map((r) => Number(r.hpi)));

        const walkScore = walk?.walk_score != null ? Number(walk.walk_score) : null;
        const walkLabel = walkScore == null ? null
            : walkScore >= 12 ? 'very walkable'
            : walkScore >= 8 ? 'walkable'
            : walkScore >= 4 ? 'somewhat walkable'
            : 'car-dependent';

        const jsonLd = {
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'Place',
                    name: `${zip} ${placeRow?.city || ''} ${placeRow?.state || ''}`.trim(),
                    address: {
                        '@type': 'PostalAddress',
                        postalCode: zip,
                        addressRegion: placeRow?.state || undefined,
                        addressLocality: placeRow?.city || undefined,
                        addressCountry: 'US',
                    },
                },
                {
                    '@type': 'Dataset',
                    name: `OnePercent market dataset for ${zip}`,
                    description: `Investment metrics for ${zip}: median list price ${medianPrice ? usd0.format(medianPrice) : 'n/a'}, median estimated rent ${medianRent ? usd0.format(medianRent) : 'n/a'}, ${totalListings} active for-sale listings.`,
                    url: `${SITE}/market/${zip}`,
                    spatialCoverage: zip,
                    includedInDataCatalog: { '@type': 'DataCatalog', name: 'OnePercent' },
                },
                {
                    '@type': 'BreadcrumbList',
                    itemListElement: [
                        { '@type': 'ListItem', position: 1, name: 'Markets', item: `${SITE}/market` },
                        { '@type': 'ListItem', position: 2, name: zip, item: `${SITE}/market/${zip}` },
                    ],
                },
            ],
        };

        return {
            kind: 'ok',
            zip,
            displayName,
            city: placeRow?.city ?? null,
            state: placeRow?.state ?? null,
            totalListings,
            medianPrice,
            medianRent,
            ratio,
            hpiSeries: hpiSeries as Array<{ year: number; hpi: number }>,
            sparkline,
            walkScore,
            walkLabel,
            unemployment: bls?.unemployment_rate != null ? Number(bls.unemployment_rate) : null,
            medRentPsf: rentPsf.med_rent_psf != null ? Number(rentPsf.med_rent_psf) : null,
            nRentPsf: Number(rentPsf.n_rent_psf) || 0,
            medSoldPsf: rentPsf.med_sold_psf != null ? Number(rentPsf.med_sold_psf) : null,
            nSoldPsf: Number(rentPsf.n_sold_psf) || 0,
            acs: acs
                ? {
                    median_hh_income: acs.median_hh_income != null ? Number(acs.median_hh_income) : null,
                    median_home_value: acs.median_home_value != null ? Number(acs.median_home_value) : null,
                    acs_year: acs.acs_year != null ? Number(acs.acs_year) : null,
                }
                : null,
            nriRating: nri?.nri_overall_rating ?? null,
            nriScore: nri?.nri_overall_score != null ? Number(nri.nri_overall_score) : null,
            schoolCount: Number(schools.school_count) || 0,
            top,
            neighbors,
            jsonLd,
        };
    } catch (error) {
        // notFound() (and redirects) signal by throwing — pass them through
        // to Next instead of rendering the DB-failure fallback.
        if (typeof (error as { digest?: string })?.digest === 'string'
            && (error as { digest: string }).digest.startsWith('NEXT_')) {
            throw error;
        }
        console.error('[market] Database error:', error);
        return { kind: 'error' };
    }
}

export default async function MarketPage({ params }: { params: Promise<{ zip: string }> }) {
    const { zip } = await params;

    // Validate the param before touching the DB.
    if (!/^\d{5}$/.test(zip)) notFound();

    const data = await loadMarketData(zip);
    if (data.kind === 'notfound') notFound();
    if (data.kind === 'error') {
        return (
            <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
                <div className="mx-auto max-w-5xl px-6 py-20 text-center">
                    <h1 style={{ font: '400 var(--display-1)/1.05 var(--font-display)' }}>Market data unavailable</h1>
                    <p className="mt-4" style={{ color: 'var(--haze)' }}>Could not load data for {zip}.</p>
                    <Link href="/market" className="mt-6 inline-block rounded-full px-6 py-2.5 text-sm font-semibold transition-colors" style={{ background: 'var(--pass)', color: '#fff' }}>
                        Browse markets
                    </Link>
                </div>
            </div>
        );
    }

    const {
        displayName, totalListings, medianPrice, medianRent, ratio, hpiSeries, sparkline,
        walkScore, walkLabel, unemployment, medRentPsf, nRentPsf, medSoldPsf, nSoldPsf,
        acs, nriRating, nriScore, schoolCount, top, neighbors, jsonLd,
    } = data;

    return (
        <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <div className="mx-auto max-w-5xl px-6 py-14">
                <Breadcrumbs items={[
                    { label: 'Home', href: '/' },
                    { label: 'Markets', href: '/market' },
                    { label: displayName },
                ]} />

                <header className="pb-10" style={{ borderBottom: '1px solid var(--line)' }}>
                    <p className="prov mb-4 inline-block">market report · {zip}</p>
                    <h1 style={{ font: '400 var(--display-1)/1.05 var(--font-display)' }}>{displayName}</h1>
                    <div className="mt-6 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
                        <span><b className="figure" style={{ color: 'var(--text)' }}>{num.format(totalListings)}</b> active listings</span>
                        {medianPrice && <span><b className="figure" style={{ color: 'var(--text)' }}>{usd0.format(medianPrice)}</b> median ask</span>}
                        {medianRent && <span><b className="figure" style={{ color: 'var(--text)' }}>{usd0.format(medianRent)}</b> est. rent</span>}
                        {ratio && <span><b className="figure" style={{ color: 'var(--pass-hi)' }}>{pct1.format(ratio)}</b> price/rent</span>}
                    </div>
                </header>

                {/* ── Hero stats grid ─────────────────────────────────── */}
                <section className="grid grid-cols-2 gap-y-8 py-14 md:grid-cols-4" style={{ borderBottom: '1px solid var(--line)' }}>
                    {[
                        ['Median list price', medianPrice ? usd0.format(medianPrice) : '—'],
                        ['Estimated rent', medianRent ? `${usd0.format(medianRent)}/mo` : '—'],
                        ['Price / rent ratio', ratio ? pct1.format(ratio) : '—'],
                        ['Listings', num.format(totalListings)],
                    ].map(([k, v]) => (
                        <div key={k as string}>
                            <p className="figure text-[24px]">{v}</p>
                            <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>{k}</p>
                        </div>
                    ))}
                </section>

                {/* ── FHFA HPI sparkline ─────────────────────────────── */}
                {sparkline && (
                    <section className="py-14" style={{ borderBottom: '1px solid var(--line)' }}>
                        <h2 className="prov mb-6 inline-block">FHFA home price index · {hpiSeries[0]?.year}–{hpiSeries[hpiSeries.length - 1]?.year}</h2>
                        <div className="flex flex-wrap items-center gap-8">
                            <svg width="260" height="64" viewBox="0 0 260 64" role="img" aria-label="FHFA home price index trend">
                                <polyline fill="none" stroke="var(--pass)" strokeWidth="2" points={sparkline} />
                            </svg>
                            {hpiSeries.length > 1 && (() => {
                                const first = Number(hpiSeries[0].hpi);
                                const last = Number(hpiSeries[hpiSeries.length - 1].hpi);
                                const chg = first ? (last - first) / first : 0;
                                return (
                                    <p className="text-[13px]" style={{ color: 'var(--haze)' }}>
                                        <span className="figure" style={{ color: 'var(--pass-hi)' }}>{pct1.format(chg)}</span> cumulative change over the window.
                                        Source: FHFA ZIP-level HPI.
                                    </p>
                                );
                            })()}
                        </div>
                    </section>
                )}

                {/* ── Rent $/sqft + context strip ────────────────────── */}
                <section className="grid grid-cols-2 gap-y-8 py-14 md:grid-cols-4" style={{ borderBottom: '1px solid var(--line)' }}>
                    {[
                        [
                            'Median rent / sqft',
                            medRentPsf ? usd2.format(medRentPsf) : '—',
                            nRentPsf ? `${num.format(nRentPsf)} comps` : undefined,
                        ],
                        [
                            'Median sold / sqft',
                            medSoldPsf ? usd2.format(medSoldPsf) : '—',
                            nSoldPsf ? `${num.format(nSoldPsf)} comps` : undefined,
                        ],
                        [
                            'Walkability',
                            walkScore != null ? walkScore.toFixed(1) : '—',
                            walkLabel || undefined,
                        ],
                        [
                            'Area unemployment',
                            unemployment != null ? `${unemployment.toFixed(1)}%` : '—',
                            'BLS LAUS',
                        ],
                    ].map(([k, v, sub]) => (
                        <div key={k as string}>
                            <p className="figure text-[24px]">{v}</p>
                            <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>{k}</p>
                            {sub && <p className="text-[11px]" style={{ color: 'var(--mute)' }}>{sub}</p>}
                        </div>
                    ))}
                </section>

                {/* ── Income / risk context lines ────────────────────── */}
                {(acs || nriRating || schoolCount > 0) && (
                    <section className="space-y-2 py-14 text-[13px]" style={{ borderBottom: '1px solid var(--line)', color: 'var(--haze)' }}>
                        {acs?.median_hh_income && (
                            <p>Median household income <span className="figure" style={{ color: 'var(--text)' }}>{usd0.format(acs.median_hh_income)}</span> · median home value <span className="figure" style={{ color: 'var(--text)' }}>{acs.median_home_value ? usd0.format(acs.median_home_value) : '—'}</span> · ACS {acs.acs_year || '2024'}.</p>
                        )}
                        {nriRating && (
                            <p>Natural-hazard risk <span className="figure" style={{ color: 'var(--text)' }}>{nriRating}</span> (FEMA NRI score {nriScore != null ? nriScore.toFixed(0) : '—'}).</p>
                        )}
                        {schoolCount > 0 && (
                            <p><span className="figure" style={{ color: 'var(--text)' }}>{num.format(schoolCount)}</span> schools within ~4 km of the ZIP centroid.</p>
                        )}
                    </section>
                )}

                {/* ── Top 6 listings that clear the rule ─────────────── */}
                {top.length > 0 && (
                    <section className="py-14" style={{ borderBottom: '1px solid var(--line)' }}>
                        <h2 className="prov mb-8 inline-block">top deals · highest rent-to-price</h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {top.map((l) => {
                                const r = l.rent_price_ratio != null ? Number(l.rent_price_ratio) : null;
                                return (
                                    <Link
                                        key={l.id}
                                        href={`/property/${l.id}`}
                                        className="group overflow-hidden rounded-[var(--r-panel)] transition-colors hover:bg-ink-2"
                                        style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}
                                    >
                                        <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--ink-2)]">
                                            {l.primary_photo ? (
                                                <Image
                                                    src={l.primary_photo}
                                                    alt={l.address ?? 'Property photo'}
                                                    width={480}
                                                    height={360}
                                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center text-[11px]" style={{ color: 'var(--mute)' }}>no photo</div>
                                            )}
                                        </div>
                                        <div className="p-5">
                                            <p className="truncate text-sm" style={{ color: 'var(--text)' }}>{l.address}</p>
                                            <p className="mb-3 text-[12px]" style={{ color: 'var(--haze)' }}>{l.city || ''}{l.city && l.state ? ', ' : ''}{l.state || ''}</p>
                                            <div className="flex items-baseline justify-between text-[12px]" style={{ color: 'var(--haze)' }}>
                                                <span><span className="figure" style={{ color: 'var(--text)' }}>{l.price ? usd0.format(Number(l.price)) : '—'}</span></span>
                                                <span><span className="figure" style={{ color: 'var(--text)' }}>{l.estimated_rent ? usd0.format(Number(l.estimated_rent)) : '—'}</span>/mo</span>
                                                <span className="figure" style={{ color: r && r >= 0.01 ? 'var(--pass-hi)' : 'var(--brass-hi)' }}>{r ? pct1.format(r) : '—'}</span>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                        <Link href={`/search?q=${zip}`} className="mt-6 inline-block text-[13px]" style={{ color: 'var(--pass-hi)' }}>
                            Browse all {totalListings} listings in {zip} →
                        </Link>
                    </section>
                )}

                {/* ── Adjacent markets ──────────────────────────────── */}
                {neighbors.length > 0 && (
                    <section className="py-14" style={{ borderTop: '1px solid var(--line)' }}>
                        <h2 className="prov mb-8 inline-block">nearby markets by volume</h2>
                        <div className="flex flex-wrap gap-3">
                            {neighbors.map((z) => (
                                <Link
                                    key={z}
                                    href={`/market/${z}`}
                                    className="rounded-full px-4 py-2 text-[13px] transition-colors hover:bg-ink-2"
                                    style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}
                                >
                                    {z}
                                </Link>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

function buildSparkline(values: number[]): string | null {
    if (values.length < 2) return null;
    const w = 260;
    const h = 64;
    const pad = 6;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = (w - pad * 2) / (values.length - 1);
    return values
        .map((v, i) => {
            const x = pad + i * stepX;
            const y = pad + (h - pad * 2) * (1 - (v - min) / span);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
}
