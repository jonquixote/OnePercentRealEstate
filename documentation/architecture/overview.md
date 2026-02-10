# Architecture Overview

The One Percent Real Estate platform is a multi-tier system designed for high-performance data collection and visualization.

## 🏗️ System Components

### 1. Data Ingestion (Scrapers)

- **Scraper Service**: A Python-based FastAPI service that crawls real estate portals.
- **n8n Workflows**: Orchestrates data flow between scrapers and the database, specifically handling rental comps and HUD integrations.

### 2. Backend & Data Layer

- **PostgreSQL/PostGIS**: The source of truth for all listings, featuring spatial indexing for map performance.
- **pg_tileserv**: Direct-to-DB Mapbox Vector Tile (MVT) server for high-speed marker rendering.
- **Next.js Server Actions**: Handles frontend interactions, auth-protected actions, and financial calculations using shared library logic.

### 3. Frontend (Next.js)

- **App Router**: Organizes pages (Property Details, Dashboard, Comparison).
- **React-Map-GL**: Renders the Mapbox interface using the Vector Tile source.
- **Shared UI (shadcn/ui)**: Consistent components across the application.

## 🔄 Data Life Cycle

1. **Discovery**: Scraper identifies a new listing and saves it to PostgreSQL.
2. **Enrichment**: A trigger calls `calculate_smart_rent` to fetch/calculate rental estimates and HUD data.
3. **Synchronization**: Redis caches key metrics for fast retrieval.
4. **Visualization**: The Frontend fetches markers via `pg_tileserv` and property details via Next.js actions.
