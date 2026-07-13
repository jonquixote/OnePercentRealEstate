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
  async redirects() {
    return [
      // IA rename: Portfolio → Shelf (per plans/redesign/IA.md §1).
      { source: "/portfolio", destination: "/shelf", permanent: true },
      // N2 consolidation (plans/redesign/IA.md §1): tool pages fold into
      // Markets / Playbook; old URLs 301 so no links orphans.
      { source: "/analytics", destination: "/market", permanent: true },
      { source: "/calculator", destination: "/playbook/calculator", permanent: true },
      { source: "/comps", destination: "/playbook/comps", permanent: true },
      { source: "/strategy/:slug", destination: "/playbook/:slug", permanent: true },
    ];
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
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.stripe.com; worker-src 'self' blob:;",
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
