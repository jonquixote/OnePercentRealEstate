# Production-Ready Scalable Real Estate Map Architecture

## Enhanced Implementation Plan with Operational Excellence

**Context:** Currently at 1.2M properties, scraping 1M every 3 days → potential 10M+ within months

**Philosophy:** Build for 10M properties now, measure everything, fail safely

-----

## Table of Contents

1. [Pre-Phase: Assessment & Baseline](#pre-phase)
1. [Phase 1: Emergency Performance Fix](#phase-1)
1. [Phase 2: Growth Infrastructure](#phase-2)
1. [Phase 3: Production Vector Tiles](#phase-3)
1. [Security Hardening](#security)
1. [Mobile Optimization](#mobile)
1. [Cost Analysis](#costs)
1. [Monitoring & Observability](#monitoring)
1. [Go/No-Go Decision Framework](#decisions)

-----

## <a name="pre-phase"></a>Pre-Phase: Assessment & Baseline (Day 0 - 4-6 hours)

### Critical: Establish Measurable Baselines

**You cannot improve what you don’t measure.** Before making ANY changes, document current performance.

### Baseline Metrics to Capture

```typescript
// src/scripts/baseline-measurement.ts
import lighthouse from 'lighthouse';
import chromeLauncher from 'chrome-launcher';

async function captureBaseline() {
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
  
  const results = {
    timestamp: new Date().toISOString(),
    performance: {},
    database: {},
    user_experience: {}
  };
  
  // 1. Lighthouse Performance Score
  const lighthouseResults = await lighthouse(
    'http://localhost:3000/map',
    { port: chrome.port }
  );
  
  results.performance = {
    lighthouse_score: lighthouseResults.lhr.categories.performance.score * 100,
    first_contentful_paint: lighthouseResults.lhr.audits['first-contentful-paint'].numericValue,
    time_to_interactive: lighthouseResults.lhr.audits['interactive'].numericValue,
    total_blocking_time: lighthouseResults.lhr.audits['total-blocking-time'].numericValue,
    largest_contentful_paint: lighthouseResults.lhr.audits['largest-contentful-paint'].numericValue,
  };
  
  // 2. Database Performance
  const dbMetrics = await measureDatabasePerformance();
  results.database = dbMetrics;
  
  // 3. Memory Usage (via Puppeteer)
  const memoryMetrics = await measureMemoryUsage();
  results.user_experience = memoryMetrics;
  
  // Save to file for comparison
  fs.writeFileSync(
    `./baselines/baseline-${Date.now()}.json`,
    JSON.stringify(results, null, 2)
  );
  
  console.log('📊 Baseline captured:', results);
  
  await chrome.kill();
}

async function measureDatabasePerformance() {
  const pool = new Pool({...});
  
  // Measure query that fetches all properties (current bottleneck)
  const start = Date.now();
  await pool.query('SELECT id, latitude, longitude, price FROM properties LIMIT 100000');
  const duration = Date.now() - start;
  
  return {
    query_100k_properties_ms: duration,
    table_size_gb: await getTableSize(),
    index_count: await getIndexCount(),
    estimated_full_load_time_seconds: (duration / 100000) * 1200000 / 1000
  };
}

async function measureMemoryUsage() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000/map');
  
  // Wait for page to attempt loading properties
  await page.waitForTimeout(30000); // 30 seconds
  
  const metrics = await page.metrics();
  const jsHeapSize = await page.evaluate(() => {
    return (performance as any).memory?.usedJSHeapSize || 0;
  });
  
  await browser.close();
  
  return {
    js_heap_size_mb: jsHeapSize / 1024 / 1024,
    dom_nodes: metrics.Nodes,
    layout_count: metrics.LayoutCount,
    script_duration_ms: metrics.ScriptDuration * 1000
  };
}
```

### Baseline Checklist

Run these tests and record results:

- [ ] **Load Time:** How long until map is interactive? (Target: < 60s currently)
- [ ] **Memory Usage:** Peak memory during map interaction (Target: document current)
- [ ] **Database Query Time:** Time to fetch 100k properties (Target: document current)
- [ ] **Lighthouse Score:** Overall performance score (Target: document current)
- [ ] **User Experience:** Can map be panned without crash? (Target: probably no)
- [ ] **Mobile Performance:** Test on actual mobile device (Target: probably crashes)

### Expected Baseline Results (Before Optimization)

```json
{
  "performance": {
    "lighthouse_score": 15,
    "time_to_interactive": 60000,
    "largest_contentful_paint": 45000
  },
  "database": {
    "query_100k_properties_ms": 8000,
    "estimated_full_load_time_seconds": 96
  },
  "user_experience": {
    "js_heap_size_mb": 2400,
    "dom_nodes": 1200000
  }
}
```

**Save this file!** You’ll compare against it after each phase.

-----

## <a name="phase-1"></a>Phase 1: Emergency Performance Fix (Week 1)

### Goal: Go from unusable → fast for current 1.2M dataset

### 1.0 Risk Assessment & Rollback Plan

**Before starting, establish:**

```sql
-- Create backup schema
CREATE SCHEMA IF NOT EXISTS backup_20260207;

-- Backup current properties table
CREATE TABLE backup_20260207.properties AS 
SELECT * FROM properties;

-- Document rollback procedure
-- In emergency: DROP TABLE properties; 
--               ALTER TABLE backup_20260207.properties SET SCHEMA public;
--               ALTER TABLE properties RENAME TO properties;
```

### 1.1 Database Foundation (Day 1)

#### 1.1a Install PostGIS Extensions

```sql
-- Install PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology; -- For advanced spatial operations
CREATE EXTENSION IF NOT EXISTS btree_gist; -- For composite indexes

-- Verify installation
SELECT PostGIS_Version();
-- Expected: "3.x ..." or higher
```

#### 1.1b Add Geometry Column (Non-Blocking)

```sql
-- Add geometry column (instant, doesn't populate yet)
ALTER TABLE properties 
ADD COLUMN geom geometry(Point, 4326);

-- Add comment for documentation
COMMENT ON COLUMN properties.geom IS 
  'PostGIS geometry column (SRID 4326 - WGS84). Auto-populated via trigger.';
```

#### 1.1c Data Migration Strategy - Batched Update

**Problem:** `UPDATE` on 1.2M rows will lock the table for minutes.

**Solution:** Batch processing with progress tracking.

```sql
-- Migration script with progress tracking
DO $$
DECLARE
  batch_size INT := 50000;
  total_rows INT;
  processed INT := 0;
  batch_count INT := 0;
  start_time TIMESTAMP;
  batch_start TIMESTAMP;
  batch_duration INTERVAL;
BEGIN
  -- Count total rows needing migration
  SELECT COUNT(*) INTO total_rows 
  FROM properties 
  WHERE longitude IS NOT NULL 
    AND latitude IS NOT NULL 
    AND geom IS NULL;
  
  RAISE NOTICE 'Starting migration of % rows in batches of %', 
    total_rows, batch_size;
  
  start_time := clock_timestamp();
  
  WHILE processed < total_rows LOOP
    batch_start := clock_timestamp();
    batch_count := batch_count + 1;
    
    -- Update one batch
    UPDATE properties 
    SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
    WHERE id IN (
      SELECT id 
      FROM properties 
      WHERE geom IS NULL 
        AND longitude IS NOT NULL 
        AND latitude IS NOT NULL
      LIMIT batch_size
    );
    
    processed := processed + batch_size;
    batch_duration := clock_timestamp() - batch_start;
    
    RAISE NOTICE 'Batch %: Processed %/% rows (%.1f%%) in % seconds',
      batch_count,
      processed,
      total_rows,
      (processed::FLOAT / total_rows * 100),
      EXTRACT(EPOCH FROM batch_duration);
    
    -- Commit after each batch to avoid long transactions
    COMMIT;
    
    -- Brief pause to allow other queries to execute
    PERFORM pg_sleep(0.5);
  END LOOP;
  
  RAISE NOTICE 'Migration complete. Total time: %', 
    clock_timestamp() - start_time;
END $$;

-- Verify migration
SELECT 
  COUNT(*) as total,
  COUNT(geom) as with_geometry,
  COUNT(*) - COUNT(geom) as missing_geometry
FROM properties;

-- Expected: missing_geometry should be 0 or very small
```

#### 1.1d Auto-Population Trigger for New Records

**Critical:** Your scraper adds properties continuously. Without this trigger, new properties won’t have geometry.

```sql
-- Create trigger function
CREATE OR REPLACE FUNCTION populate_geom()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-populate geometry from lat/lng if available
  IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER trigger_populate_geom
BEFORE INSERT OR UPDATE OF longitude, latitude ON properties
FOR EACH ROW
EXECUTE FUNCTION populate_geom();

-- Test trigger
INSERT INTO properties (address, longitude, latitude, price)
VALUES ('Test Address', -122.4194, 37.7749, 1000000);

SELECT address, ST_AsText(geom) FROM properties WHERE address = 'Test Address';
-- Expected: POINT(-122.4194 37.7749)

-- Clean up test
DELETE FROM properties WHERE address = 'Test Address';
```

#### 1.1e Create Spatial Indexes

```sql
-- Primary spatial index
CREATE INDEX idx_properties_geom 
ON properties USING GIST(geom);

-- Composite indexes for filtered queries
-- These enable fast queries like "3-bed homes in Seattle under $800k"
CREATE INDEX idx_properties_geom_price 
ON properties USING GIST(geom, price);

CREATE INDEX idx_properties_geom_beds 
ON properties USING GIST(geom, bedrooms);

CREATE INDEX idx_properties_geom_type 
ON properties USING GIST(geom, property_type);

-- Index on status for filtering active listings
CREATE INDEX idx_properties_status 
ON properties(status) 
WHERE status = 'active';

-- Update statistics for query planner
ANALYZE properties;

-- Verify indexes created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'properties'
ORDER BY indexname;
```

### 1.2 Security-Hardened API Route (Day 1-2)

**Critical Security Fix:** Previous version had SQL injection vulnerability.

```typescript
// src/app/api/properties/viewport/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20, // Connection pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Input validation schema with Zod
const ViewportParamsSchema = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
  zoom: z.number().min(0).max(22),
  // Filters - all optional
  minPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  beds: z.number().int().min(0).max(20).optional(),
  baths: z.number().min(0).max(20).optional(),
  propertyType: z.enum(['house', 'condo', 'townhouse', 'apartment', 'land']).optional(),
  status: z.enum(['active', 'pending', 'sold']).optional(),
});

type ViewportParams = z.infer<typeof ViewportParamsSchema>;

interface QueryBuilder {
  clause: string;
  values: any[];
  nextParamIndex: number;
}

function getGridSize(zoom: number): number {
  // Clustering grid size prevents overwhelming the client
  if (zoom < 8) return 1.0;      // State level
  if (zoom < 10) return 0.5;     // City level  
  if (zoom < 12) return 0.1;     // District level
  if (zoom < 14) return 0.05;    // Neighborhood level
  return 0;                       // Individual properties
}

function buildSecureFilterClause(
  params: ViewportParams,
  startParamIndex: number = 5
): QueryBuilder {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = startParamIndex;
  
  // SECURITY: Use parameterized queries - NEVER string concatenation
  
  if (params.minPrice !== undefined) {
    conditions.push(`AND price >= $${paramIndex}`);
    values.push(params.minPrice);
    paramIndex++;
  }
  
  if (params.maxPrice !== undefined) {
    conditions.push(`AND price <= $${paramIndex}`);
    values.push(params.maxPrice);
    paramIndex++;
  }
  
  if (params.beds !== undefined) {
    conditions.push(`AND bedrooms >= $${paramIndex}`);
    values.push(params.beds);
    paramIndex++;
  }
  
  if (params.baths !== undefined) {
    conditions.push(`AND bathrooms >= $${paramIndex}`);
    values.push(params.baths);
    paramIndex++;
  }
  
  if (params.propertyType !== undefined) {
    conditions.push(`AND property_type = $${paramIndex}`);
    values.push(params.propertyType);
    paramIndex++;
  }
  
  if (params.status !== undefined) {
    conditions.push(`AND status = $${paramIndex}`);
    values.push(params.status);
    paramIndex++;
  }
  
  return {
    clause: conditions.join(' '),
    values,
    nextParamIndex: paramIndex
  };
}

export async function GET(request: NextRequest) {
  const requestStart = Date.now();
  
  try {
    // Extract and validate parameters
    const params = extractAndValidateParams(request);
    
    const gridSize = getGridSize(params.zoom);
    const { clause: filterClause, values: filterValues } = 
      buildSecureFilterClause(params);
    
    let result;
    let queryType: string;
    
    if (gridSize > 0) {
      // CLUSTERED VIEW for low zoom
      queryType = 'clusters';
      
      const queryParams = [
        params.west, 
        params.south, 
        params.east, 
        params.north,
        ...filterValues,
        gridSize
      ];
      
      result = await pool.query(`
        SELECT 
          ST_Y(ST_Centroid(ST_Collect(geom))) as latitude,
          ST_X(ST_Centroid(ST_Collect(geom))) as longitude,
          COUNT(*)::int as count,
          AVG(price)::numeric(10,2) as avg_price,
          MIN(price)::numeric(10,2) as min_price,
          MAX(price)::numeric(10,2) as max_price,
          json_agg(DISTINCT property_type) as types
        FROM properties
        WHERE 
          geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          ${filterClause}
        GROUP BY ST_SnapToGrid(geom, $${queryParams.length})
        HAVING COUNT(*) > 0
      `, queryParams);
      
    } else {
      // INDIVIDUAL PROPERTIES for high zoom
      queryType = 'properties';
      
      const queryParams = [
        params.west,
        params.south,
        params.east,
        params.north,
        ...filterValues
      ];
      
      result = await pool.query(`
        SELECT 
          id,
          ST_Y(geom) as latitude,
          ST_X(geom) as longitude,
          price,
          address,
          bedrooms,
          bathrooms,
          sqft,
          property_type,
          status,
          image_url
        FROM properties
        WHERE 
          geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          ${filterClause}
        ORDER BY price ASC
        LIMIT 2000
      `, queryParams);
    }
    
    const duration = Date.now() - requestStart;
    
    // Log metrics for monitoring
    await logTileRequest({
      tile_type: queryType,
      zoom: params.zoom,
      response_time_ms: duration,
      result_count: result.rows.length,
      cache_hit: false,
      filters_applied: Object.keys(params).filter(k => 
        !['north', 'south', 'east', 'west', 'zoom'].includes(k)
      ).length
    });
    
    return NextResponse.json({
      type: queryType,
      data: result.rows,
      zoom: params.zoom,
      metadata: {
        count: result.rows.length,
        response_time_ms: duration
      }
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300', // 5 minute cache
        'X-Response-Time': `${duration}ms`
      }
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 }
      );
    }
    
    console.error('Viewport query error:', error);
    
    return NextResponse.json(
      { error: 'Failed to fetch properties' },
      { status: 500 }
    );
  }
}

function extractAndValidateParams(request: NextRequest): ViewportParams {
  const sp = request.nextUrl.searchParams;
  
  const rawParams = {
    north: parseFloat(sp.get('north') || '0'),
    south: parseFloat(sp.get('south') || '0'),
    east: parseFloat(sp.get('east') || '0'),
    west: parseFloat(sp.get('west') || '0'),
    zoom: parseFloat(sp.get('zoom') || '10'),
    minPrice: sp.get('minPrice') ? parseInt(sp.get('minPrice')!) : undefined,
    maxPrice: sp.get('maxPrice') ? parseInt(sp.get('maxPrice')!) : undefined,
    beds: sp.get('beds') ? parseInt(sp.get('beds')!) : undefined,
    baths: sp.get('baths') ? parseFloat(sp.get('baths')!) : undefined,
    propertyType: sp.get('propertyType') as any || undefined,
    status: sp.get('status') as any || undefined,
  };
  
  // Validate with Zod schema - throws ZodError if invalid
  return ViewportParamsSchema.parse(rawParams);
}

// Monitoring helper
async function logTileRequest(metrics: {
  tile_type: string;
  zoom: number;
  response_time_ms: number;
  result_count: number;
  cache_hit: boolean;
  filters_applied: number;
}) {
  // Log to console for now, will integrate with observability platform in Phase 2
  if (metrics.response_time_ms > 1000) {
    console.warn('⚠️  SLOW TILE REQUEST', metrics);
  } else {
    console.log('✅ Tile request', metrics);
  }
  
  // TODO Phase 2: Send to monitoring service
}
```

### 1.3 Frontend Map Component with Mobile Support (Day 2-3)

```typescript
// src/components/PropertyMap.tsx
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Map, { Marker } from 'react-map-gl';
import type { MapRef } from 'react-map-gl';
import { debounce } from 'lodash';

interface MapData {
  type: 'clusters' | 'properties';
  data: any[];
  zoom: number;
  metadata: {
    count: number;
    response_time_ms: number;
  };
}

interface FilterState {
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  baths?: number;
  propertyType?: string;
  status?: string;
}

// Detect mobile for optimization
const isMobile = () => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  ) || window.innerWidth < 768;
};

// Respect reduced motion preference
const prefersReducedMotion = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export default function PropertyMap() {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState({
    longitude: -98.5795,
    latitude: 39.8283,
    zoom: 4
  });
  
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<FilterState>({});
  const [error, setError] = useState<string | null>(null);
  
  const mobile = useMemo(() => isMobile(), []);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  const fetchProperties = useCallback(async (
    bounds: any, 
    zoom: number,
    currentFilters: FilterState
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        north: bounds._ne.lat.toString(),
        south: bounds._sw.lat.toString(),
        east: bounds._ne.lng.toString(),
        west: bounds._sw.lng.toString(),
        zoom: zoom.toString(),
      });
      
      // Add filters
      Object.entries(currentFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });

      const response = await fetch(`/api/properties/viewport?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setMapData(data);
      
      // Log performance metric
      console.log(`📍 Loaded ${data.metadata.count} ${data.type} in ${data.metadata.response_time_ms}ms`);
      
    } catch (error) {
      console.error('Error fetching properties:', error);
      setError(error instanceof Error ? error.message : 'Failed to load properties');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce to prevent excessive API calls during pan/zoom
  // Longer debounce on mobile to reduce battery drain
  const debouncedFetch = useMemo(
    () => debounce(
      (bounds: any, zoom: number, currentFilters: FilterState) => 
        fetchProperties(bounds, zoom, currentFilters),
      mobile ? 500 : 300
    ),
    [fetchProperties, mobile]
  );

  const handleMoveEnd = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    
    debouncedFetch(bounds, zoom, filters);
  }, [debouncedFetch, filters]);

  // Trigger fetch when filters change
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    
    fetchProperties(bounds, zoom, filters);
  }, [filters, fetchProperties]);

  // Initial load
  useEffect(() => {
    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      
      fetchProperties(bounds, zoom, filters);
    }, 500);
    
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative h-screen w-full">
      {/* Filter Panel */}
      <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded-lg shadow-lg max-w-xs">
        <FilterPanel filters={filters} onChange={setFilters} mobile={mobile} />
      </div>
      
      {/* Loading Indicator */}
      {loading && (
        <div className="absolute top-4 right-4 z-10 bg-blue-600 text-white px-4 py-2 rounded shadow-lg animate-pulse">
          Loading properties...
        </div>
      )}
      
      {/* Error Display */}
      {error && (
        <div className="absolute top-16 right-4 z-10 bg-red-600 text-white px-4 py-2 rounded shadow-lg">
          ⚠️ {error}
        </div>
      )}
      
      {/* Stats Display */}
      {mapData && !loading && (
        <div className="absolute bottom-4 left-4 z-10 bg-white px-4 py-2 rounded shadow text-sm">
          <div className="font-semibold">
            {mapData.metadata.count.toLocaleString()} {mapData.type}
          </div>
          <div className="text-gray-600">
            Loaded in {mapData.metadata.response_time_ms}ms
          </div>
        </div>
      )}
      
      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        onMoveEnd={handleMoveEnd}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        // Mobile optimizations
        renderWorldCopies={!mobile}
        pitchWithRotate={!mobile}
        touchPitch={!mobile}
        // Accessibility
        attributionControl={true}
      >
        {/* Render Clusters */}
        {mapData?.type === 'clusters' && mapData.data.map((cluster, idx) => (
          <Marker
            key={`cluster-${idx}`}
            longitude={cluster.longitude}
            latitude={cluster.latitude}
          >
            <div 
              className="relative cursor-pointer hover:scale-110 transition-transform"
              style={{ minWidth: mobile ? '44px' : '56px', minHeight: mobile ? '44px' : '56px' }}
            >
              <div className="bg-blue-600 text-white rounded-full flex flex-col items-center justify-center font-bold shadow-lg w-full h-full">
                <div className="text-sm">{cluster.count.toLocaleString()}</div>
                <div className="text-xs">
                  ${(cluster.avg_price / 1000).toFixed(0)}k
                </div>
              </div>
            </div>
          </Marker>
        ))}
        
        {/* Render Individual Properties */}
        {mapData?.type === 'properties' && mapData.data.map((property) => (
          <Marker
            key={property.id}
            longitude={property.longitude}
            latitude={property.latitude}
          >
            <div 
              className="cursor-pointer hover:scale-110 transition-transform"
              onClick={() => {
                // TODO: Open property details modal
                console.log('Selected property:', property.id);
              }}
              style={{ minWidth: mobile ? '44px' : 'auto' }}
            >
              <div className="bg-white border-2 border-blue-600 px-2 py-1 rounded text-sm font-semibold shadow-lg whitespace-nowrap">
                ${(property.price / 1000).toFixed(0)}k
                {property.status === 'sold' && (
                  <span className="ml-1 text-xs text-red-600">SOLD</span>
                )}
              </div>
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
}

function FilterPanel({ 
  filters, 
  onChange,
  mobile
}: { 
  filters: FilterState; 
  onChange: (f: FilterState) => void;
  mobile: boolean;
}) {
  return (
    <div className={`space-y-3 ${mobile ? 'w-full' : 'w-64'}`}>
      <h3 className="font-bold text-lg">Filters</h3>
      
      <div>
        <label className="text-sm font-medium block mb-1">Price Range</label>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Min"
            className="w-full px-2 py-1 border rounded"
            value={filters.minPrice || ''}
            onChange={(e) => onChange({
              ...filters, 
              minPrice: e.target.value ? parseInt(e.target.value) : undefined
            })}
          />
          <input
            type="number"
            placeholder="Max"
            className="w-full px-2 py-1 border rounded"
            value={filters.maxPrice || ''}
            onChange={(e) => onChange({
              ...filters,
              maxPrice: e.target.value ? parseInt(e.target.value) : undefined
            })}
          />
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium block mb-1">Bedrooms</label>
        <select
          className="w-full px-2 py-1 border rounded"
          value={filters.beds || ''}
          onChange={(e) => onChange({
            ...filters,
            beds: e.target.value ? parseInt(e.target.value) : undefined
          })}
        >
          <option value="">Any</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
          <option value="4">4+</option>
          <option value="5">5+</option>
        </select>
      </div>
      
      <div>
        <label className="text-sm font-medium block mb-1">Property Type</label>
        <select
          className="w-full px-2 py-1 border rounded"
          value={filters.propertyType || ''}
          onChange={(e) => onChange({
            ...filters,
            propertyType: e.target.value || undefined
          })}
        >
          <option value="">Any</option>
          <option value="house">House</option>
          <option value="condo">Condo</option>
          <option value="townhouse">Townhouse</option>
          <option value="apartment">Apartment</option>
          <option value="land">Land</option>
        </select>
      </div>
      
      <div>
        <label className="text-sm font-medium block mb-1">Status</label>
        <select
          className="w-full px-2 py-1 border rounded"
          value={filters.status || ''}
          onChange={(e) => onChange({
            ...filters,
            status: e.target.value || undefined
          })}
        >
          <option value="">Any</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="sold">Sold</option>
        </select>
      </div>
      
      <button
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition-colors"
        onClick={() => onChange({})}
      >
        Clear All Filters
      </button>
    </div>
  );
}
```

### 1.4 Data Consistency Verification (Day 3)

```sql
-- Continuous monitoring query
CREATE OR REPLACE VIEW property_geom_health AS
SELECT 
  COUNT(*) as total_properties,
  COUNT(geom) as with_geometry,
  COUNT(*) - COUNT(geom) as missing_geometry,
  ROUND(COUNT(geom)::numeric / COUNT(*)::numeric * 100, 2) as geometry_coverage_pct,
  MAX(created_at) as latest_property_added,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as added_last_24h
FROM properties;

-- Check health
SELECT * FROM property_geom_health;

-- Expected result:
-- geometry_coverage_pct should be 100.00 or very close
-- If < 99%, investigate why trigger isn't firing
```

### 1.5 Phase 1 Validation & Testing (Day 4)

#### Performance Testing Script

```bash
# install k6 for load testing
npm install -g k6

# Run load test
k6 run load-test.js
```

```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up to 20 users
    { duration: '3m', target: 50 },   // Ramp up to 50 users
    { duration: '2m', target: 100 },  // Stress test with 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000'], // 95% under 1 second
    'errors': ['rate<0.1'],               // Error rate under 10%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Sample tile coordinates across different zoom levels
const testTiles = [
  // Low zoom (clusters)
  { zoom: 4, bounds: { north: 50, south: 25, east: -65, west: -125 } },
  { zoom: 8, bounds: { north: 42, south: 38, east: -118, west: -122 } },
  // Medium zoom
  { zoom: 10, bounds: { north: 40.8, south: 40.6, east: -73.9, west: -74.1 } },
  { zoom: 12, bounds: { north: 37.82, south: 37.72, east: -122.38, west: -122.52 } },
  // High zoom (individual properties)
  { zoom: 14, bounds: { north: 37.775, south: 37.765, east: -122.415, west: -122.425 } },
  { zoom: 16, bounds: { north: 37.7705, south: 37.7695, east: -122.4185, west: -122.4195 } },
];

export default function () {
  // Select random tile
  const tile = testTiles[Math.floor(Math.random() * testTiles.length)];
  
  const params = new URLSearchParams({
    north: tile.bounds.north.toString(),
    south: tile.bounds.south.toString(),
    east: tile.bounds.east.toString(),
    west: tile.bounds.west.toString(),
    zoom: tile.zoom.toString(),
  });
  
  // Add random filters 30% of the time
  if (Math.random() < 0.3) {
    params.append('minPrice', '300000');
    params.append('maxPrice', '1000000');
  }
  
  const url = `${BASE_URL}/api/properties/viewport?${params}`;
  
  const res = http.get(url);
  
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 1s': (r) => r.timings.duration < 1000,
    'has data': (r) => {
      try {
        const json = JSON.parse(r.body);
        return json.data && Array.isArray(json.data);
      } catch {
        return false;
      }
    },
  });
  
  errorRate.add(!success);
  
  sleep(Math.random() * 2 + 1); // 1-3 second pause between requests
}
```

#### Phase 1 Validation Checklist

Before proceeding to Phase 2, verify all criteria are met:

**Performance Metrics:**

- [ ] Initial page load < 3 seconds (from 60s+ baseline)
- [ ] Map pan/zoom completes in < 500ms
- [ ] Memory usage < 300MB during normal use (from 2GB+ baseline)
- [ ] Load test: p95 response time < 1s
- [ ] Load test: Error rate < 5%

**Functional Requirements:**

- [ ] Map loads without browser crash
- [ ] Clusters display correctly at low zoom
- [ ] Individual properties appear at high zoom
- [ ] Filters update map correctly
- [ ] Mobile devices can interact smoothly

**Data Integrity:**

- [ ] Geometry coverage > 99% (run `SELECT * FROM property_geom_health`)
- [ ] New properties auto-populate geometry
- [ ] No NULL geometry errors in logs

**Security:**

- [ ] No SQL injection vulnerabilities (test with malicious params)
- [ ] Input validation catches invalid parameters
- [ ] Rate limiting in place (if applicable)

**Before/After Comparison:**

```bash
# Run baseline comparison
node scripts/compare-to-baseline.js
```

```javascript
// scripts/compare-to-baseline.js
const baseline = require('../baselines/baseline-[TIMESTAMP].json');
const current = require('../baselines/baseline-after-phase1.json');

console.log('📊 Performance Improvements\n');

console.log('Lighthouse Score:');
console.log(`  Before: ${baseline.performance.lighthouse_score}`);
console.log(`  After:  ${current.performance.lighthouse_score}`);
console.log(`  Improvement: ${((current.performance.lighthouse_score - baseline.performance.lighthouse_score) / baseline.performance.lighthouse_score * 100).toFixed(1)}%\n`);

console.log('Time to Interactive:');
console.log(`  Before: ${(baseline.performance.time_to_interactive / 1000).toFixed(1)}s`);
console.log(`  After:  ${(current.performance.time_to_interactive / 1000).toFixed(1)}s`);
console.log(`  Improvement: ${((baseline.performance.time_to_interactive - current.performance.time_to_interactive) / baseline.performance.time_to_interactive * 100).toFixed(1)}%\n`);

console.log('Memory Usage:');
console.log(`  Before: ${baseline.user_experience.js_heap_size_mb.toFixed(0)}MB`);
console.log(`  After:  ${current.user_experience.js_heap_size_mb.toFixed(0)}MB`);
console.log(`  Reduction: ${((baseline.user_experience.js_heap_size_mb - current.user_experience.js_heap_size_mb) / baseline.user_experience.js_heap_size_mb * 100).toFixed(1)}%\n`);
```

### Expected Phase 1 Results

|Metric                |Before            |After Phase 1|Improvement         |
|----------------------|------------------|-------------|--------------------|
|Initial Page Load     |60+ seconds       |2-3 seconds  |**95%+ faster**     |
|Map Pan/Zoom          |Crashes           |200-400ms    |**Usable**          |
|Filter Change         |N/A               |300-500ms    |**New capability**  |
|Memory Usage          |2-4GB (crash risk)|50-200MB     |**90%+ reduction**  |
|Properties Per Request|1,200,000         |100-2,000    |**Targeted loading**|
|Lighthouse Score      |10-20             |60-80        |**4x improvement**  |
|Mobile Support        |Crashes           |Functional   |**Enabled**         |

-----

## <a name="phase-2"></a>Phase 2: Growth Infrastructure (Week 2-3)

### Goal: Prepare for 10M+ properties with production-grade caching and monitoring

**Triggers to start Phase 2:**

- ✅ Phase 1 validation complete
- Dataset approaching 3-5M properties
- Response times consistently > 300ms
- Planning to add new features (save searches, alerts, etc.)

-----

### 2.1 Redis Caching Layer (Day 5-6)

**Why Redis?** Even with PostGIS spatial indexes, querying 5M+ properties repeatedly is expensive. Redis adds a fast in-memory cache between your API and database.

#### 2.1a Redis Setup via Docker

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgis/postgis:15-3.3
    environment:
      POSTGRES_DB: realestatedb
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 2gb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
  
  app:
    build: .
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/realestatedb
      REDIS_URL: redis://redis:6379
    ports:
      - "3000:3000"

volumes:
  postgres-data:
  redis-data:
```

```bash
# Start services
docker-compose up -d

# Verify Redis is running
docker-compose exec redis redis-cli ping
# Expected: PONG
```

#### 2.1b Caching Library with Compression

```typescript
// src/lib/cache.ts
import { createClient } from 'redis';
import { compress, decompress } from 'lz-string';

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        return new Error('Redis connection failed after 10 retries');
      }
      return Math.min(retries * 50, 500);
    }
  }
});

redis.on('error', (err) => console.error('Redis Client Error:', err));
redis.on('connect', () => console.log('✅ Redis connected'));

// Connect on module load
await redis.connect();

export interface CacheOptions {
  ttl?: number;           // Time to live in seconds (default: 300)
  compress?: boolean;     // Compress large payloads (default: true)
  tags?: string[];        // Cache tags for selective invalidation
}

export async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<{ data: T; fromCache: boolean }> {
  const { 
    ttl = 300,           // 5 minutes default
    compress = true,
    tags = []
  } = options;
  
  try {
    // Try to get from cache
    const cached = await redis.get(key);
    
    if (cached) {
      const parsed = compress && cached.startsWith('LZ:')
        ? JSON.parse(decompress(cached.slice(3)))
        : JSON.parse(cached);
      
      return { data: parsed as T, fromCache: true };
    }
    
    // Cache miss - fetch fresh data
    const fresh = await fetcher();
    
    // Store in cache (non-blocking)
    const serialized = JSON.stringify(fresh);
    const toStore = compress && serialized.length > 1000
      ? 'LZ:' + compress(serialized)
      : serialized;
    
    redis.setEx(key, ttl, toStore).catch(err => 
      console.error('Cache write error:', err)
    );
    
    // Store tags for invalidation
    if (tags.length > 0) {
      tags.forEach(tag => {
        redis.sAdd(`tag:${tag}`, key).catch(console.error);
      });
    }
    
    return { data: fresh, fromCache: false };
    
  } catch (error) {
    console.error('Cache error, falling back to direct fetch:', error);
    const fresh = await fetcher();
    return { data: fresh, fromCache: false };
  }
}

export async function invalidateByTag(tag: string): Promise<void> {
  try {
    const keys = await redis.sMembers(`tag:${tag}`);
    
    if (keys.length > 0) {
      await redis.del(keys);
      await redis.del(`tag:${tag}`);
      console.log(`🗑️  Invalidated ${keys.length} cache entries for tag: ${tag}`);
    }
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
}

export async function getCacheStats(): Promise<{
  hits: number;
  misses: number;
  hitRate: number;
  memoryUsed: string;
  keys: number;
}> {
  const info = await redis.info('stats');
  const memory = await redis.info('memory');
  
  const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] || '0');
  const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] || '0');
  const total = hits + misses;
  const hitRate = total > 0 ? hits / total : 0;
  
  const memoryUsed = memory.match(/used_memory_human:(.+)/)?.[1] || 'unknown';
  const keys = await redis.dbSize();
  
  return {
    hits,
    misses,
    hitRate: Math.round(hitRate * 100) / 100,
    memoryUsed,
    keys
  };
}

export { redis };
```

#### 2.1c Update API with Caching

```typescript
// src/app/api/properties/viewport/route.ts
import { getCachedOrFetch } from '@/lib/cache';
import crypto from 'crypto';

// ... existing imports and schemas ...

function generateCacheKey(params: ViewportParams): string {
  // Create deterministic cache key from parameters
  const normalized = {
    bounds: {
      n: params.north.toFixed(4),
      s: params.south.toFixed(4),
      e: params.east.toFixed(4),
      w: params.west.toFixed(4),
    },
    zoom: params.zoom,
    filters: {
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      beds: params.beds,
      baths: params.baths,
      propertyType: params.propertyType,
      status: params.status,
    }
  };
  
  const hash = crypto
    .createHash('md5')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 8);
  
  return `tile:${params.zoom}:${hash}`;
}

export async function GET(request: NextRequest) {
  const requestStart = Date.now();
  
  try {
    const params = extractAndValidateParams(request);
    const cacheKey = generateCacheKey(params);
    
    // Try cache first
    const { data: result, fromCache } = await getCachedOrFetch(
      cacheKey,
      async () => {
        // This function only runs on cache miss
        const gridSize = getGridSize(params.zoom);
        const { clause: filterClause, values: filterValues } = 
          buildSecureFilterClause(params);
        
        if (gridSize > 0) {
          // Clustered query
          const queryParams = [
            params.west, params.south, params.east, params.north,
            ...filterValues,
            gridSize
          ];
          
          const dbResult = await pool.query(`
            SELECT 
              ST_Y(ST_Centroid(ST_Collect(geom))) as latitude,
              ST_X(ST_Centroid(ST_Collect(geom))) as longitude,
              COUNT(*)::int as count,
              AVG(price)::numeric(10,2) as avg_price,
              MIN(price)::numeric(10,2) as min_price,
              MAX(price)::numeric(10,2) as max_price,
              json_agg(DISTINCT property_type) as types
            FROM properties
            WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
              ${filterClause}
            GROUP BY ST_SnapToGrid(geom, $${queryParams.length})
            HAVING COUNT(*) > 0
          `, queryParams);
          
          return {
            type: 'clusters',
            data: dbResult.rows,
            zoom: params.zoom
          };
          
        } else {
          // Individual properties query
          const queryParams = [
            params.west, params.south, params.east, params.north,
            ...filterValues
          ];
          
          const dbResult = await pool.query(`
            SELECT 
              id, ST_Y(geom) as latitude, ST_X(geom) as longitude,
              price, address, bedrooms, bathrooms, sqft,
              property_type, status, image_url
            FROM properties
            WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
              ${filterClause}
            ORDER BY price ASC
            LIMIT 2000
          `, queryParams);
          
          return {
            type: 'properties',
            data: dbResult.rows,
            zoom: params.zoom
          };
        }
      },
      {
        ttl: 300,  // 5 minutes for dynamic data
        compress: true,
        tags: ['tiles', `zoom:${params.zoom}`]
      }
    );
    
    const duration = Date.now() - requestStart;
    
    await logTileRequest({
      tile_type: result.type,
      zoom: params.zoom,
      response_time_ms: duration,
      result_count: result.data.length,
      cache_hit: fromCache,
      filters_applied: Object.keys(params).filter(k => 
        !['north', 'south', 'east', 'west', 'zoom'].includes(k)
      ).length
    });
    
    return NextResponse.json({
      ...result,
      metadata: {
        count: result.data.length,
        response_time_ms: duration,
        cached: fromCache
      }
    }, {
      headers: {
        'Cache-Control': fromCache 
          ? 'public, max-age=300' 
          : 'public, max-age=300, stale-while-revalidate=600',
        'X-Response-Time': `${duration}ms`,
        'X-Cache-Status': fromCache ? 'HIT' : 'MISS'
      }
    });
    
  } catch (error) {
    // ... error handling ...
  }
}
```

#### 2.1d Cache Invalidation Strategy

```typescript
// src/lib/cache-invalidation.ts
import { invalidateByTag } from './cache';

/**
 * Call this after bulk property updates (e.g., nightly scrape)
 */
export async function invalidatePropertyCache(options?: {
  zoomLevels?: number[];  // Specific zoom levels to invalidate
  regions?: string[];     // Specific geographic regions
}) {
  const { zoomLevels, regions } = options || {};
  
  if (zoomLevels && zoomLevels.length > 0) {
    // Invalidate specific zoom levels
    for (const zoom of zoomLevels) {
      await invalidateByTag(`zoom:${zoom}`);
    }
  } else {
    // Invalidate all tiles
    await invalidateByTag('tiles');
  }
  
  console.log('✅ Property cache invalidated');
}

// Example: Call after nightly scrape
// await invalidatePropertyCache({ zoomLevels: [12, 13, 14, 15, 16] });
```

### 2.2 CDN Layer for Global Performance (Day 6-7)

**Why CDN?** Even with Redis, your origin server handles all requests. A CDN caches responses at edge locations worldwide, reducing latency and server load.

#### 2.2a CloudFront Configuration (AWS)

```typescript
// infrastructure/cdn-config.ts (if using CDN-as-code)
export const cdnConfig = {
  origin: 'api.yourrealestate.com',
  cacheBehaviors: [
    {
      pathPattern: '/api/properties/viewport*',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD'],
      compress: true,
      viewerProtocolPolicy: 'redirect-to-https',
      cachePolicyId: 'custom-tile-cache',
      originRequestPolicyId: 'AllViewerExceptHostHeader',
    }
  ],
  customCachePolicy: {
    name: 'tile-cache-policy',
    defaultTTL: 300,      // 5 minutes
    maxTTL: 3600,         // 1 hour
    minTTL: 60,           // 1 minute
    parametersInCacheKey: {
      queryStringsConfig: {
        queryStringBehavior: 'all'  // Cache by all query params
      },
      headersConfig: {
        headerBehavior: 'none'
      },
      cookiesConfig: {
        cookieBehavior: 'none'
      },
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true
    }
  }
};
```

#### 2.2b Cache-Control Headers Strategy

```typescript
// src/app/api/properties/viewport/route.ts

function getCacheControlHeader(
  type: 'clusters' | 'properties',
  zoom: number,
  fromCache: boolean
): string {
  // More aggressive caching for clusters (change less frequently)
  if (type === 'clusters') {
    return fromCache
      ? 'public, max-age=600, stale-while-revalidate=1800'  // 10 min, allow 30 min stale
      : 'public, max-age=600, stale-while-revalidate=1800';
  }
  
  // Conservative caching for individual properties (change more frequently)
  return fromCache
    ? 'public, max-age=300, stale-while-revalidate=600'     // 5 min, allow 10 min stale
    : 'public, max-age=300, stale-while-revalidate=600';
}

// In response:
return NextResponse.json(result, {
  headers: {
    'Cache-Control': getCacheControlHeader(result.type, params.zoom, fromCache),
    'X-Response-Time': `${duration}ms`,
    'X-Cache-Status': fromCache ? 'HIT' : 'MISS',
    'Vary': 'Accept-Encoding'  // Important for CDN
  }
});
```

### 2.3 Database Optimizations for 10M+ Scale (Day 7-8)

#### 2.3a Table Partitioning by Region

**When to implement:** Dataset > 5M properties or international expansion

```sql
-- Create partitioned table
CREATE TABLE properties_new (
  id BIGSERIAL,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip VARCHAR(20),
  country VARCHAR(50) DEFAULT 'US',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  price NUMERIC(12,2),
  bedrooms SMALLINT,
  bathrooms NUMERIC(3,1),
  sqft INTEGER,
  property_type VARCHAR(50),
  status VARCHAR(20),
  image_url TEXT,
  geom geometry(Point, 4326),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  -- Partition key
  region VARCHAR(50) NOT NULL
) PARTITION BY LIST (region);

-- Create partitions by US region
CREATE TABLE properties_west PARTITION OF properties_new
  FOR VALUES IN ('CA', 'WA', 'OR', 'NV', 'AZ', 'UT', 'ID', 'MT', 'WY', 'CO', 'NM', 'HI', 'AK');

CREATE TABLE properties_midwest PARTITION OF properties_new
  FOR VALUES IN ('ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH');

CREATE TABLE properties_south PARTITION OF properties_new
  FOR VALUES IN ('TX', 'OK', 'AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'MD', 'DE', 'DC');

CREATE TABLE properties_northeast PARTITION OF properties_new
  FOR VALUES IN ('PA', 'NY', 'NJ', 'CT', 'RI', 'MA', 'VT', 'NH', 'ME');

-- Default partition for any other states/international
CREATE TABLE properties_other PARTITION OF properties_new
  DEFAULT;

-- Function to determine region from state
CREATE OR REPLACE FUNCTION get_region_from_state(state_code VARCHAR) 
RETURNS VARCHAR AS $$
BEGIN
  CASE state_code
    WHEN 'CA', 'WA', 'OR', 'NV', 'AZ', 'UT', 'ID', 'MT', 'WY', 'CO', 'NM', 'HI', 'AK' 
      THEN RETURN 'west';
    WHEN 'ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH' 
      THEN RETURN 'midwest';
    WHEN 'TX', 'OK', 'AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'MD', 'DE', 'DC' 
      THEN RETURN 'south';
    WHEN 'PA', 'NY', 'NJ', 'CT', 'RI', 'MA', 'VT', 'NH', 'ME' 
      THEN RETURN 'northeast';
    ELSE RETURN 'other';
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Migrate data from old table to partitioned table
INSERT INTO properties_new 
SELECT 
  id, address, city, state, zip, country,
  latitude, longitude, price, bedrooms, bathrooms, sqft,
  property_type, status, image_url, geom,
  created_at, updated_at,
  get_region_from_state(state) as region
FROM properties;

-- Create indexes on each partition (much faster than one huge index)
CREATE INDEX idx_properties_west_geom ON properties_west USING GIST(geom);
CREATE INDEX idx_properties_west_price ON properties_west USING GIST(geom, price);

CREATE INDEX idx_properties_midwest_geom ON properties_midwest USING GIST(geom);
CREATE INDEX idx_properties_midwest_price ON properties_midwest USING GIST(geom, price);

CREATE INDEX idx_properties_south_geom ON properties_south USING GIST(geom);
CREATE INDEX idx_properties_south_price ON properties_south USING GIST(geom, price);

CREATE INDEX idx_properties_northeast_geom ON properties_northeast USING GIST(geom);
CREATE INDEX idx_properties_northeast_price ON properties_northeast USING GIST(geom, price);

-- Update trigger to auto-set region
CREATE OR REPLACE FUNCTION set_property_region()
RETURNS TRIGGER AS $$
BEGIN
  NEW.region := get_region_from_state(NEW.state);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_region
BEFORE INSERT OR UPDATE OF state ON properties_new
FOR EACH ROW
EXECUTE FUNCTION set_property_region();

-- Swap tables (use transaction for safety)
BEGIN;
ALTER TABLE properties RENAME TO properties_old;
ALTER TABLE properties_new RENAME TO properties;
COMMIT;

-- Verify partitioning is working
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename LIKE 'properties_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### 2.3b Materialized Views for Fast Stats

```sql
-- Pre-computed statistics for homepage/dashboards
CREATE MATERIALIZED VIEW property_stats_summary AS
SELECT 
  state,
  city,
  COUNT(*) as total_properties,
  COUNT(*) FILTER (WHERE status = 'active') as active_listings,
  AVG(price)::numeric(10,2) as avg_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) as median_price,
  MIN(price) as min_price,
  MAX(price) as max_price,
  ST_Centroid(ST_Collect(geom)) as center_point,
  ST_Envelope(ST_Collect(geom)) as bounding_box
FROM properties
WHERE status = 'active'
GROUP BY state, city
HAVING COUNT(*) >= 10;  -- Only cities with 10+ properties

CREATE INDEX idx_stats_state_city ON property_stats_summary(state, city);
CREATE INDEX idx_stats_center ON property_stats_summary USING GIST(center_point);

-- Refresh nightly (add to cron job)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY property_stats_summary;
```

```typescript
// src/app/api/stats/[state]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: { state: string } }
) {
  const state = params.state.toUpperCase();
  
  const result = await pool.query(`
    SELECT 
      city,
      total_properties,
      active_listings,
      avg_price,
      median_price,
      ST_Y(center_point) as latitude,
      ST_X(center_point) as longitude
    FROM property_stats_summary
    WHERE state = $1
    ORDER BY total_properties DESC
    LIMIT 20
  `, [state]);
  
  return NextResponse.json({
    state,
    cities: result.rows
  }, {
    headers: {
      'Cache-Control': 'public, max-age=3600'  // 1 hour - stats change slowly
    }
  });
}
```

### 2.4 Production Monitoring & Observability (Day 9-10)

#### 2.4a Comprehensive Metrics Collection

```typescript
// src/lib/monitoring.ts
import { redis } from './cache';

export interface TileMetrics {
  tile_type: 'clusters' | 'properties';
  zoom: number;
  response_time_ms: number;
  db_time_ms?: number;
  result_count: number;
  cache_hit: boolean;
  filters_applied: number;
  user_agent?: string;
  error?: string;
}

export interface HealthMetrics {
  database: {
    connected: boolean;
    active_connections: number;
    max_connections: number;
    avg_query_time_ms: number;
  };
  cache: {
    connected: boolean;
    hit_rate: number;
    memory_used_mb: number;
    keys: number;
  };
  application: {
    uptime_seconds: number;
    memory_used_mb: number;
    cpu_usage_percent: number;
  };
}

class MetricsCollector {
  private metrics: TileMetrics[] = [];
  private readonly maxBufferSize = 1000;
  private readonly flushIntervalMs = 60000; // 1 minute
  
  constructor() {
    // Auto-flush metrics periodically
    setInterval(() => this.flush(), this.flushIntervalMs);
  }
  
  record(metric: TileMetrics) {
    this.metrics.push({
      ...metric,
      timestamp: Date.now()
    } as any);
    
    // Log slow requests immediately
    if (metric.response_time_ms > 1000) {
      console.warn('🐌 SLOW REQUEST', {
        type: metric.tile_type,
        zoom: metric.zoom,
        duration: metric.response_time_ms,
        cached: metric.cache_hit
      });
    }
    
    // Flush if buffer full
    if (this.metrics.length >= this.maxBufferSize) {
      this.flush();
    }
  }
  
  async flush() {
    if (this.metrics.length === 0) return;
    
    const toFlush = [...this.metrics];
    this.metrics = [];
    
    // Calculate aggregates
    const stats = this.calculateStats(toFlush);
    
    console.log('📊 Metrics Summary (last minute):', {
      total_requests: toFlush.length,
      cache_hit_rate: `${(stats.cacheHitRate * 100).toFixed(1)}%`,
      p50_response_time: `${stats.p50}ms`,
      p95_response_time: `${stats.p95}ms`,
      p99_response_time: `${stats.p99}ms`,
      errors: stats.errorCount
    });
    
    // TODO: Send to your monitoring service (Datadog, New Relic, etc.)
    // await sendToMonitoringService(stats);
  }
  
  private calculateStats(metrics: any[]) {
    const responseTimes = metrics
      .map(m => m.response_time_ms)
      .sort((a, b) => a - b);
    
    const cacheHits = metrics.filter(m => m.cache_hit).length;
    const errors = metrics.filter(m => m.error).length;
    
    return {
      totalRequests: metrics.length,
      cacheHitRate: cacheHits / metrics.length,
      p50: this.percentile(responseTimes, 0.5),
      p95: this.percentile(responseTimes, 0.95),
      p99: this.percentile(responseTimes, 0.99),
      errorCount: errors,
      errorRate: errors / metrics.length
    };
  }
  
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[index] || 0;
  }
  
  async getHealthMetrics(): Promise<HealthMetrics> {
    // Database health
    const dbHealth = await pool.query(`
      SELECT 
        count(*) as active,
        current_setting('max_connections')::int as max_conn
      FROM pg_stat_activity
      WHERE state = 'active'
    `);
    
    const avgQueryTime = await pool.query(`
      SELECT COALESCE(AVG(mean_exec_time), 0)::numeric(10,2) as avg_time
      FROM pg_stat_statements
      WHERE query NOT LIKE '%pg_stat%'
      LIMIT 100
    `);
    
    // Cache health
    const cacheStats = await redis.info('stats');
    const cacheMemory = await redis.info('memory');
    
    const hits = parseInt(cacheStats.match(/keyspace_hits:(\d+)/)?.[1] || '0');
    const misses = parseInt(cacheStats.match(/keyspace_misses:(\d+)/)?.[1] || '0');
    const hitRate = (hits + misses) > 0 ? hits / (hits + misses) : 0;
    
    const memoryUsed = cacheMemory.match(/used_memory:(\d+)/)?.[1] || '0';
    const keys = await redis.dbSize();
    
    return {
      database: {
        connected: true,
        active_connections: dbHealth.rows[0].active,
        max_connections: dbHealth.rows[0].max_conn,
        avg_query_time_ms: parseFloat(avgQueryTime.rows[0].avg_time)
      },
      cache: {
        connected: true,
        hit_rate: Math.round(hitRate * 100) / 100,
        memory_used_mb: parseInt(memoryUsed) / 1024 / 1024,
        keys
      },
      application: {
        uptime_seconds: process.uptime(),
        memory_used_mb: process.memoryUsage().heapUsed / 1024 / 1024,
        cpu_usage_percent: process.cpuUsage().user / 1000000 // Simplified
      }
    };
  }
}

export const metricsCollector = new MetricsCollector();
```

#### 2.4b Health Check Endpoint

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { metricsCollector } from '@/lib/monitoring';
import { redis } from '@/lib/cache';
import { pool } from '@/lib/db';

export async function GET() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {} as any
  };
  
  try {
    // Database check
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    health.checks.database = {
      status: 'healthy',
      response_time_ms: Date.now() - dbStart
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.checks.database = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
  
  try {
    // Redis check
    const redisStart = Date.now();
    await redis.ping();
    health.checks.cache = {
      status: 'healthy',
      response_time_ms: Date.now() - redisStart
    };
  } catch (error) {
    health.status = 'degraded';  // Cache failure is not critical
    health.checks.cache = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
  
  // Get detailed metrics
  try {
    health.metrics = await metricsCollector.getHealthMetrics();
  } catch (error) {
    console.error('Failed to get health metrics:', error);
  }
  
  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 200 : 503;
  
  return NextResponse.json(health, { status: statusCode });
}
```

#### 2.4c Alert Thresholds & Monitoring

```typescript
// src/lib/alerts.ts
export const ALERT_THRESHOLDS = {
  response_time: {
    warning: 500,   // ms
    critical: 1000  // ms
  },
  cache_hit_rate: {
    warning: 0.60,   // 60%
    critical: 0.40   // 40%
  },
  error_rate: {
    warning: 0.01,   // 1%
    critical: 0.05   // 5%
  },
  database_connections: {
    warning: 0.70,   // 70% of max
    critical: 0.90   // 90% of max
  }
};

export async function checkAlerts(metrics: any) {
  const alerts: string[] = [];
  
  // Check response time
  if (metrics.p95 > ALERT_THRESHOLDS.response_time.critical) {
    alerts.push(`🚨 CRITICAL: P95 response time ${metrics.p95}ms`);
  } else if (metrics.p95 > ALERT_THRESHOLDS.response_time.warning) {
    alerts.push(`⚠️  WARNING: P95 response time ${metrics.p95}ms`);
  }
  
  // Check cache hit rate
  if (metrics.cacheHitRate < ALERT_THRESHOLDS.cache_hit_rate.critical) {
    alerts.push(`🚨 CRITICAL: Cache hit rate ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
  } else if (metrics.cacheHitRate < ALERT_THRESHOLDS.cache_hit_rate.warning) {
    alerts.push(`⚠️  WARNING: Cache hit rate ${(metrics.cacheHitRate * 100).toFixed(1)}%`);
  }
  
  // Check error rate
  if (metrics.errorRate > ALERT_THRESHOLDS.error_rate.critical) {
    alerts.push(`🚨 CRITICAL: Error rate ${(metrics.errorRate * 100).toFixed(1)}%`);
  } else if (metrics.errorRate > ALERT_THRESHOLDS.error_rate.warning) {
    alerts.push(`⚠️  WARNING: Error rate ${(metrics.errorRate * 100).toFixed(1)}%`);
  }
  
  // Send alerts if any
  if (alerts.length > 0) {
    console.error('ALERTS TRIGGERED:', alerts);
    // TODO: Send to PagerDuty, Slack, email, etc.
  }
  
  return alerts;
}
```

### 2.5 Rate Limiting & Security (Day 10)

#### 2.5a API Rate Limiting

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { redis } from '@/lib/cache';

const RATE_LIMITS = {
  anonymous: {
    requests: 100,
    window: 60  // 100 requests per 60 seconds
  },
  authenticated: {
    requests: 1000,
    window: 60  // 1000 requests per 60 seconds
  }
};

export async function middleware(request: NextRequest) {
  // Only rate limit API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  
  // Get client identifier (IP or user ID)
  const clientId = request.headers.get('x-forwarded-for') || 
                   request.ip ||
                   'unknown';
  
  // Check if authenticated (example - adjust to your auth)
  const isAuthenticated = !!request.cookies.get('auth_token');
  
  const limit = isAuthenticated 
    ? RATE_LIMITS.authenticated 
    : RATE_LIMITS.anonymous;
  
  const key = `ratelimit:${clientId}:${Math.floor(Date.now() / 1000 / limit.window)}`;
  
  try {
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, limit.window);
    }
    
    if (current > limit.requests) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded',
          retry_after: limit.window 
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.requests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': (Math.floor(Date.now() / 1000) + limit.window).toString(),
            'Retry-After': limit.window.toString()
          }
        }
      );
    }
    
    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', limit.requests.toString());
    response.headers.set('X-RateLimit-Remaining', (limit.requests - current).toString());
    
    return response;
    
  } catch (error) {
    // If Redis is down, allow request through (fail open)
    console.error('Rate limiting error:', error);
    return NextResponse.next();
  }
}

export const config = {
  matcher: '/api/:path*',
};
```

