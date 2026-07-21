import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/account', '/settings', '/shelf', '/welcome', '/admin'],
    }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
