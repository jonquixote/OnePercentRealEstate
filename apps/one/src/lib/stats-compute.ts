import pool from '@/lib/db';

/**
 * THE single source of truth for the homepage hero numbers.
 *
 * The SQL below is lifted VERBATIM from the old inline `/api/stats` handler —
 * it is deliberately not "improved" here, because this refactor is a latency
 * change, not a semantics change (see contract.test.ts).
 *
 * Why this module exists: the aggregate seq-scans ~1.3M `listings` rows and
 * took **18.5s cold** on prod. With a 120s cache TTL and no request
 * coalescing, a real user paid that price every couple of minutes and everyone
 * arriving during the window queued behind them. The compute now runs OUT of
 * the request path (refresh job) and its result is stored in `stats_summary`;
 * the route reads one row.
 */

export interface HistogramBin {
  loPct: number; // inclusive lower edge, in percent (e.g. 0.6)
  hiPct: number; // exclusive upper edge, in percent
  count: number;
}

export interface StatsPayload {
  total: number;
  onePercentPasses: number;
  medianRatioPct: number | null;
  markets: number;
  rentable: number;
  rentCalcPending: number;
  histogram: HistogramBin[];
  thresholdPct: number;
  strategy: string;
  lastUpdated: string;
}

export const STRATEGY_WHITELIST = new Set(['buy_hold', 'brrrr', 'flip', 'str']);

// Fixed display window for the ratio distribution: 0.2%..1.7% in 15 bins of 0.1%.
const HIST_LO = 0.2;
const HIST_HI = 1.7;
const HIST_BINS = 15;
const HIST_STEP = (HIST_HI - HIST_LO) / HIST_BINS;

/**
 * Only count rent ratios for rows where price/rent are usable and the property
 * type is rentable. `total` counts ACTIVE for-sale inventory: the base CTE
 * applies the Listing Truth lifecycle filter, so sold/stale/misfiled rows —
 * including the ~2,800 misfiled rentals — never inflate the count, the 1%
 * tally, the median, or the histogram.
 *
 * resolve_rule is called ~13× (once per distinct property type) and joined,
 * NOT once per row.
 */
const STATS_SQL = `
  WITH rules AS (
    -- Resolve BOTH per-type functions once per distinct property_type, not per
    -- row. public.is_rentable() is plpgsql with procost 100, and the base CTE scans
    -- ~500k rows using it twice — about a million calls per execution. There
    -- are only a handful of distinct property types, so the join is free by
    -- comparison. Same trick already used for resolve_rule.
    SELECT pt,
           (SELECT target_ratio FROM resolve_rule(pt, 'standard', $1)) AS tr,
           public.is_rentable(pt) AS rentable
    FROM (
      SELECT DISTINCT property_type AS pt
      FROM listings WHERE listing_type = 'for_sale' AND sale_type = 'standard'
    ) d
  ),
  base AS (
    SELECT
      l.price,
      l.estimated_rent,
      l.state,
      l.property_type,
      l.rent_calc_status,
      r.tr AS target_ratio,
      -- COALESCE guards the NULL property_type case: r.pt = l.property_type
      -- never matches NULL, and is_rentable(NULL) returned FALSE, so the join
      -- must reproduce that rather than yielding NULL.
      COALESCE(r.rentable, false) AS rentable,
      CASE WHEN l.price > 0 AND l.estimated_rent IS NOT NULL AND l.estimated_rent > 0
                AND l.rent_calc_status = 'done'
                AND COALESCE(r.rentable, false)
           THEN l.estimated_rent / l.price END AS ratio
    FROM listings l
    LEFT JOIN rules r ON r.pt = l.property_type
    WHERE l.listing_type = 'for_sale'
      AND l.sale_type = 'standard'
      AND l.price > 10000
      AND l.listing_status NOT IN ('sold','stale','rental_misfiled')
  )
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE ratio >= COALESCE(target_ratio, 0.01))::int AS one_pct,
    (
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio)
      FILTER (WHERE ratio IS NOT NULL)
      * 100
    )::numeric(8,3) AS median_ratio_pct,
    count(DISTINCT state) FILTER (WHERE state IS NOT NULL)::int AS markets,
    count(*) FILTER (WHERE rent_calc_status = 'done' AND rentable)::int AS rentable,
    count(*) FILTER (WHERE rent_calc_status = 'pending')::int AS rent_calc_pending,
    (COALESCE((SELECT target_ratio FROM resolve_rule('DEFAULT', 'standard', $1)), 0.01) * 100)::numeric(6,2) AS threshold_pct,
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'count', c) ORDER BY bucket), '[]'::jsonb)
      FROM (
        SELECT width_bucket(ratio * 100, ${HIST_LO}, ${HIST_HI}, ${HIST_BINS}) AS bucket, count(*)::int AS c
        FROM base
        WHERE ratio IS NOT NULL
        GROUP BY 1
      ) h
    ) AS histogram,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY estimated_rent)
       FROM listings
      WHERE estimated_rent IS NOT NULL AND estimated_rent > 0
        AND listing_type = 'for_sale'
        AND listing_status NOT IN ('sold','stale','rental_misfiled')
    )::int AS median_rent
  FROM base
`;