#### 2.5b SQL Injection Prevention Checklist

✅ **Implemented in Phase 1:**

- [x] Parameterized queries (no string concatenation)
- [x] Zod schema validation
- [x] Type coercion for numbers

✅ **Additional Phase 2 hardening:**

```typescript
// src/lib/security.ts
import { z } from 'zod';

/**
 * Sanitize user input to prevent even edge-case injections
 */
export function sanitizeSearchTerm(term: string): string {
  // Remove any SQL keywords and special characters
  return term
    .replace(/[;'"\\]/g, '')  // Remove dangerous characters
    .replace(/--/g, '')        // Remove SQL comments
    .replace(/\/\*/g, '')      // Remove block comments
    .trim()
    .slice(0, 100);            // Limit length
}

/**
 * Validate bounding box makes geographic sense
 */
export const BoundingBoxSchema = z.object({
  north: z.number().min(-90).max(90),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  west: z.number().min(-180).max(180),
}).refine(
  (data) => data.north > data.south,
  { message: 'North must be greater than South' }
).refine(
  (data) => {
    // Handle international date line crossing
    if (data.east < data.west) {
      return (data.east + 360) - data.west <= 360;
    }
    return data.east - data.west <= 360;
  },
  { message: 'Invalid bounding box' }
);

/**
 * Detect potential SQL injection attempts
 */
export function detectSQLInjection(input: string): boolean {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/i,
    /(UNION.*SELECT)/i,
    /(OR\s+1\s*=\s*1)/i,
    /(';|--;|\/\*|\*\/)/,
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(input));
}

/**
 * Log potential security incidents
 */
export async function logSecurityEvent(event: {
  type: 'sql_injection_attempt' | 'xss_attempt' | 'invalid_input';
  ip: string;
  userAgent: string;
  input: string;
  endpoint: string;
}) {
  console.error('🚨 SECURITY EVENT', {
    ...event,
    timestamp: new Date().toISOString()
  });
  
  // TODO: Send to security monitoring service
  // await sendToSecurityService(event);
}
```

