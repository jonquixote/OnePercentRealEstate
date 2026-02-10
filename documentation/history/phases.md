# Project History & Phases

A summary of the major development milestones for the One Percent Real Estate platform.

## 🏁 Phase 1: Performance & Reliability

**Goal**: Resolve slow page loads and database connectivity issues.

- Optimized database indexes for frequent searches.
- Implemented basic response caching.
- Resolved memory leaks in the Next.js production build.

## ⚡ Phase 2: Growth Infrastructure

**Goal**: Scale the system handles more users and listings.

- **Redis Integration**: Implemented for global caching and rate limiting.
- **Deduplication Engine**: Built logic to prevent duplicate listings during scraping.
- **Deployment Automation**: Created the first set of `expect` scripts for SSH deployments.

## 🗺️ Phase 3: Map Infrastructure (Vector Tiles)

**Goal**: Support 10,000+ markers on the map without lag.

- **MVT Implementation**: Switched from GeoJSON to Mapbox Vector Tiles via `pg_tileserv`.
- **Dynamic Filtering**: Added server-side SQL filtering for map tiles (Price/Beds/Baths).
- **Styled Heatmaps**: Implemented dual-layer map visualization (Heatmap at world view, Circles at street view).

## ⚖️ Hotfix: Data Consistency

**Goal**: Ensure "The numbers always match."

- **Universal Calculator**: Extracted calculation logic into a shared library.
- **Uniform Assumptions**: Standardized default interest rates and operating expense percentages across all views.
