import pool from '@/lib/db';
import { evaluateRules, type Strategy, type Grade } from '@oper/primitives';
import { ruleConfigFromRow } from '@/lib/rule-config';

/**
 * Underwrite one listing through all four buyer lenses.
 *
 * The engine in `@oper/primitives` has always been able to do this; nothing on
 * the home page ever called it. The important behaviour here is the NEGATIVE
 * path: a lens without the data to support it returns `available: false` with a
 * reason, so the page can say "we can't underwrite this yet" instead of
 * printing a number we cannot defend.
 *
 * Two lenses are structurally limited today, and both say so rather than
 * guessing:
 *
 *  - **Short-term rental** has no nightly-rate feed in the database at all, so
 *    it is unavailable by construction.
 *  - **Flip and BRRRR** need an after-repair value. We derive one from recent
 *    nearby sales (see `ARV_CTE`) and refuse the lens when those comps are too
 *    thin. The naive alternative — a ZIP-wide median $/sqft — was measured
 *    against production and returned ARV/price ratios from 0.62 to 2.13,
 *    i.e. it would have claimed a $164k house was worth $350k purely because
 *    it was cheap for its ZIP, which is usually a statement about condition,
 *    not about upside. The engine's own fallback (`arv = price`) is no better:
 *    it silently asserts zero forced appreciation, which reads as a real
 *    finding rather than a missing input.
 */

const STRATEGIES: Strategy[] = ['buy_hold', 'brrrr', 'flip', 'str'];

/** Comps must be this many before an ARV is allowed to exist. */
const MIN_COMPS = 8;
/** Comparable sqft band around the subject. */
const SQFT_BAND = 0.25;
const COMP_WINDOW = '180 days';

export interface LensMetric {
  label: string;
  /** Already formatted by the rule's own unit — "5.20%", "8.4×", "$182,000". */
  value: string;
  threshold: string | null;
  met: boolean | null;
}

export interface LensAssumptions {
  downPaymentPct: number;
  interestRate: number;
  opexRatio: number;
  resolvedTier?: string;
  isProvisional?: boolean;
  ruleVersion?: string | null;
  /** Present only when the lens used a comp-derived ARV. */
  arv?: number;
  arvCompCount?: number;
}

export interface LensVerdict {
  strategy: Strategy;
  available: boolean;
  /** Why we cannot underwrite this lens. Shown to the user verbatim. */
  reason?: string;
  grade?: Grade;
  headline?: string;
  metrics: LensMetric[];
  assumptions?: LensAssumptions;
}

/**
 * ARV from recent sales of the same property type, in the same ZIP, within a
 * ±25% sqft band. Tightening from a plain ZIP median to this definition cut the
 * median relative IQR of $/sqft to 0.173 (about ±9% around the median) — the
 * measurement that made shipping an ARV defensible at all. It also cut coverage
 * to roughly 18% of active listings, which is the honest cost: most properties
 * report the flip and BRRRR lenses as unavailable, and that is correct.
 */
const ARV_CTE = `
  WITH subj AS (
    SELECT id, price, estimated_rent, sqft, property_type, sale_type, zip_code
      FROM listings WHERE id = $1
  ),
  comps AS (
    SELECT count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY x.price_per_sqft)::numeric AS ppsf
      FROM subj s
      JOIN listings x
        ON x.zip_code = s.zip_code
       AND x.property_type = s.property_type
       AND x.listing_status = 'sold'
       AND x.sold_date > now() - interval '${COMP_WINDOW}'
       AND x.price_per_sqft > 0
       AND s.sqft > 0
       AND x.sqft BETWEEN s.sqft * ${1 - SQFT_BAND} AND s.sqft * ${1 + SQFT_BAND}
  )
  SELECT s.*,
         CASE WHEN c.n >= ${MIN_COMPS} THEN round(c.ppsf * s.sqft) END AS arv,
         CASE WHEN c.n >= ${MIN_COMPS} THEN c.n END AS arv_comp_count
    FROM subj s CROSS JOIN comps c
`;

/**
 * resolve_rule() cache.
 *
 * The hero underwrites every deal in the metro tour, and those deals share a
 * handful of property types between them, so without this the page issues the
 * same three lookups ten times over. Rules are edited by hand and versioned;
 * an hour of staleness is not a correctness concern.
 */
const RULE_TTL_MS = 60 * 60 * 1000;
const ruleCache = new Map<string, { at: number; row: Record<string, unknown> | null }>();