### 2.6 Phase 2 Validation Checklist

**Before proceeding to Phase 3, verify:**

**Performance Metrics:**

- [ ] Response times: p95 < 200ms (cached), p95 < 500ms (uncached)
- [ ] Cache hit rate > 70%
- [ ] Database CPU < 50% under normal load
- [ ] Memory usage stable (no leaks)

**Functional Requirements:**

- [ ] Handles 10M+ properties without degradation
- [ ] Complex filters work correctly
- [ ] Rate limiting blocks excessive requests
- [ ] Health checks return accurate status

**Infrastructure:**

- [ ] Redis replication configured (if production)
- [ ] Database backups running
- [ ] CDN delivering cached responses
- [ ] Monitoring dashboard showing metrics

**Security:**

- [ ] SQL injection tests pass
- [ ] Rate limiting tested and working
- [ ] No sensitive data in logs
- [ ] HTTPS enforced

**Load Testing Results:**

```bash
k6 run load-test-phase2.js
```

```javascript
// load-test-phase2.js - Extended version
export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '5m', target: 200 },   // Phase 2 should handle 200 concurrent users
    { duration: '2m', target: 500 },   // Spike test
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],  // Still sub-500ms at p95
    'http_req_duration{cached:true}': ['p(95)<200'],  // Cached responses < 200ms
    'errors': ['rate<0.05'],             // Error rate < 5%
  },
};

// ... test logic similar to Phase 1 ...
```

