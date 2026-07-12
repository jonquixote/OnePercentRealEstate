import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import pool from '@/lib/db';
import { withSpan } from '@/lib/tracing';
import { parse, compile, ALLOWED_COLUMNS_LIST } from '@oper/query-lang';
import { MOTIVATED_SELLER_SCORE_SQL } from '@oper/primitives';

export const dynamic = 'force-dynamic';

const FilterSchema = z.object({
  filter: z.string().min(1).max(500),
});

const PRO_LIMIT = 1000;
const STATEMENT_TIMEOUT_MS = 5_000;

/**
 * ORDER BY whitelist — same server-controlled expressions as the query route.
 * The client only ships a column id; the SQL is hand-authored here, never
 * interpolated from client text.
 */
const ORDER_BY_WHITELIST: Record<string, string> = {
  id: 'id',
  address: 'address',
  price: 'price',
  estimated_rent: 'estimated_rent',
  sqft: 'sqft',
  bedrooms: 'bedrooms',
  bathrooms: 'bathrooms',
  year_built: 'year_built',
  days_on_market: 'days_on_market',
  price_cut_pct: 'price_cut_pct',
  rent_price_ratio: 'rent_price_ratio',
  motivated_score: MOTIVATED_SELLER_SCORE_SQL,
};

function buildOrderBy(orderBy?: { col: string; dir: 'asc' | 'desc' }): string {
  if (!orderBy) return 'id DESC';
  const expr = ORDER_BY_WHITELIST[orderBy.col];
  if (!expr) return 'id DESC';
  const dir = orderBy.dir === 'asc' ? 'ASC' : 'DESC';
  if (orderBy.col === 'id') return `id ${dir}`;
  return `${expr} ${dir} NULLS LAST, id DESC`;
}

/**
 * Bearer-key auth: hash the token and look it up. The raw key is never stored
 * or compared. Returns the owning user_id, or null for a missing/revoked key.
 */
async function authenticateKey(
  authHeader: string | null,
): Promise<{ keyId: string; userId: string } | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;
  const token = match[1];
  const keyHash = createHash('sha256').update(token).digest('hex');
  const res = await pool.query(
    `SELECT id, user_id FROM api_keys WHERE key_hash = $1 AND revoked = false`,
    [keyHash],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { keyId: String(row.id), userId: row.user_id };
}

export async function GET(req: NextRequest) {
  const auth = await authenticateKey(req.headers.get('authorization'));
  if (!auth) {
    return NextResponse.json({ error: 'invalid or revoked API key' }, { status: 401 });
  }
  const userId = auth.userId;

  // Pro-only: verify the key's owner is on the pro tier.
  let tier: string | null = null;
  try {
    const res = await pool.query(
      `SELECT subscription_tier FROM profiles WHERE id = $1`,
      [userId]
    );
    tier = res.rows[0]?.subscription_tier ?? null;
  } catch (err) {
    console.error('/api/v1/listings tier lookup error:', err);
    return NextResponse.json({ error: 'auth lookup failed' }, { status: 500 });
  }
  if (tier !== 'pro') {
    return NextResponse.json({ error: 'PRO_REQUIRED' }, { status: 403 });
  }

  // Best-effort last_used_at stamp for the matched key — never blocks the request.
  pool
    .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [auth.keyId])
    .catch((e) => console.error('last_used_at update failed (non-fatal):', e));

  const parsed = FilterSchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'filter query param required (1-500 chars)' },
      { status: 400 }
    );
  }

  // TRUST BOUNDARY: re-parse + re-compile server-side; the filter is never
  // interpolated as raw SQL. compile() emits parameterized $N placeholders.
  let compiled;
  try {
    const ast = parse(parsed.data.filter);
    compiled = compile(ast);
  } catch (err) {
    const message = (err as Error).message;
    const positionMatch = /position (\d+)/.exec(message);
    const position = positionMatch ? Number(positionMatch[1]) : null;
    return NextResponse.json(
      {
        error: 'filter parse/compile error',
        message,
        position,
        allowedColumns: ALLOWED_COLUMNS_LIST,
      },
      { status: 400 }
    );
  }

  const saleTypeDefault = compiled.usedColumns.includes('sale_type')
    ? ''
    : `sale_type = 'standard' AND`;
  const orderBy = req.nextUrl.searchParams.get('orderBy');
  const orderByDir = req.nextUrl.searchParams.get('orderDir') === 'asc' ? 'asc' : 'desc';
  const orderBySql = buildOrderBy(
    orderBy ? { col: orderBy, dir: orderByDir } : undefined
  );

  const sql = `
    SELECT
      id::text AS id,
      address,
      latitude,
      longitude,
      price,
      bedrooms,
      bathrooms,
      sqft,
      estimated_rent,
      year_built,
      primary_photo,
      sale_type,
      listing_status,
      days_on_market,
      price_cut_pct,
      rent_low,
      rent_high,
      rent_price_ratio,
      ${MOTIVATED_SELLER_SCORE_SQL} as motivated_score,
      zip_code
    FROM listings
    WHERE listing_type = 'for_sale'
      AND ${saleTypeDefault} (${compiled.whereSql})
    ORDER BY ${orderBySql}
    LIMIT ${PRO_LIMIT}
  `;

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const result = await withSpan(
        'api.v1.listings',
        () => client.query(sql, compiled.params),
        { usedColumns: compiled.usedColumns.join(','), paramCount: compiled.params.length }
      );
      await client.query('COMMIT');
      return NextResponse.json({ items: result.rows, count: result.rowCount });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/v1/listings error:', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