async function resolveRule(
  propertyType: string,
  saleType: string,
  strategy: Strategy,
): Promise<Record<string, unknown> | null> {
  const key = `${propertyType}|${saleType}|${strategy}`;
  const hit = ruleCache.get(key);
  if (hit && Date.now() - hit.at < RULE_TTL_MS) return hit.row;
  try {
    const res = await pool.query(`SELECT * FROM resolve_rule($1, $2, $3)`, [
      propertyType,
      saleType,
      strategy,
    ]);
    const row = res.rows[0] ?? null;
    ruleCache.set(key, { at: Date.now(), row });
    return row;
  } catch (err) {
    // Not cached: a transient failure must not pin "no rule" for an hour.
    console.error(`resolve_rule failed for ${key}:`, err);
    return null;
  }
}

/** Test seam: the cache is module state, so it must not leak between cases. */
export function __clearRuleCache() {
  ruleCache.clear();
}

const unavailable = (strategy: Strategy, reason: string): LensVerdict => ({
  strategy,
  available: false,
  reason,
  metrics: [],
});

export async function underwriteDeal(dealId: string): Promise<LensVerdict[]> {
  let listing: Record<string, unknown> | undefined;
  try {
    const res = await pool.query(ARV_CTE, [dealId]);
    listing = res.rows[0];
  } catch (err) {
    // The hero must still render if underwriting fails. Reporting every lens as
    // unavailable is truthful: we genuinely do not have a verdict.
    console.error('underwriteDeal query failed:', err);
    return STRATEGIES.map((s) => unavailable(s, 'Underwriting is temporarily unavailable.'));
  }

  if (!listing) return STRATEGIES.map((s) => unavailable(s, 'Listing not found.'));

  const price = Number(listing.price);
  const monthlyRent = Number(listing.estimated_rent);
  const sqft = Number(listing.sqft);
  const arv = listing.arv != null ? Number(listing.arv) : null;
  const arvCompCount = listing.arv_comp_count != null ? Number(listing.arv_comp_count) : null;

  const out: LensVerdict[] = [];

  for (const strategy of STRATEGIES) {
    if (strategy === 'str') {
      out.push(
        unavailable(
          strategy,
          'Short-term rental underwriting needs a nightly-rate feed we do not have yet.',
        ),
      );
      continue;
    }
    if (!(price > 0)) {
      out.push(unavailable(strategy, 'No credible list price on this property.'));
      continue;
    }
    if (!(monthlyRent > 0)) {
      out.push(unavailable(strategy, 'No rent estimate for this property yet.'));
      continue;
    }
    if (strategy === 'flip' || strategy === 'brrrr') {
      if (!(sqft > 0)) {
        out.push(
          unavailable(strategy, 'No square footage on this listing, so rehab cost cannot be estimated.'),
        );
        continue;
      }
      if (arv === null) {
        out.push(
          unavailable(
            strategy,
            'Not enough recent comparable sales nearby to establish an after-repair value.',
          ),
        );
        continue;
      }
    }

    const cfgRow = await resolveRule(
      (listing.property_type as string) ?? 'DEFAULT',
      (listing.sale_type as string) ?? 'standard',
      strategy,
    );
    if (!cfgRow) {
      out.push(unavailable(strategy, 'No underwriting rule is configured for this property type.'));
      continue;
    }

    const cfg = ruleConfigFromRow(cfgRow, strategy);
    const evaluation = evaluateRules(
      {
        price,
        monthlyRent,
        sqft: sqft > 0 ? sqft : null,
        // Only pass an ARV we actually derived. `undefined` lets the engine
        // apply its own not-gradable rule for flip rather than us faking one.
        arv: arv ?? undefined,
      },
      cfg,
      {
        propertyType: (listing.property_type as string) ?? null,
        saleType: (listing.sale_type as never) ?? null,
      },
    );

    // The engine decides gradability. It knows, for instance, that a flip
    // without an ARV cannot be graded — deferring to it keeps one definition of
    // "not enough data" instead of a second one here that could drift.
    if (!evaluation.gradable) {
      out.push(unavailable(strategy, evaluation.gradableReason ?? 'Not enough data to grade this property.'));
      continue;
    }

    out.push({
      strategy,
      available: true,
      grade: evaluation.grade,
      headline: evaluation.headline,
      metrics: evaluation.rules
        .filter((r) => r.available)
        .map((r) => ({
          label: r.label,
          value: r.display!,
          threshold: r.thresholdDisplay,
          met: r.passes,
        })),
      assumptions: {
        downPaymentPct: cfg.downPaymentPct,
        interestRate: cfg.interestRate,
        opexRatio: cfg.fiftyPctOpexRatio ?? 0.5,
        resolvedTier: cfg.resolvedTier,
        isProvisional: cfg.isProvisional,
        ruleVersion: cfg.ruleVersion,
        ...(arv !== null && (strategy === 'flip' || strategy === 'brrrr')
          ? { arv, arvCompCount: arvCompCount ?? undefined }
          : {}),
      },
    });
  }

  return out;
}
