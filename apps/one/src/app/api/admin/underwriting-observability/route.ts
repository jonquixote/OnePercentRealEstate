import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { safeErrorResponse } from '@/lib/api-error';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

function isAdmin(req: Request): boolean {
  const provided = req.headers.get('x-api-key') || req.headers.get('x-admin-key');
  const expected = process.env.ADMIN_API_KEY;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Observability surface for the underwriting rules engine. Returns the v_*
 * views (coverage, sale-type distribution, fallback-tier usage, buy-hold pass
 * rates, active rule matrix) so we can answer "how many listings resolve to each
 * strategy / fallback tier / sale type, and how many run on provisional rules."
 * Admin-guarded (ADMIN_API_KEY) like the other /api/admin routes.
 */
export async function GET(req: Request) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await pool.connect();
  try {
    const [coverage, saleTypes, fallback, passRates, activeRules] = await Promise.all([
      client.query('SELECT * FROM v_underwriting_coverage'),
      client.query('SELECT * FROM v_sale_type_distribution'),
      client.query('SELECT * FROM v_rule_fallback_usage ORDER BY listings DESC LIMIT 100'),
      client.query('SELECT * FROM v_buy_hold_pass_rates ORDER BY clears_target_ratio DESC LIMIT 50'),
      client.query('SELECT * FROM v_underwriting_rules_active'),
    ]);

    return NextResponse.json({
      coverage: coverage.rows[0] ?? null,
      saleTypeDistribution: saleTypes.rows,
      fallbackTierUsage: fallback.rows,
      buyHoldPassRates: passRates.rows,
      activeRules: activeRules.rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return safeErrorResponse(error, 500);
  } finally {
    client.release();
  }
}
