import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getWalkScore } from '@/lib/walkscore';

export const revalidate = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || isNaN(Number(id))) {
    return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
  }

  // 1. Look up the listing
  const listingRes = await pool.query(
    `SELECT id, latitude, longitude, zip_code, census_tract, fips_code, address, nearby_schools
     FROM listings WHERE id = $1`,
    [id],
  );

  if (listingRes.rows.length === 0) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 });
  }

  const listing = listingRes.rows[0];
  const lat = listing.latitude != null ? Number(listing.latitude) : null;
  const lng = listing.longitude != null ? Number(listing.longitude) : null;
  const zipCode: string | null = listing.zip_code;
  const censusTract: string | null = listing.census_tract;
  const fipsCode: string | null = listing.fips_code;
  const address: string | null = listing.address;

  // County FIPS: first 5 digits of census_tract or fips_code column
  const countyFips = fipsCode ?? (censusTract ? censusTract.slice(0, 5) : null);
  // Tract FIPS for join: census_tract column may be 11-char block-group prefix
  const tractGeoid = censusTract ? censusTract.slice(0, 11) : null;

  if (lat == null || lng == null) {
    return NextResponse.json({ error: 'Property has no coordinates' }, { status: 400 });
  }

  // 2. Parallel sub-source queries — each wrapped in its own try/catch
  const [
    riskNri,
    riskFlood,
    riskDisasters,
    riskParcelSfha,
    neighborhoodWalkability,
    neighborhoodWalkscore,
    neighborhoodTransit,
    neighborhoodSchools,
    neighborhoodCrime,
    marketHpi,
    marketUnemployment,
  ] = await Promise.all([
    // ── Risk: NRI scores via census_tracts ──
    (async () => {
      if (!tractGeoid) return null;
      try {
        const res = await pool.query(
          `SELECT nri_overall_score, nri_overall_rating,
                  nri_flood_riverine_score, nri_flood_coastal_score
           FROM census_tracts WHERE geoid = $1`,
          [tractGeoid],
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          nri_overall_score: r.nri_overall_score != null ? Number(r.nri_overall_score) : null,
          nri_overall_rating: r.nri_overall_rating ?? null,
          nri_flood_riverine: r.nri_flood_riverine_score != null ? Number(r.nri_flood_riverine_score) : null,
          nri_flood_coastal: r.nri_flood_coastal_score != null ? Number(r.nri_flood_coastal_score) : null,
        };
      } catch {
        return null;
      }
    })(),

    // ── Risk: flood_zone_at(lat, lng) ──
    (async () => {
      try {
        const res = await pool.query(
          `SELECT * FROM flood_zone_at($1, $2)`,
          [lat, lng],
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          flood_zone: r.fld_zone ?? null,
          flood_sfha: r.sfha ?? null,
        };
      } catch {
        return null;
      }
    })(),

    // ── Risk: FEMA disasters (last 10 fiscal years) ──
    (async () => {
      if (!countyFips) return null;
      try {
        const res = await pool.query(
          `SELECT incident_type, SUM(declarations) AS declarations
           FROM fema_disasters
           WHERE fips = $1 AND fy >= EXTRACT(YEAR FROM now()) - 10
           GROUP BY incident_type
           ORDER BY declarations DESC`,
          [countyFips],
        );
        const disasters: Record<string, number> = {};
        for (const r of res.rows) {
          disasters[r.incident_type] = Number(r.declarations);
        }
        return disasters;
      } catch {
        return null;
      }
    })(),

    // ── Risk: parcel % in SFHA ──
    (async () => {
      if (!countyFips) return null;
      try {
        const res = await pool.query(
          `SELECT avg(pct_in_sfha) AS avg_pct
           FROM parcel_flood_exposure
           WHERE county_fips = $1 AND pct_in_sfha IS NOT NULL`,
          [countyFips],
        );
        if (res.rows.length === 0 || res.rows[0].avg_pct == null) return null;
        return Math.round(Number(res.rows[0].avg_pct) * 1000) / 10;
      } catch {
        return null;
      }
    })(),

    // ── Neighborhood: walkability index (EPA) ──
    (async () => {
      if (!tractGeoid) return null;
      try {
        const res = await pool.query(
          `SELECT natwalkind FROM tract_walkability WHERE geoid = $1`,
          [tractGeoid],
        );
        if (res.rows.length === 0) return null;
        return res.rows[0].natwalkind != null ? Number(res.rows[0].natwalkind) : null;
      } catch {
        return null;
      }
    })(),

    // ── Neighborhood: Walk Score API ──
    (async () => {
      if (!address) return null;
      try {
        const ws = await getWalkScore(address, lat, lng);
        if (!ws) return null;
        return {
          walk: ws.walk,
          transit: ws.transit,
          bike: ws.bike,
          link: ws.link,
        };
      } catch {
        return null;
      }
    })(),

    // ── Neighborhood: transit stops (800m) + nearest rail ──
    (async () => {
      try {
        const stopsRes = await pool.query(
          `SELECT COUNT(*) AS cnt
           FROM transit_stops
           WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 800)`,
          [lng, lat],
        );
        const stopsCount = Number(stopsRes.rows[0].cnt);

        let nearestRailKm: number | null = null;
        try {
          const railRes = await pool.query(
            `SELECT MIN(
               ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
             ) / 1000.0 AS dist_km
             FROM transit_stops
             WHERE route_types && '{0,1,2}'
               AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 10000)`,
            [lng, lat],
          );
          if (railRes.rows.length > 0 && railRes.rows[0].dist_km != null) {
            nearestRailKm = Math.round(Number(railRes.rows[0].dist_km) * 100) / 100;
          }
        } catch {
          // Rail query failed — non-fatal
        }

        return { stopsCount, nearestRailKm };
      } catch {
        return { stopsCount: 0, nearestRailKm: null };
      }
    })(),

    // ── Neighborhood: schools (1600m) ──
    (async () => {
      try {
        const res = await pool.query(
          `SELECT name, level,
                  ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS dist_km
           FROM schools
           WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 1600)
           ORDER BY dist_km ASC`,
          [lng, lat],
        );
        return res.rows.map((r: any) => ({
          name: r.name,
          level: r.level,
          dist_km: Math.round(Number(r.dist_km) * 100) / 100,
        }));
      } catch {
        return [];
      }
    })(),

    // ── Neighborhood: crime (county, latest year) ──
    (async () => {
      if (!countyFips) return null;
      try {
        const res = await pool.query(
          `SELECT violent_per_100k, property_per_100k, agencies_reporting
           FROM crime_county
           WHERE fips = $1
           ORDER BY year DESC LIMIT 1`,
          [countyFips],
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        const agencies = Number(r.agencies_reporting);
        if (agencies < 2) {
          return {
            violent_per_100k: null,
            property_per_100k: null,
            coverage_note: `Insufficient agency coverage (${agencies} agencies reporting)`,
          };
        }
        return {
          violent_per_100k: r.violent_per_100k != null ? Number(r.violent_per_100k) : null,
          property_per_100k: r.property_per_100k != null ? Number(r.property_per_100k) : null,
          coverage_note: `${agencies} agencies reporting`,
        };
      } catch {
        return null;
      }
    })(),

    // ── Market: FHFA ZIP HPI (10-yr series + CAGR) ──
    (async () => {
      if (!zipCode) return { series: [], cagr: null };
      try {
        const res = await pool.query(
          `SELECT year, hpi
           FROM fhfa_zip_hpi
           WHERE zip5 = $1
           ORDER BY year ASC`,
          [zipCode],
        );
        const series = res.rows
          .filter((r: any) => r.hpi != null)
          .map((r: any) => ({ year: Number(r.year), hpi: Number(r.hpi) }));

        let cagr: number | null = null;
        if (series.length >= 2) {
          const first = series[0];
          const last = series[series.length - 1];
          const years = last.year - first.year;
          if (years > 0 && first.hpi > 0) {
            cagr = Math.round(((last.hpi / first.hpi) ** (1 / years) - 1) * 10000) / 100;
          }
        }

        return { series, cagr };
      } catch {
        return { series: [], cagr: null };
      }
    })(),

    // ── Market: BLS county unemployment (latest) ──
    (async () => {
      if (!countyFips) return null;
      try {
        const res = await pool.query(
          `SELECT period, unemployment_rate
           FROM bls_county_laus
           WHERE fips = $1
           ORDER BY period DESC LIMIT 1`,
          [countyFips],
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          unemployment_rate: r.unemployment_rate != null ? Number(r.unemployment_rate) : null,
          period: r.period instanceof Date
            ? r.period.toISOString().slice(0, 7)
            : String(r.period).slice(0, 7),
        };
      } catch {
        return null;
      }
    })(),
  ]);

  // 3. Assemble response
  const context = {
    risk: {
      nri_overall_score: riskNri?.nri_overall_score ?? null,
      nri_overall_rating: riskNri?.nri_overall_rating ?? null,
      nri_flood_riverine: riskNri?.nri_flood_riverine ?? null,
      nri_flood_coastal: riskNri?.nri_flood_coastal ?? null,
      flood_zone: riskFlood?.flood_zone ?? null,
      flood_sfha: riskFlood?.flood_sfha ?? null,
      disasters: riskDisasters ?? {},
      parcel_pct_in_sfha: riskParcelSfha ?? null,
    },
    neighborhood: {
      walkability_index: neighborhoodWalkability ?? null,
      walkscore: neighborhoodWalkscore ?? null,
      transit_stops_800m: neighborhoodTransit?.stopsCount ?? 0,
      nearest_rail_km: neighborhoodTransit?.nearestRailKm ?? null,
      schools_1600m: neighborhoodSchools ?? [],
      hh_nearby_schools: listing.nearby_schools ?? null,
      crime: neighborhoodCrime ?? null,
    },
    market: {
      cagr_5yr: marketHpi?.cagr ?? null,
      hpi: marketHpi?.series ?? [],
      unemployment: marketUnemployment?.unemployment_rate ?? null,
      county_unemployment_period: marketUnemployment?.period ?? null,
    },
  };

  return NextResponse.json(context);
}