### Expected Phase 2 Results

|Metric                 |Phase 1   |Phase 2           |Improvement         |
|-----------------------|----------|------------------|--------------------|
|Dataset Capacity       |1-5M      |10M+              |**2x scale**        |
|Avg Response (cached)  |N/A       |50-100ms          |**5x faster**       |
|Avg Response (uncached)|200-400ms |150-300ms         |**25% faster**      |
|Cache Hit Rate         |0%        |70-85%            |**New capability**  |
|Concurrent Users       |50-100    |200-500           |**4x capacity**     |
|Infrastructure Cost    |$200/mo   |$350-450/mo       |See cost section    |
|Monitoring             |Basic logs|Full observability|**Production-ready**|

-----

## <a name="phase-3"></a>Phase 3: Vector Tile Architecture (When to Implement)

### Decision: When to Move to Phase 3

**✅ Implement Phase 3 when you hit ANY of these triggers:**

1. **Dataset > 20M properties** - Phase 2 will start degrading
1. **Response times consistently > 500ms** even with full cache
1. **Mobile app launch** - MVT is 5-10x smaller than GeoJSON
1. **International expansion** - Need extreme efficiency
1. **Advanced visualizations** - Heatmaps, 3D density, animations
1. **Serving 10k+ concurrent users**

**❌ Don’t implement Phase 3 if:**

