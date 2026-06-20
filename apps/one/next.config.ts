import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@oper/primitives", "@oper/query-lang"],
  images: {
    // Explicit allowlist replaces the previous `hostname: "**"` wildcard.
    // Add new origin patterns here as scrapers add new sources; the Wave 7
    // media-health crawler will surface any blocked hosts via 4xx in
    // listings.media_url_status.
    remotePatterns: [
      { protocol: "https", hostname: "*.realtor.com" },
      { protocol: "https", hostname: "*.rdcpix.com" },
      { protocol: "https", hostname: "*.zillowstatic.com" },
      { protocol: "https", hostname: "*.zillow.com" },
      { protocol: "https", hostname: "*.redfin.com" },
      { protocol: "https", hostname: "*.ssl.cdn-redfin.com" },
      { protocol: "https", hostname: "ssl.cdn-redfin.com" },
      { protocol: "https", hostname: "media.octavo.press" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://api.mapbox.com; style-src 'self' 'unsafe-inline' https://api.mapbox.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://api.stripe.com; worker-src 'self' blob:; font-src 'self' https://api.mapbox.com;",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
