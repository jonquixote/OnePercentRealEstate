import { MetadataRoute } from 'next';
import { INDEX_METROS } from '@/lib/index-metros';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
const PAGE_SIZE = 45000;

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

async function query<T = Record<string, unknown>>(
    sql: string,
    label: string,
): Promise<T[]> {
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

export async function generateSitemaps(): Promise<{ id: string }[]> {
    const rows = await query<{ count: string }>(
        `SELECT count(*) AS count FROM listings
         WHERE listing_status NOT IN ('sold','stale','rental_misfiled')
           AND listing_type = 'for_sale'`,
        'property count',
    );
    const count = parseInt(rows[0]?.count ?? '0', 10);
    const shards = Math.max(1, Math.ceil(count / PAGE_SIZE));

    return [
        { id: 'markets' },
        { id: 'sold' },
        { id: 'index' },
        ...Array.from({ length: shards }, (_, i) => ({ id: `property-${i}` })),
    ];
}

// Next passes the sitemap `id` as the numeric position from generateSitemaps
// (0-based), NOT the `id` string we returned. Normalize both forms to a stable
// string key: 0→markets, 1→sold, 2→index, 3+→property-<shard>. (A raw string
// id, from future Next versions or tests, passes through unchanged.)
function sitemapKey(id: string | number): string {
    if (typeof id === 'number') {
        return ['markets', 'sold', 'index'][id] ?? `property-${id - 3}`;
    }
    return id;
}

export default async function sitemap({
    id,
}: {
    id: string | number;
}): Promise<MetadataRoute.Sitemap> {
    const now = new Date();
    const key = sitemapKey(id);

    if (key === 'markets') {
        const rows = await query<{ zip_code: string | null }>(
            `SELECT DISTINCT zip_code
             FROM listings
             WHERE listing_status NOT IN ('sold','stale','rental_misfiled')
               AND listing_type = 'for_sale'
               AND zip_code ~ '^\\d{5}$'`,
            'markets',
        );
        const zips = rows
            .map((r) => r.zip_code)
            .filter((z): z is string => !!z && /^\d{5}$/.test(z));

        const coreRoutes: MetadataRoute.Sitemap = CORE_ROUTES.map((route) => ({
            url: `${BASE_URL}${route}`,
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: 1,
        }));

        const marketRoutes: MetadataRoute.Sitemap = zips.map((zip) => ({
            url: `${BASE_URL}/market/${zip}`,
            lastModified: now,
            changeFrequency: 'weekly' as const,
            priority: 0.8,
        }));

        return [...coreRoutes, ...marketRoutes];
    }

    if (key === 'sold') {
        const rows = await query<{ id: string }>(
            `SELECT id FROM listings
             WHERE listing_status = 'sold'
             ORDER BY sold_date DESC NULLS LAST
             LIMIT ${PAGE_SIZE}`,
            'sold',
        );
        return rows.map((r) => ({
            url: `${BASE_URL}/sold/${r.id}`,
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: 0.5,
        }));
    }

    if (key === 'index') {
        const routes: MetadataRoute.Sitemap = [
            {
                url: `${BASE_URL}/the-1-percent-index`,
                lastModified: now,
                changeFrequency: 'weekly' as const,
                priority: 1,
            },
            ...INDEX_METROS.map((metro) => ({
                url: `${BASE_URL}/the-1-percent-index/${metro.slug}`,
                lastModified: now,
                changeFrequency: 'weekly' as const,
                priority: 0.9,
            })),
        ];
        return routes;
    }

    if (key.startsWith('property-')) {
        const shard = parseInt(key.split('-')[1], 10);
        const offset = shard * PAGE_SIZE;
        const rows = await query<{ id: string; rent_price_ratio: number | null }>(
            `SELECT id, rent_price_ratio FROM listings
             WHERE listing_status NOT IN ('sold','stale','rental_misfiled')
               AND listing_type = 'for_sale'
             ORDER BY (rent_price_ratio IS NOT NULL) DESC,
                      rent_price_ratio DESC NULLS LAST,
                      last_seen_at DESC
             LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
            'property',
        );
        return rows.map((r) => ({
            url: `${BASE_URL}/property/${r.id}`,
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: r.rent_price_ratio != null && r.rent_price_ratio >= 0.01 ? 0.9 : 0.6,
        }));
    }

    return [];
}
