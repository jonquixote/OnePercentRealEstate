# Lessons Learned

A running log of technical hurdles, gotchas, and solutions discovered during the building of One Percent Real Estate.

## 🛠️ Infrastructure & Deployment

### 1. VPS Memory Management

- **Problem**: Next.js production builds were stalling or being killed by the OOM (Out Of Memory) killer on the VPS.
- **Solution**: Create `expect` scripts that proactively stop non-essential resource-heavy services (like `neko` or `ollama`) before starting a build, and restart them afterward.
- **Takeaway**: 4GB-8GB RAM is tight for Next.js builds + Docker services. Build-time memory isolation is critical.

### 2. Image Data from Scrapers

- **Problem**: Property images were missing or inconsistent because scrapers stored them in varied formats (`raw_data->>'primary_photo'`, `alt_photos` as comma-strings or arrays).
- **Solution**: Implemented a unified image mapping logic in `src/app/actions.ts` that cleans and collapses all potential image sources into a single reliable `images[]` array.

## 🗺️ Mapping & GIS

### 1. Vector Tile Advantage

- **Problem**: Loading 5,000+ properties as GeoJSON caused the browser to lag significantly.
- **Solution**: Switched to `pg_tileserv`.
- **Takeaway**: Never send thousands of raw JSON objects to the frontend. Spatial data should always be tiled or clustered server-side.

### 2. SQL Function Signatures for MVT

- **Problem**: `pg_tileserv` wouldn't recognize the MVT function if the parameter names didn't strictly match the expected `z, x, y` or if return types were slightly off.
- **Solution**: The function MUST return `bytea` and should be in a schema accessible by the tile server user.

## 💰 Financial Logic

### 1. Default Consistency

- **Problem**: Users were confused when the Frontpage said "Pos Cashflow" but the Details page said "-$154".
- **Solution**: Use a **Shared Calculator Library**. Even "rough estimates" should use the same underlying constants (Interest Rate, Tax Rate) as the advanced tools.
- **Takeaway**: Financial apps must have a "Single Source of Truth" for math.
