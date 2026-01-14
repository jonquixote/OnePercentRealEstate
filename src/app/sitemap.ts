import { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';

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
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: properties } = await supabase
        .from('properties')
        .select('address');

    // Extract unique zip codes (assuming address format "Street, City, State Zip")
    const zips = new Set<string>();
    if (properties) {
        properties.forEach(p => {
            // crude extraction: last word matches 5 digits
            const match = p.address.match(/\b\d{5}\b/);
            if (match) zips.add(match[0]);
        });
    }

    const marketRoutes = Array.from(zips).map((zip) => ({
        url: `${baseUrl}/market/${zip}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
    }));

    return [...routes, ...marketRoutes];
}
