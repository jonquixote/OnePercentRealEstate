import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OnePercent — Rental Property Deal Finder",
    short_name: "OnePercent",
    description:
      "Discover 1%-rule rental properties nationwide. Smart rent estimates, market analytics, and deal scoring for real estate investors.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    categories: ["finance", "business", "real_estate"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
