import { MetadataRoute } from 'next';
import { INDEX_METROS } from '@/lib/index-metros';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';

// Sitemaps cap at 50,000 URLs / 50MB. We ship a single sitemap (no
// `generateSitemaps` — Next 16's dynamic `[__metadata_id__]` index resolver
// throws `r.startsWith is not a function` at runtime) covering the highest-value
// surfaces: core routes, the 1% index, every market ZIP, and the top deals by
// ratio. Sold/long-tail property pagination is deferred until a stable index API.
const PROPERTY_LIMIT = 25000;

async function query<T = Record<string, unknown>>(sql: string, label: string): Promise<T[]> {
    try {
        const { default: pool } = await import('@/lib/db');
        const client = await pool.connect();
        try {
            const result = await client.query(sql);
            return result.rows as T[];
        } finally {
            client.release();
        }
    } catch (error) {
        console.warn(`[sitemap] ${label} query failed:`, error);
        return [];
    }
}

const CORE_ROUTES = [
    '',
    '/search',
    '/market',
    '/shelf',
    '/playbook',
    '/playbook/calculator',
    '/playbook/comps',
    '/playbook/buy-hold',
    '/playbook/brrrr',
    '/playbook/flip',
    '/playbook/str',
    '/pricing',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const now = new Date();

    const core: MetadataRoute.Sitemap = CORE_ROUTES.map((route) => ({
        url: `${BASE_URL}${route}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 1,
    }));

    const indexRoutes: MetadataRoute.Sitemap = [
        { url: `${BASE_URL}/the-1-percent-index`, lastModified: now, changeFrequency: 'weekly' as const, priority: 1 },
        ...INDEX_METROS.map((metro) => ({
            url: `${BASE_URL}/the-1-percent-index/${metro.slug}`,
            lastModified: now,
            changeFrequency: 'weekly' as const,
            priority: 0.9,
        })),
    ];

    const zipRows = await query<{ zip_code: string | null }>(
        `SELECT DISTINCT zip_code
         FROM listings
         WHERE listing_status NOT IN ('sold','stale','rental_misfiled')
           AND listing_type = 'for_sale'
           AND zip_code ~ '^\\d{5}$'`,
        'markets',
    );
    const marketRoutes: MetadataRoute.Sitemap = zipRows
        .map((r) => r.zip_code)
        .filter((z): z is string => !!z && /^\d{5}$/.test(z))
        .map((zip) => ({
            url: `${BASE_URL}/market/${zip}`,
            lastModified: now,
            changeFrequency: 'weekly' as const,
            priority: 0.8,
        }));

    const propRows = await query<{ id: string; rent_price_ratio: number | null }>(
        `SELECT id, rent_price_ratio FROM listings
         WHERE listing_status NOT IN ('sold','stale','rental_misfiled')
           AND listing_type = 'for_sale'
         ORDER BY (rent_price_ratio IS NOT NULL) DESC,
                  rent_price_ratio DESC NULLS LAST,
                  last_seen_at DESC
         LIMIT ${PROPERTY_LIMIT}`,
        'property',
    );
    const propertyRoutes: MetadataRoute.Sitemap = propRows.map((r) => ({
        url: `${BASE_URL}/property/${r.id}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: r.rent_price_ratio != null && r.rent_price_ratio >= 0.01 ? 0.9 : 0.6,
    }));

    return [...core, ...indexRoutes, ...marketRoutes, ...propertyRoutes];
}