function shapeRow(row: Record<string, unknown>, strategy: string): StatsPayload & { medianRent: number | null } {
  // Fold width_bucket output (0 = underflow, BINS+1 = overflow) into the BINS
  // display bins so the edges are never silently dropped.
  const counts = new Array<number>(HIST_BINS).fill(0);
  const rawBuckets: Array<{ bucket: number; count: number }> = Array.isArray(row.histogram)
    ? (row.histogram as Array<{ bucket: number; count: number }>)
    : [];
  for (const b of rawBuckets) {
    const idx = Math.min(HIST_BINS, Math.max(1, Number(b.bucket))) - 1;
    counts[idx] += Number(b.count) || 0;
  }
  const histogram: HistogramBin[] = counts.map((count, i) => ({
    loPct: Number((HIST_LO + i * HIST_STEP).toFixed(2)),
    hiPct: Number((HIST_LO + (i + 1) * HIST_STEP).toFixed(2)),
    count,
  }));

  return {
    total: Number(row.total) || 0,
    onePercentPasses: Number(row.one_pct) || 0,
    medianRatioPct: row.median_ratio_pct != null ? Number(row.median_ratio_pct) : null,
    markets: Number(row.markets) || 0,
    rentable: Number(row.rentable) || 0,
    rentCalcPending: Number(row.rent_calc_pending) || 0,
    histogram,
    thresholdPct: row.threshold_pct != null ? Number(row.threshold_pct) : 1.0,
    strategy,
    lastUpdated: new Date().toISOString(),
    medianRent: row.median_rent != null ? Number(row.median_rent) : null,
  };
}

/**
 * Run the expensive aggregate. ~18s on 1.3M rows — callers must keep this OUT
 * of the request path (use `readStatsSummary`, which reads the stored result).
 */
export async function computeStats(strategy: string): Promise<StatsPayload & { medianRent: number | null }> {
  const client = await pool.connect();
  try {
    const result = await client.query(STATS_SQL, [strategy]);
    return shapeRow(result.rows[0] ?? {}, strategy);
  } finally {
    client.release();
  }
}

/** Compute and persist. Returns what it stored. Safe to run concurrently (upsert). */
export async function computeAndStoreStats(strategy: string) {
  const payload = await computeStats(strategy);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO stats_summary (strategy, payload, computed_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (strategy) DO UPDATE
         SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at`,
      [strategy, JSON.stringify(payload)],
    );
  } finally {
    client.release();
  }
  return payload;
}

/** Point lookup of the precomputed row. Returns null when never populated. */
export async function readStatsSummary(
  strategy: string,
): Promise<{ payload: StatsPayload & { medianRent: number | null }; computedAt: Date } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT payload, computed_at FROM stats_summary WHERE strategy = $1`,
      [strategy],
    );
    if (res.rowCount === 0) return null;
    return { payload: res.rows[0].payload, computedAt: res.rows[0].computed_at };
  } finally {
    client.release();
  }
}