- Phase 2 performance is acceptable
- Dataset < 10M properties
- Team bandwidth is limited
- No imminent need for advanced features

### Phase 3 Overview (High-Level)

**Core Changes:**

1. **Deploy Martin Tile Server** - Dedicated service for MVT generation
1. **Switch to Binary Protocol Buffers** - 5-10x smaller than GeoJSON
1. **Migrate Frontend to MapLibre GL** - WebGL rendering for 60fps
1. **Implement Vector Tile Caching** - Pre-generate popular tiles

**Expected Benefits:**

- Tile sizes: 50-200KB (GeoJSON) → 5-20KB (MVT)
- Support 50M+ properties
- Sub-100ms tile loads
- Advanced visualizations (heatmaps, 3D, clustering animations)

**Implementation Time:** 2-3 weeks for full migration

**Architecture Diagram:**

```
┌─────────────┐
│   Browser   │
│  (MapLibre) │
└──────┬──────┘
       │ Request: /tiles/{z}/{x}/{y}?filters=...
       ▼
┌──────────────┐
│     CDN      │ ← Cache MVT tiles at edge
│ (CloudFront) │
└──────┬───────┘
       │ Cache Miss
       ▼
┌──────────────┐
│    Martin    │ ← Tile server (Rust)
│ Tile Server  │
└──────┬───────┘
       │ ST_AsMVT()
       ▼
┌──────────────┐
│  PostgreSQL  │ ← Generate MVT directly
│   + PostGIS  │
└──────────────┘
```

