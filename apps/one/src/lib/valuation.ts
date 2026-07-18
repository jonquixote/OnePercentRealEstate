import { intrinsicValue, marginOfSafety, ownerReturn10yr, type OwnerReturn } from '@oper/primitives';
import pool from '@/lib/db';
import { parsePrefs, type InvestorPrefs } from '@/lib/prefs';

// Documented defaults when an underwriting_rules row or metro stat is absent.
const DEFAULT_OPEX = 0.5;        // 50% rule
const DEFAULT_DOWN = 0.2;
const DEFAULT_CAP = 0.07;
const DEFAULT_APPRECIATION = 0.03;
const DEFAULT_RENT_GROWTH = 0.03;
const DEFAULT_MORTGAGE = 0.07;

export type ValuationInputs = {
  price: number; monthlyRent: number; opexRatio: number; marketCapRate: number;
  appreciationRate: number; rentGrowthRate: number; mortgageRate: number; downPct: number;
  provenance: string[];
};

/**
 * Server-side prefs read (the session user's profiles.prefs). Prefs are
 * defaults, not overrides — only rate/down are consumed by valuation. Returns
 * null when no session; callers fall back to documented defaults.
 */
export async function getSessionPrefs(userId: string): Promise<InvestorPrefs | null> {
  try {
    const res = await pool.query('SELECT prefs FROM profiles WHERE id = $1', [userId]);
    const raw = res.rows[0]?.prefs;
    return raw ? parsePrefs(raw) : null;
  } catch {
    return null;
  }
}
export type Valuation = { intrinsic: number; marginOfSafety: number; ownerReturn: OwnerReturn; inputs: ValuationInputs };

function num(v: unknown, fallback: number): { value: number; wasDefault: boolean } {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? { value: n, wasDefault: false } : { value: fallback, wasDefault: true };
}

export function assembleInputs(row: Record<string, unknown>, prefs?: InvestorPrefs | null): ValuationInputs {
  const provenance: string[] = [];
  const price = Number(row.price) || 0;
  const monthlyRent = Number(row.estimated_rent) || 0;

  const opex = num(row.opex_ratio, DEFAULT_OPEX);
  provenance.push(opex.wasDefault ? 'opex: 50% default' : 'opex: underwriting_rules');

  // Prefs (investor defaults) override the down-payment default ONLY when the
  // row itself has no underwriting_rules value. Manual edits always win.
  const downRow = num(row.down_payment_pct, DEFAULT_DOWN);
  const downPct = downRow.wasDefault && prefs ? prefs.financing.downPct / 100 : downRow.value;
  provenance.push(
    downRow.wasDefault
      ? prefs ? `down: ${prefs.financing.downPct}% preset` : 'down: 20% default'
      : 'down: underwriting_rules',
  );

  const cap = num(row.metro_cap_rate, DEFAULT_CAP);
  provenance.push(cap.wasDefault ? 'cap rate: 7% default' : 'cap rate: zip median');
  const appr = num(row.hpi_cagr_5yr, DEFAULT_APPRECIATION);
  provenance.push(appr.wasDefault ? 'appreciation: 3% default' : 'appreciation: FHFA HPI 5yr CAGR');

  const mortgageRate = prefs ? prefs.financing.ratePct / 100 : DEFAULT_MORTGAGE;
  provenance.push(prefs ? `rate: ${prefs.financing.ratePct}% preset` : 'rate: 7% default');

  return {
    price, monthlyRent,
    opexRatio: opex.value, downPct, marketCapRate: cap.value,
    appreciationRate: appr.value, rentGrowthRate: DEFAULT_RENT_GROWTH, mortgageRate,
    provenance,
  };
}

export function computeValuation(row: Record<string, unknown>, prefs?: InvestorPrefs | null): Valuation {
  const inputs = assembleInputs(row, prefs);
  const intrinsic = intrinsicValue({
    monthlyRent: inputs.monthlyRent, opexRatio: inputs.opexRatio, marketCapRate: inputs.marketCapRate,
  });
  return {
    intrinsic,
    marginOfSafety: marginOfSafety(intrinsic, inputs.price),
    ownerReturn: ownerReturn10yr({
      price: inputs.price, downPct: inputs.downPct, monthlyRent: inputs.monthlyRent,
      opexRatio: inputs.opexRatio, appreciationRate: inputs.appreciationRate,
      rentGrowthRate: inputs.rentGrowthRate, mortgageRate: inputs.mortgageRate,
    }),
    inputs,
  };
}

/**
 * Fetch the joined valuation row for a listing. Derives the metro cap-rate proxy
 * (median rent*12*(1-opex) / price over the ZIP's rentable stock) and the FHFA
 * 5-year HPI CAGR for the ZIP, plus the underwriting_rules opex/down via
 * resolve_rule(). Verified against prod (listing 2303955).
 */
export async function fetchValuationRow(id: string): Promise<Record<string, unknown> | null> {
  const res = await pool.query(
    `WITH l AS (
        SELECT id, price, estimated_rent, property_type, zip_code
        FROM listings WHERE id = $1
     )
     SELECT
       l.price, l.estimated_rent,
       r.fifty_pct_opex_ratio AS opex_ratio, r.down_payment_pct,
       (SELECT percentile_cont(0.5) WITHIN GROUP (
            ORDER BY (x.estimated_rent*12*(1 - COALESCE(r.fifty_pct_opex_ratio, 0.5))) / NULLIF(x.price, 0)
          ) FROM listings x WHERE x.zip_code = l.zip_code AND x.price > 0 AND x.estimated_rent > 0) AS metro_cap_rate,
       (SELECT power(
            NULLIF(max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi h2 WHERE h2.zip5 = l.zip_code)), 0)
            / NULLIF(max(hpi) FILTER (WHERE year = (SELECT max(year) - 5 FROM fhfa_zip_hpi h3 WHERE h3.zip5 = l.zip_code)), 0),
            1.0/5) - 1 FROM fhfa_zip_hpi f WHERE f.zip5 = l.zip_code) AS hpi_cagr_5yr
     FROM l LEFT JOIN LATERAL resolve_rule(l.property_type, 'standard', 'buy_hold') r ON true`,
    [id],
  );
  return res.rows[0] ?? null;
}
