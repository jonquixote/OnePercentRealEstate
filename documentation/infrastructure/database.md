# Database & Vector Tiles

This project uses a high-performance spatial database to manage thousands of property listings and serve them efficiently to a map interface.

## 🗄️ PostgreSQL + PostGIS

The core data store is PostgreSQL with the **PostGIS** extension enabled for spatial queries.

- **Primary Table**: `listings`
  - Stores scraped property data.
  - Contains a `geom` column (Point, 4326) for spatial indexing.
  - Linked to `market_benchmarks` for HUD estimates.

## 🗺️ Vector Tiles (`pg_tileserv`)

To handle thousands of markers without sluggish performance, we implemented server-side **Mapbox Vector Tiles (MVT)**.

### How it works

1. **Infrastructure**: A `pg_tileserv` container runs on the VPS, connected directly to the database.
2. **SQL Function**: We use a custom function `public.listings_mvt(z, x, y)` to generate tiles on-the-fly.
3. **Filtering**: The MVT function supports dynamic parameters (`min_price`, `max_price`, `min_beds`, `min_baths`) passed via the tile URL.

### Tile URL Format

`http://<SERVER_IP>:7800/public.listings_mvt/{z}/{x}/{y}.pbf?min_price=100000&min_beds=3`

## 🛠️ Key SQL Functions

- `public.listings_mvt`: The engine behind the map view.
- `calculate_smart_rent`: Trigger-based function to refresh rent estimates when data changes.
