import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * W4 — market time-series for the selected ZIP's chart pane.
 *
 * Returns three series (HPI, county unemployment, gross rent yield ratio), each a
 * list of { t, v } points where `t` is a *numeric year* (float for monthly
 * unemployment, derived from the DATE period) so a single shared x-axis can
 * span all three. Series with no matching rows come back as empty arrays
 * (never a 500).
 *
 * DATA MAPPING (verified against the production DB):
 *  - hpi          -> fhfa_zip_hpi.zip5 = $zip (clean, yearly).
 *  - unemployment -> needs the county FIPS for the ZIP first:
 *                    `SELECT fips_code FROM listings WHERE zip_code = $zip
 *                     LIMIT 1`, then bls_county_laus.fips = $fips (monthly).
 *  - rent_psf     -> zcta_demographics.zcta = $zip (annual ACS). The plan's
 *                    intended source was h3_market_stats, but listings has NO
 *                    h3_8 column and there is NO Postgres h3 extension, so
 *                    h3_market_stats CANNOT be SQL-joined to a ZIP. We therefore
 *                    derive a gross rent-to-value YIELD RATIO from the available
 *                    zcta_demographics signal:
 *                    median_gross_rent * 12 / median_home_value (annualized
 *                    gross rent over home value). When median_home_value is null
 *                    or <= 0 the ratio is undefined, so that year's point is
 *                    OMITTED (we never fall back to a different-unit value).
 *                    acs_year points form the yearly series.
 */

const SERIES = ["hpi", "unemployment", "rent_psf"] as const;
type SeriesKey = (typeof SERIES)[number];

const QuerySchema = z.object({
  zip: z
    .string()
    .regex(/^\d{5}$/, "zip must be a 5-digit string"),
  series: z
    .string()
    .optional()
    // comma-separated subset of the three valid series keys
    .transform((s) =>
      (s ?? SERIES.join(","))
        .split(",")
        .map((x) => x.trim())
        .filter((x): x is SeriesKey => (SERIES as readonly string[]).includes(x)),
    )
    .default([...SERIES]),
});

// Single-instance in-memory TTL cache keyed by `${zip}:${seriesKey}`, value {
// data, expiresAt }. Acceptable for a single-instance deploy; NOT a redis
// dependency (per the W4 spec).
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, { expiresAt: number; data: unknown }>();

interface Point {
  t: number;
  v: number;
}

function getCached(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) cache.delete(key);
  return undefined;
}

function setCached(key: string, data: unknown) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
}

/** Pull the county FIPS for a ZIP from listings (parameterized). */
async function fipsForZip(zip: string): Promise<string | null> {
  const r = await pool.query<{ fips_code: string | null }>(
    `SELECT fips_code FROM listings WHERE zip_code = $1 LIMIT 1`,
    [zip],
  );
  return r.rows[0]?.fips_code ?? null;
}

async function hpiSeries(zip: string): Promise<Point[]> {
  const r = await pool.query<{ year: number; hpi: number | null }>(
    `SELECT year, hpi FROM fhfa_zip_hpi WHERE zip5 = $1 ORDER BY year`,
    [zip],
  );
  return r.rows
    .filter((row) => row.hpi != null && Number.isFinite(Number(row.hpi)))
    .map((row) => ({ t: Number(row.year), v: Number(row.hpi) }));
}

async function unemploymentSeries(zip: string): Promise<Point[]> {
  const fips = await fipsForZip(zip);
  if (!fips) return [];
  const r = await pool.query<{ period: Date; unemployment_rate: number | null }>(
    `SELECT period, unemployment_rate FROM bls_county_laus WHERE fips = $1 ORDER BY period`,
    [fips],
  );
  return r.rows
    .filter((row) => row.unemployment_rate != null && Number.isFinite(Number(row.unemployment_rate)))
    .map((row) => {
      const d = new Date(row.period);
      const t = d.getUTCFullYear() + (d.getUTCMonth() + (d.getUTCDate() > 15 ? 1 : 0)) / 12;
      return { t: Number(t.toFixed(4)), v: Number(row.unemployment_rate) };
    });
}

async function rentPsfSeries(zip: string): Promise<Point[]> {
  const r = await pool.query<{
    acs_year: number;
    median_gross_rent: number | null;
    median_home_value: number | null;
  }>(
    `SELECT acs_year, median_gross_rent, median_home_value
       FROM zcta_demographics WHERE zcta = $1 ORDER BY acs_year`,
    [zip],
  );
  const out: Point[] = [];
  for (const row of r.rows) {
    const rent = row.median_gross_rent;
    const value = row.median_home_value;
    // Gross rent-to-value yield ratio: annualized gross rent over home value.
    // When home value is missing/null/<=0 the ratio is undefined, so we SKIP
    // that year rather than fall back to a different-unit value (which would
    // mix dimensionless ratios with raw monthly dollars and break the scale).
    if (rent == null || !Number.isFinite(Number(rent))) continue;
    if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) continue;
    const v = (Number(rent) * 12) / Number(value);
    out.push({ t: Number(row.acs_year), v: Number(v.toFixed(6)) });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    zip: url.searchParams.get("zip"),
    series: url.searchParams.get("series") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid query", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const { zip, series } = parsed.data;

  const seriesOut: Record<SeriesKey, Point[]> = {
    hpi: [],
    unemployment: [],
    rent_psf: [],
  };

  const fetchers: Record<SeriesKey, () => Promise<Point[]>> = {
    hpi: () => hpiSeries(zip),
    unemployment: () => unemploymentSeries(zip),
    rent_psf: () => rentPsfSeries(zip),
  };

  await Promise.all(
    series.map(async (key) => {
      const cacheKey = `${zip}:${key}`;
      const hit = getCached(cacheKey);
      if (hit) {
        seriesOut[key] = hit as Point[];
        return;
      }
      try {
        const data = await fetchers[key]();
        seriesOut[key] = data;
        setCached(cacheKey, data);
      } catch (err) {
        // Gracefully degrade: a failing series yields an empty array.
        console.error(`/api/market-series ${key} failed for ${zip}:`, err);
        seriesOut[key] = [];
      }
    }),
  );

  return NextResponse.json(
    { zip, series: seriesOut },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