**Key Technologies:**

- **Martin** - Fast Rust-based tile server
- **MapLibre GL JS** - WebGL map renderer
- **MVT Protocol Buffers** - Binary vector tile format

### Phase 3 Implementation Approach

**We recommend a phased rollout:**

**Week 1:** Setup & Testing

- Deploy Martin in staging
- Create MVT functions in database
- Build proof-of-concept with MapLibre

**Week 2:** Parallel Running

- Run both GeoJSON (Phase 2) and MVT (Phase 3) APIs
- A/B test with 10% of users
- Measure performance improvements

**Week 3:** Migration & Optimization

- Gradually shift traffic to MVT
- Optimize tile generation performance
- Deprecate GeoJSON API

### Sample Martin Configuration

```yaml
# martin-config.yaml
postgres:
  connection_string: ${DATABASE_URL}
  pool_size: 20
  
  # Function-based tile generation
  functions:
    properties_mvt:
      schema: public
      function: get_properties_mvt
      minzoom: 0
      maxzoom: 16
      
# Tile caching
cache:
  type: redis
  connection_string: ${REDIS_URL}
  ttl: 300

# Server config
server:
  port: 3000
  worker_processes: 4
  keep_alive: 60
```

### Sample MVT Generation Function

```sql
CREATE OR REPLACE FUNCTION get_properties_mvt(
  z integer,
  x integer,
  y integer,
  query_params jsonb DEFAULT '{}'::jsonb
)
RETURNS bytea AS $$
DECLARE
  bbox geometry;
  mvt bytea;
BEGIN
  bbox := ST_TileEnvelope(z, x, y);
  
  -- Generate MVT using ST_AsMVT aggregate
  SELECT INTO mvt ST_AsMVT(tile, 'properties', 4096, 'geom')
  FROM (
    SELECT
      ST_AsMVTGeom(
        geom,
        bbox,
        4096,
        256,
        true
      ) AS geom,
      id,
      price,
      bedrooms,
      status
    FROM properties
    WHERE geom && bbox
      AND (query_params->>'minPrice' IS NULL 
           OR price >= (query_params->>'minPrice')::numeric)
    LIMIT 5000
  ) AS tile
  WHERE geom IS NOT NULL;
  
  RETURN mvt;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
```

