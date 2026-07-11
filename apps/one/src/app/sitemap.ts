import { MetadataRoute } from 'next';

// Sitemap is generated at request time so missing DB during `next build`
// (e.g. on Vercel preview deploys) doesn't fail the build. The route
// segment is force-dynamic.
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';

async function fetchZipCodes(): Promise<string[]> {
    try {
        // Lazy-import to avoid pulling pg into the build graph when the
        // env is incomplete.
        const { default: pool } = await import('@/lib/db');
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT zip_code
                FROM listings
                WHERE listing_type = 'for_sale' AND sale_type = 'standard' AND zip_code ~ '^\\d{5}$'
                GROUP BY zip_code
                ORDER BY count(*) DESC
                LIMIT 2000
            `);
            return result.rows
                .map((r: { zip_code: string | null }) => r.zip_code)
                .filter((z): z is string => !!z && /^\d{5}$/.test(z));
        } finally {
            client.release();
        }
    } catch (error) {
        console.warn('[sitemap] zip code query failed, returning core routes only:', error);
        return [];
    }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const coreRoutes = ['', '/search', '/analytics', '/pricing'].map((route) => ({
        url: `${BASE_URL}${route}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 1,
    }));

    const zips = await fetchZipCodes();
    const marketRoutes: MetadataRoute.Sitemap = zips.map((zip) => ({
        url: `${BASE_URL}/market/${zip}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
    }));

    return [...coreRoutes, ...marketRoutes];
}
