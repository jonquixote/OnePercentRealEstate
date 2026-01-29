import { MetadataRoute } from 'next';
import pool from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const baseUrl = 'https://onepercentrealestate.vercel.app';

    // core routes
    const routes = [
        '',
        '/search',
        '/analytics',
        '/pricing',
    ].map((route) => ({
        url: `${baseUrl}${route}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 1,
    }));

    // programmatically generate routes for every zip code in DB
    let marketRoutes: MetadataRoute.Sitemap = [];

    try {
        const client = await pool.connect();
        const result = await client.query(`
            SELECT DISTINCT raw_data->>'zip_code' as zip_code 
            FROM listings 
            WHERE raw_data->>'zip_code' IS NOT NULL
            LIMIT 500
        `);
        client.release();

        // Extract unique zip codes
        const zips = result.rows
            .filter(row => row.zip_code && /^\d{5}$/.test(row.zip_code))
            .map(row => row.zip_code);

        marketRoutes = zips.map((zip) => ({
            url: `${baseUrl}/market/${zip}`,
            lastModified: new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.8,
        }));
    } catch (error) {
        console.error('Failed to fetch zip codes for sitemap:', error);
    }

    return [...routes, ...marketRoutes];
}