### Frontend Migration Example

```typescript
// Before (Phase 2): react-map-gl with GeoJSON
import Map, { Marker } from 'react-map-gl';

// After (Phase 3): MapLibre with vector tiles
import maplibregl from 'maplibre-gl';

useEffect(() => {
  const map = new maplibregl.Map({
    container: 'map',
    style: 'basemap-style.json',
  });
  
  map.on('load', () => {
    map.addSource('properties', {
      type: 'vector',
      tiles: ['http://martin-server/rpc/properties_mvt/{z}/{x}/{y}'],
    });
    
    map.addLayer({
      id: 'property-circles',
      type: 'circle',
      source: 'properties',
      'source-layer': 'properties',
      paint: {
        'circle-radius': 6,
        'circle-color': '#4264fb',
      }
    });
  });
}, []);
```

**When you’re ready for Phase 3, refer to the original research document (RealEstateMapAppPerformance.md) for complete implementation details.**

-----

## <a name="security"></a>Appendix A: Security Hardening Checklist

### Critical Security Controls

#### 1. Input Validation (✅ Implemented in Phase 1 & 2)

- [x] Zod schemas for all API parameters
- [x] Parameterized SQL queries
- [x] Type coercion before database queries
- [x] Bounding box validation
- [x] Maximum result limits enforced

#### 2. Rate Limiting (✅ Implemented in Phase 2)

- [x] Per-IP rate limiting
- [x] Different limits for auth/unauth users
- [x] Exponential backoff on repeated violations
- [x] Rate limit headers in responses

#### 3. Authentication & Authorization (To Implement)

```typescript
// Example: JWT-based auth
import jwt from 'jsonwebtoken';

export function authenticateRequest(request: NextRequest): {
  authenticated: boolean;
  userId?: string;
} {
  const token = request.cookies.get('auth_token')?.value;
  
  if (!token) {
    return { authenticated: false };
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return {
      authenticated: true,
      userId: decoded.userId
    };
  } catch {
    return { authenticated: false };
  }
}
```

#### 4. CORS Configuration

```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'https://yourdomain.com' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};
```

#### 5. Environment Variable Security

```bash
# .env.example (commit this)
DB_HOST=localhost
DB_NAME=realestatedb
DB_USER=
DB_PASSWORD=
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_MAPBOX_TOKEN=
JWT_SECRET=

# .env (DO NOT commit)
DB_PASSWORD=actual_secure_password_here
JWT_SECRET=actual_secret_here
```

#### 6. Secrets Management (Production)

```typescript
// Use AWS Secrets Manager, GCP Secret Manager, or similar
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });

export async function getDatabasePassword(): Promise<string> {
  const command = new GetSecretValueCommand({
    SecretId: 'prod/db/password'
  });
  
  const response = await client.send(command);
  return response.SecretString!;
}
```

#### 7. Security Headers

```typescript
// middleware.ts additions
export function addSecurityHeaders(response: NextResponse) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://api.mapbox.com; style-src 'self' 'unsafe-inline';"
  );
  
  return response;
}
```

-----

## <a name="mobile"></a>Appendix B: Mobile Optimization Guide

### Mobile Performance Strategies

#### 1. Adaptive Quality Based on Device

```typescript
// src/lib/device-detection.ts
export interface DeviceCapabilities {
  isMobile: boolean;
  isLowEnd: boolean;
  connectionSpeed: 'slow' | 'medium' | 'fast';
  supportsWebGL: boolean;
}

export function detectDeviceCapabilities(): DeviceCapabilities {
  const isMobile = /Android|webOS|iPhone|iPad/i.test(navigator.userAgent);
  
  // Detect low-end device (rough heuristic)
  const memory = (navigator as any).deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 2;
  const isLowEnd = memory <= 2 || cores <= 2;
  
  // Network connection
  const connection = (navigator as any).connection;
  const effectiveType = connection?.effectiveType || '4g';
  const connectionSpeed = effectiveType === '4g' ? 'fast' :
                         effectiveType === '3g' ? 'medium' : 'slow';
  
  // WebGL support
  const canvas = document.createElement('canvas');
  const supportsWebGL = !!(
    canvas.getContext('webgl') || 
    canvas.getContext('experimental-webgl')
  );
  
  return {
    isMobile,
    isLowEnd,
    connectionSpeed,
    supportsWebGL
  };
}

export function getOptimalSettings(capabilities: DeviceCapabilities) {
  if (capabilities.isLowEnd || capabilities.connectionSpeed === 'slow') {
    return {
      maxPropertiesPerTile: 500,
      clusteringThreshold: 12,  // Start clustering at zoom 12
      enableAnimations: false,
      imageQuality: 'low',
      debounceTime: 800
    };
  }
  
  if (capabilities.isMobile) {
    return {
      maxPropertiesPerTile: 1000,
      clusteringThreshold: 14,
      enableAnimations: true,
      imageQuality: 'medium',
      debounceTime: 500
    };
  }
  
  // Desktop
  return {
    maxPropertiesPerTile: 2000,
    clusteringThreshold: 16,
    enableAnimations: true,
    imageQuality: 'high',
    debounceTime: 300
  };
}
```

#### 2. Touch-Friendly UI

```typescript
// Minimum touch target size: 44x44px (Apple HIG)
const ClusterMarker = ({ count, price }: { count: number; price: number }) => (
  <div 
    className="cluster-marker"
    style={{
      minWidth: '44px',
      minHeight: '44px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      backgroundColor: '#4264fb',
      color: 'white',
      fontWeight: 'bold',
      cursor: 'pointer',
      // Prevent text selection on touch
      userSelect: 'none',
      WebkitUserSelect: 'none',
      // Prevent callout on long-press
      WebkitTouchCallout: 'none'
    }}
  >
    {count}
  </div>
);
```

#### 3. Reduced Motion Support

```typescript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// In map configuration
<Map
  {...viewState}
  onMove={evt => setViewState(evt.viewState)}
  // Disable smooth transitions if user prefers reduced motion
  transitionDuration={prefersReducedMotion ? 0 : 300}
/>
```

#### 4. Offline Support (PWA)

```typescript
// public/service-worker.js
const CACHE_NAME = 'realestate-v1';
const urlsToCache = [
  '/',
  '/static/css/main.css',
  '/static/js/main.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  // Cache-first strategy for static assets
  if (event.request.url.includes('/static/')) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => response || fetch(event.request))
    );
  }
  
  // Network-first for API calls
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
  }
});
```

#### 5. Battery Optimization

```typescript
// Pause expensive operations when battery is low
let batteryOptimizationMode = false;

if ('getBattery' in navigator) {
  (navigator as any).getBattery().then((battery: any) => {
    const updateBatteryMode = () => {
      batteryOptimizationMode = battery.level < 0.2 && !battery.charging;
      
      if (batteryOptimizationMode) {
        console.log('📱 Low battery detected - enabling optimization mode');
        // Increase debounce time
        // Reduce tile quality
        // Disable animations
      }
    };
    
    battery.addEventListener('levelchange', updateBatteryMode);
    battery.addEventListener('chargingchange', updateBatteryMode);
    updateBatteryMode();
  });
}
```

-----

## <a name="costs"></a>Appendix C: Infrastructure Cost Analysis

### Monthly Cost Breakdown by Phase

#### Phase 1: Emergency Fix

|Service               |Tier                         |Monthly Cost      |Notes             |
|----------------------|-----------------------------|------------------|------------------|
|**PostgreSQL**        |RDS db.t3.large (2 vCPU, 8GB)|$120-150          |Can start smaller |
|**Application Server**|ECS Fargate (2 vCPU, 4GB)    |$60-80            |Or EC2 t3.medium  |
|**Data Transfer**     |100GB/month                  |$10-20            |Depends on traffic|
|**Backups**           |100GB snapshots              |$10               |Daily automated   |
|**Total Phase 1**     |                             |**$200-260/month**|Minimal viable    |

#### Phase 2: Growth Infrastructure

|Service               |Tier                          |Monthly Cost      |Notes                   |
|----------------------|------------------------------|------------------|------------------------|
|**PostgreSQL**        |RDS db.r5.large (2 vCPU, 16GB)|$250-300          |Need more memory        |
|**Redis**             |ElastiCache t3.medium         |$50-70            |3.09GB memory           |
|**Application Server**|ECS Fargate (4 vCPU, 8GB)     |$120-150          |Scaled up               |
|**CDN**               |CloudFront                    |$30-80            |Depends on traffic      |
|**Data Transfer**     |500GB/month                   |$40-60            |Growing traffic         |
|**Monitoring**        |CloudWatch/Datadog            |$50-100           |Production observability|
|**Backups**           |200GB snapshots               |$20               |Growing data            |
|**Total Phase 2**     |                              |**$560-780/month**|Production-ready        |

#### Phase 3: Vector Tiles at Scale

|Service               |Tier                           |Monthly Cost          |Notes              |
|----------------------|-------------------------------|----------------------|-------------------|
|**PostgreSQL**        |RDS db.r5.xlarge (4 vCPU, 32GB)|$500-600              |Large dataset      |
|**Redis**             |ElastiCache r5.large           |$150-180              |More cache memory  |
|**Martin Tile Server**|ECS Fargate (4 vCPU, 8GB)      |$120-150              |Dedicated service  |
|**Application Server**|ECS Fargate (4 vCPU, 8GB)      |$120-150              |Main app           |
|**CDN**               |CloudFront                     |$100-200              |Heavy tile traffic |
|**Data Transfer**     |2TB/month                      |$150-200              |International users|
|**Monitoring**        |Datadog Pro                    |$100-150              |Advanced features  |
|**Backups**           |500GB snapshots                |$50                   |Large database     |
|**Total Phase 3**     |                               |**$1,290-1,680/month**|Enterprise scale   |

