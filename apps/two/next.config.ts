import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@oper/primitives", "@oper/api-client", "@oper/query-lang"],
  // apps/two does not own the data API. In production both apps sit behind
  // the same nginx host (octavo.press) and `/api/*` proxies to apps/one.
  // For local dev we rewrite /api/* to wherever apps/one is running.
  async rewrites() {
    const apiBase =
      process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
    return [
      { source: "/api/:path*", destination: `${apiBase}/api/:path*` },
    ];
  },
  images: {
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
};

export default nextConfig;
