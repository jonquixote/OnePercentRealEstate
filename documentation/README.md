# One Percent Real Estate Documentation

Welcome to the central documentation for the One Percent Real Estate investment platform. This documentation encompasses the architecture, infrastructure, and operational procedures for the system.

## 📁 Documentation Structure

### [Architecture](./architecture/)

- **[System Overview](./architecture/overview.md)**: High-level view of how the scraper, database, and frontend interact.

### [Infrastructure](./infrastructure/)

- **[Database & Vector Tiles](./infrastructure/database.md)**: PostgreSQL/PostGIS setup and the `pg_tileserv` implementation for maps.
- **[Caching & Performance](./infrastructure/caching.md)**: Redis integration for rate limiting and API optimization.
- **[Environment Variables](./infrastructure/environment-variables.md)**: Comprehensive guide to `.env` configuration.

### [Features](./features/)

- **[Financial Metrics](./features/financial-metrics.md)**: Details on the 1% Rule and Cashflow calculation engine.
- **[Map Integration](./features/map-integration.md)**: Usage of Mapbox with Vector Tiles for high-performance property visualization.
- **[Scraping Pipeline](./features/scraping-pipeline.md)**: Details on scrapers, n8n workflows, and DB triggers.

### [Operations](./operations/)

- **[Deployment Guide](./operations/deployment.md)**: How to deploy updates to the VPS using automated `expect` scripts.
- **[Database Access](./operations/database-access.md)**: How to connect to and manage the PostgreSQL database.
- **[Troubleshooting Diary](./operations/troubleshooting.md)**: Lessons learned and fixes for common issues.

---

## 🚀 Quick Links

- **Upgrade Plan (Feb 2026)**: [UpgradePlan2-7-26.md](../UpgradePlan2-7-26.md)
- **Live Site**: [One Percent Real Estate](https://onepercentrealestate.com) (Placeholder)