### Cost Optimization Strategies

#### 1. Reserved Instances

```
Annual savings by committing 1-year:
- RDS Reserved: 30-40% savings
- EC2/Fargate Reserved: 30-50% savings

Example:
Phase 2 RDS db.r5.large:
- On-demand: $300/month = $3,600/year
- 1-year reserved: $2,300/year
- Savings: $1,300/year (36%)
```

#### 2. Spot Instances for Non-Critical Workloads

```typescript
// Use Spot for batch jobs (scraping, processing)
const spotConfig = {
  maxPrice: '0.05',  // 70% cheaper than on-demand
  instanceTypes: ['t3.large', 't3a.large'],
  // For scraping 1M properties every 3 days
  estimatedSavings: '~$100/month'
};
```

#### 3. Database Query Optimization Reduces Costs

```
Better indexes = Smaller instance needed:
- Before optimization: db.r5.xlarge ($600/mo)
- After optimization: db.r5.large ($300/mo)
- Savings: $300/month = $3,600/year
```

#### 4. CDN vs Origin Traffic

```
CloudFront pricing (simplified):
- Origin traffic: $0.085/GB (first 10TB)
- CloudFront edge: $0.085/GB (first 10TB)

But CDN reduces origin load:
- 90% cache hit rate = 90% less DB/server load
- Can use smaller RDS instance
- Net savings despite CDN cost
```

### Cost Triggers & Scaling

|If this happens…        |Then do this…                |Impact                |
|------------------------|-----------------------------|----------------------|
|DB CPU > 70% sustained  |Upgrade to next instance size|+$150-300/mo          |
|Cache hit rate < 50%    |Increase Redis memory        |+$50-100/mo           |
|CDN costs > $200/mo     |Review caching strategy      |Potential savings     |
|Dataset > 20M properties|Consider table partitioning  |May avoid upgrade     |
|International users     |Add regional CDN POPs        |+$50-100/mo per region|

-----

## <a name="monitoring"></a>Appendix D: Monitoring Dashboard Specifications

### Key Metrics to Track

#### 1. Application Performance

```
Dashboard 1: API Performance
- P50, P95, P99 response times (line chart)
- Error rate percentage (gauge)
- Requests per second (counter)
- Cache hit rate (pie chart)
- Top 10 slowest endpoints (table)

Alerts:
- P95 > 500ms for 5 minutes
- Error rate > 5% for 2 minutes
- Cache hit rate < 60% for 10 minutes
```

#### 2. Database Health

```
Dashboard 2: Database Performance
- Active connections vs max (gauge)
- Query execution time (histogram)
- Cache hit ratio (percentage)
- Deadlocks per minute (counter)
- Table sizes and growth (trend)
- Index usage statistics (table)

Alerts:
- Connections > 90% of max
- Avg query time > 100ms
- Deadlocks > 5/minute
```

#### 3. Infrastructure

```
Dashboard 3: Infrastructure
- CPU usage per service (line charts)
- Memory usage per service (line charts)
- Disk I/O (bytes read/write)
- Network traffic (in/out)
- Container restart count (counter)

Alerts:
- CPU > 80% for 10 minutes
- Memory > 85% for 5 minutes
- Disk space < 20%
```

#### 4. Business Metrics

```
Dashboard 4: User Experience
- Active users (real-time)
- Map interactions per session (avg)
- Properties viewed per session (avg)
- Search conversion rate (funnel)
- Mobile vs desktop split (pie)
- Geographic distribution (map)

Alerts:
- Active users drops > 30%
- Conversion rate drops > 20%
```

### Sample Monitoring Stack

```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    ports:
      - "9090:9090"
      
  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana-dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      
  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"

volumes:
  prometheus-data:
  grafana-data:
```

-----

## <a name="decisions"></a>Appendix E: Go/No-Go Decision Framework

### Phase 1 → Phase 2 Decision

**✅ Proceed to Phase 2 if:**

- [x] Phase 1 validation checklist 100% complete
- [x] Dataset approaching 3-5M properties OR
- [x] Adding 500k+ properties per week OR
- [x] Response times > 300ms consistently OR
- [x] Planning advanced features (user accounts, saved searches)

**⚠️ Pause and optimize Phase 1 if:**

- [ ] Response times acceptable (< 300ms p95)
- [ ] Dataset stable < 2M properties
- [ ] No immediate growth expected
- [ ] Team bandwidth limited

**❌ Rollback Phase 1 if:**

- [ ] Error rate > 10% after deployment
- [ ] User complaints increased > 50%
- [ ] Database crashes or corruption
- [ ] Performance worse than baseline

### Phase 2 → Phase 3 Decision

**✅ Proceed to Phase 3 if:**

- [x] Dataset > 15-20M properties OR
- [x] Response times > 500ms even with 80%+ cache hit rate OR
- [x] Mobile app in development OR
- [x] Need advanced viz (heatmaps, 3D) OR
- [x] International expansion planned

**⚠️ Stay in Phase 2 if:**

- [ ] All performance metrics acceptable
- [ ] Dataset < 10M properties
- [ ] Cache hit rate > 70%
- [ ] No mobile app needed
- [ ] Team prefers incremental improvements

**❌ Don’t proceed to Phase 3 if:**

- [ ] Phase 2 not fully validated
- [ ] No frontend developer with WebGL experience
- [ ] Infrastructure team can’t support another service
- [ ] Budget constraints

### Emergency Rollback Decision Tree

```
Performance degradation detected
    ↓
Is error rate > 20%?
    ├─ YES → IMMEDIATE ROLLBACK
    └─ NO → Continue
         ↓
    Are users complaining?
         ├─ YES → Assess severity
         │        ├─ Critical (can't use app) → ROLLBACK
         │        └─ Minor (slower) → Monitor & optimize
         └─ NO → Monitor for 24 hours
                   ↓
              Metrics improving?
                   ├─ YES → Continue
                   └─ NO → Plan rollback
```

### Rollback Procedures

#### Rollback Phase 2 to Phase 1

```bash
# 1. Stop using Redis cache (fails safe)
export REDIS_URL=""

# 2. Remove CDN layer
# Update DNS to point directly to origin

# 3. Revert API route to Phase 1 version
git revert <phase-2-commit-hash>
npm run build
npm run deploy

# 4. Monitor recovery
curl https://yoursite.com/api/health
```

#### Rollback Phase 3 to Phase 2

```bash
# 1. Switch frontend back to GeoJSON API
# Update environment variable
export TILE_API_URL="https://yoursite.com/api/properties/viewport"

# 2. Stop Martin service
docker stop martin

# 3. Monitor traffic shifting back

# 4. Can keep Martin running in parallel for A/B testing
```

-----

## Quick Reference: Command Cheat Sheet

### Database Maintenance

```bash
# Check geometry coverage
psql -c "SELECT * FROM property_geom_health;"

# Refresh materialized views
psql -c "REFRESH MATERIALIZED VIEW CONCURRENTLY property_stats_summary;"

# Check index usage
psql -c "SELECT schemaname, tablename, indexname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0;"

# Analyze query performance
psql -c "SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Database size
psql -c "SELECT pg_size_pretty(pg_database_size('realestatedb'));"
```

### Redis Management

```bash
# Check cache stats
redis-cli INFO stats | grep keyspace

# Check memory usage
redis-cli INFO memory | grep used_memory_human

# Clear all cache (careful!)
redis-cli FLUSHALL

# Check specific key
redis-cli GET "tile:12:abc123"

# Monitor commands in real-time
redis-cli MONITOR
```

### Performance Testing

```bash
# Run load test
k6 run load-test.js

# Run specific scenario
k6 run --vus 100 --duration 30s load-test.js

# Run with ramping
k6 run --stage 2m:50,5m:100,2m:0 load-test.js

# Generate HTML report
k6 run --out json=results.json load-test.js
k6 report results.json --output report.html
```

### Monitoring

```bash
# Check API health
curl https://yoursite.com/api/health | jq

# Get cache statistics
curl https://yoursite.com/api/cache/stats | jq

# Check specific tile performance
curl -w "@curl-format.txt" "https://yoursite.com/api/properties/viewport?north=40&south=39&east=-95&west=-96&zoom=12"

# Monitor logs in real-time
docker logs -f --tail 100 app

# Check resource usage
docker stats
```

-----

## Summary: Your Implementation Roadmap

### Week 1: Phase 1 - Make It Work

- **Day 0:** Capture baselines
- **Day 1:** PostGIS setup, add geometry column, create indexes
- **Day 2-3:** Implement viewport API with security
- **Day 4:** Validation and testing
- **Result:** 1.2M properties usable, < 3s load time

### Week 2-3: Phase 2 - Make It Scale

- **Day 5-6:** Redis caching + CDN
- **Day 7-8:** Database optimization, partitioning
- **Day 9-10:** Monitoring, rate limiting, security hardening
- **Result:** Ready for 10M+ properties, < 200ms cached responses

### Month 2+: Phase 3 - Make It Fly (When Needed)

- **Week 1:** Martin setup, MVT functions
- **Week 2:** Frontend migration to MapLibre
- **Week 3:** Optimization and rollout
- **Result:** 50M+ properties, sub-100ms tiles, advanced visualizations

-----

## Final Checklist Before Production

**Infrastructure:**

- [ ] Database backups configured (daily)
- [ ] Redis persistence enabled
- [ ] CDN configured and tested
- [ ] Health checks working
- [ ] Monitoring dashboards created
- [ ] Alerts configured with PagerDuty/Slack

**Security:**

- [ ] Rate limiting active
- [ ] HTTPS enforced
- [ ] CORS configured correctly
- [ ] SQL injection tests pass
- [ ] Secrets in environment variables (not code)
- [ ] Security headers enabled

**Performance:**

- [ ] Load testing passed (200+ concurrent users)
- [ ] Cache hit rate > 70%
- [ ] P95 response time < 500ms
- [ ] No memory leaks detected
- [ ] Mobile performance tested on real devices

**Operations:**

- [ ] Rollback procedure documented
- [ ] On-call rotation established
- [ ] Runbooks created
- [ ] Cost monitoring enabled
- [ ] Capacity planning done (next 6 months)

-----

**You now have a complete, production-ready plan to scale from 1.2M to 50M+ properties. Start with Phase 1 this week, move to Phase 2 within a month, and only implement Phase 3 when you truly need it. Good luck! 🚀**