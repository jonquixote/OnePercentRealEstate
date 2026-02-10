# Map Integration

The map interface is the core discovery tool of the platform. It uses a high-performance rendering stack to display thousands of real-time property markers.

## 🗺️ Tech Stack

- **Library**: `react-map-gl/mapbox`
- **Engine**: Mapbox GL JS
- **Source**: Mapbox Vector Tiles (MVT) via `pg_tileserv`

## 🎨 Visualization Layers

### 1. Global Heatmap

- **Zoom Level**: 0 - 13
- **Purpose**: Provides a macro view of market density and price clusters.
- **Logic**: Uses the `heatmap` layer type in Mapbox, weight-shifted by zoom.

### 2. Individual Markers (Circles)

- **Zoom Level**: 12 - 20
- **Purpose**: Displays individual listings as clickable points.
- **Color Coding**:
  - Blue: Low Price (< $100k)
  - Yellow: Mid Price ($500k)
  - Pink/Red: High Price (> $1M)

## 🔍 Interaction & Filtering

The map is "live-filtered" by the `PropertyFilters` component.

### Dynamic Tile Fetching

When the user changes a filter (e.g., Price Range), the map generates a new Tile URL with query parameters:

```typescript
const tileUrl = `${tileServerUrl}/public.listings_mvt/{z}/{x}/{y}.pbf?min_price=200000`;
```

`pg_tileserv` receives these parameters and applies them to the underlying SQL query before generating the `.pbf` tile.

### Click Behavior

- Clicking a circle retrieves the `property_id` from the tile metadata.
- The UI then navigates to `/property/[id]`.
