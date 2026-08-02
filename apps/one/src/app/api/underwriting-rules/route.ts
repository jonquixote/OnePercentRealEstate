import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';
import { ruleConfigFromRow } from '@/lib/rule-config';

export const dynamic = 'force-dynamic';

const CACHE_KEY = 'underwriting-rules:v1';
const CACHE_TTL_S = 3600; // 1 hour — rules rarely change

// Delivers the active rule matrix as RuleConfig rows. The client (or server)
// resolves the applicable row per (propertyType, saleType, strategy) via
// resolveRuleFrom() in @oper/primitives — the same precedence as SQL resolve_rule().
//
// The snake_case → camelCase mapping lives in @/lib/rule-config so this route
// and underwriteDeal() cannot drift apart on what a rule row means.

export async function GET() {
  try {
    const cached = await redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { 'X-Cache': 'HIT', 'Cache-Control': 'public, max-age=600, s-maxage=3600' },
      });
    }
  } catch {
    /* ignore */
  }

  try {
    const client = await pool.connect();
    try {
      const sql = `
        SELECT property_type, sale_type, strategy,
               target_ratio, min_gross_yield, target_grm, target_cap_rate, target_coc,
               min_dscr, min_debt_yield, max_price_to_rent, fifty_pct_opex_ratio,
               arv_discount, rehab_per_sqft, min_flip_roi, refi_ltv,
               str_adr, str_occupancy, str_target_cap_rate,
               down_payment_pct, interest_rate, loan_term_years, closing_cost_pct,
               property_tax_rate, insurance_annual, is_provisional,
               rule_version, rule_set_version
        FROM public.underwriting_rules
        WHERE is_active AND effective_to IS NULL
        ORDER BY strategy, property_type, sale_type
      `;
      const result = await client.query(sql);

      const payload = result.rows.map((r) => ruleConfigFromRow(r, r.strategy));

      redis.setex(CACHE_KEY, CACHE_TTL_S, JSON.stringify(payload)).catch(() => {});

      return NextResponse.json(payload, {
        headers: { 'X-Cache': 'MISS', 'Cache-Control': 'public, max-age=600, s-maxage=3600' },
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/underwriting-rules error:', err);
    return NextResponse.json({ error: 'underwriting rules unavailable' }, { status: 500 });
  }
}
