import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withSpan } from '@/lib/tracing';
import { parse, compile, ALLOWED_COLUMNS_LIST } from '@oper/query-lang';
import { MOTIVATED_SELLER_SCORE_SQL } from '@oper/primitives';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Demo-mode row cap. The terminal is a Pro feature; anonymous + free-tier
 * sessions are limited to this many rows regardless of the requested limit.
 * This is the authoritative cap — enforced server-side, not in CSS. Pro
 * sessions are unaffected and may request up to MAX_LIMIT.
 */
const DEMO_ROW_CAP = 50;

const QueryBodySchema = z.object({
  expression: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(1000).optional(),
  // Server-side sort. `col` is a logical id translated through ORDER_BY_WHITELIST
  // below (never interpolated). Unknown ids fall back to the default ORDER BY.
  orderBy: z
    .object({
      col: z.string().max(64),
      dir: z.enum(['asc', 'desc']),
    })
    .optional(),
  // Lifecycle opt-in. By default the terminal hides off-market rows
  // (sold/stale/rental_misfiled); includeSold surfaces sold rows so they can
  // render with a SOLD band. Stale + misfiled stay hidden regardless.
  includeSold: z.boolean().optional(),
});

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;
const STATEMENT_TIMEOUT_MS = 5_000;

/**
 * TRUST BOUNDARY: the client only ever ships a column *id*. This map is the
 * exclusive source of ORDER BY SQL — the value is a fixed, hand-authored SQL
 * expression, never the client string. Every id here must correspond to a
 * column in the SELECT below so the sort is meaningful. Anything not in this
 * map is rejected (server falls back to `id DESC`).
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
  // motivated_score is a computed SELECT expression; sort on the same formula.
  motivated_score: MOTIVATED_SELLER_SCORE_SQL,
};

/**
 * Build the ORDER BY clause from the whitelist. Returns `id DESC` when no valid
 * sort is requested. `dir` is constrained to ASC/DESC by zod, so both the
 * expression and the direction are server-controlled — no interpolation of
 * client text. A stable `id DESC` tiebreaker keeps virtualized paging steady,
 * and NULLS LAST keeps missing values off the top of a DESC sort (so the parity
 * check — "top row has the true max" — holds).
 */
function buildOrderBy(orderBy?: { col: string; dir: 'asc' | 'desc' }): string {
  if (!orderBy) return 'id DESC';
  const expr = ORDER_BY_WHITELIST[orderBy.col];
  if (!expr) return 'id DESC';
  const dir = orderBy.dir === 'asc' ? 'ASC' : 'DESC';
  if (orderBy.col === 'id') return `id ${dir}`;
  return `${expr} ${dir} NULLS LAST, id DESC`;
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof QueryBodySchema>;
  try {
    const json = await req.json();
    const parsed = QueryBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid body', details: parsed.error.format() },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // Server re-parses + re-compiles. The client only ships the expression
  // string; never trust client-compiled SQL.
  let compiled;
  try {
    const ast = parse(body.expression);
    compiled = compile(ast);
  } catch (err) {
    const message = (err as Error).message;
    // Grammar errors embed `at position N` in the message; column-whitelist
    // errors ("Invalid column name: 'x'") do not. Surface the offset so the
    // client can point a caret at the offending token.
    const positionMatch = /position (\d+)/.exec(message);
    const position = positionMatch ? Number(positionMatch[1]) : null;
    return NextResponse.json(
      {
        error: 'expression parse/compile error',
        message,
        position,
        allowedColumns: ALLOWED_COLUMNS_LIST,
      },
      { status: 400 }
    );
  }

  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Server-enforced demo cap: anonymous (null) or free-tier sessions are
  // clamped to DEMO_ROW_CAP. getSessionUser() returns null for anon, and a
  // `free`-tier user otherwise — only `pro` gets the full row budget.
  const isPro = (await getSessionUser())?.tier === 'pro';
  const effectiveLimit = isPro ? limit : Math.min(limit, DEMO_ROW_CAP);

  // SQL guarantees:
  //  - WHERE clause is `listing_type='for_sale' AND ({compiled.whereSql})`
  //    where whereSql only references whitelisted columns + $N placeholders.
  //  - LIMIT is a server-controlled integer (clamped above).
  //  - statement_timeout caps runaway predicates.
  // Canonical display: default to standard inventory so coexisting distress
  // rows don't double-appear — UNLESS the user's expression references sale_type
  // explicitly (then they've opted into a specific distress view).
  const saleTypeDefault = compiled.usedColumns.includes('sale_type')
    ? ''
    : `sale_type = 'standard' AND`;
  // Lifecycle default: hide off-market inventory. `includeSold` relaxes only the
  // sold exclusion (stale + rental_misfiled always stay hidden). Both branches
  // are fixed server strings — no user value is interpolated.
  const lifecycleFilter = body.includeSold
    ? `listing_status NOT IN ('stale','rental_misfiled')`
    : `listing_status NOT IN ('sold','stale','rental_misfiled')`;
  const orderBySql = buildOrderBy(body.orderBy);
  // primary_photo is ~0.3% populated; photos live in the images jsonb — the
  // COALESCE below is the same fix the spotlight query needed (without it,
  // search cards said "Photo pending" while the property page had photos).
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
      COALESCE(primary_photo, images->>0) AS primary_photo,
      sale_type,
      listing_status,
      listing_status as status,
      sold_price,
      sold_date::text AS sold_date,
      days_on_market,
      price_cut_pct,
      rent_low,
      rent_high,
      rent_price_ratio,
      ${MOTIVATED_SELLER_SCORE_SQL} as motivated_score,
      zip_code
    FROM listings
    WHERE listing_type = 'for_sale'
      AND ${lifecycleFilter}
      AND ${saleTypeDefault} (${compiled.whereSql})
    ORDER BY ${orderBySql}
    LIMIT ${effectiveLimit}
  `;

  try {
    const client = await pool.connect();
    try {
      // SET LOCAL only takes effect inside a transaction; without BEGIN/COMMIT it
      // is a silent no-op on a pooled client, leaving runaway predicates unbounded.
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const result = await withSpan(
        'query.expression',
        () => client.query(sql, compiled.params),
        { usedColumns: compiled.usedColumns.join(','), paramCount: compiled.params.length }
      );
      await client.query('COMMIT');
      return NextResponse.json({
        items: result.rows,
        usedColumns: compiled.usedColumns,
        compiledWhere: compiled.whereSql,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/properties/query error:', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
