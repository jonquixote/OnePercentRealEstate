import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withSpan } from '@/lib/tracing';
import { getSessionUser } from '@/lib/auth';
import { parse, compile, ALLOWED_COLUMNS_LIST } from '@oper/query-lang';
import { MOTIVATED_SELLER_SCORE_SQL } from '@oper/primitives';
import {
  resolveExportColumns,
  csvEscape,
  type CsvExportRow,
} from '@/lib/csvColumns';

/**
 * X1 — pro CSV export.
 *
 * Streams a server-generated CSV of a screen's FULL result set, built from the
 * SAME compiled query as /api/properties/query so the rows match what the
 * table + StatBar show. Pro-gated (free → 402 upsell). Capped at 10,000 rows.
 *
 * SECURITY / PARITY
 * -----------------
 *  - Identity is the session user; a screen can only be exported by its owner
 *    (`terminal_screens.user_id = session.id`).
 *  - The query-lang expression is ALWAYS re-parsed + re-compiled server-side
 *    (parameterized WHERE, whitelisted columns). The client never ships SQL.
 *  - The WHERE shape mirrors the query route exactly: `listing_type='for_sale'
 *    AND [sale_type='standard' AND] (<compiled where>)`, defaulting to standard
 *    inventory unless the expression references sale_type — so the CSV row set
 *    equals the on-screen row set.
 *
 * Input: `{ screenId }` (a saved user screen — the canonical path) OR
 * `{ expression, columns }` (built-in / live expression, which have no
 * terminal_screens row). Either way the expression is recompiled server-side.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ExportBodySchema = z.object({
  screenId: z.number().int().positive().optional(),
  expression: z.string().min(1).max(500).optional(),
  columns: z.array(z.string().max(64)).max(64).optional(),
  orderBy: z
    .object({ col: z.string().max(64), dir: z.enum(['asc', 'desc']) })
    .optional(),
  // Optional label for the download filename (built-in / live path; the
  // screenId path derives the name from the saved row).
  name: z.string().max(120).optional(),
});

const MAX_ROWS = 10_000;
const STATEMENT_TIMEOUT_MS = 15_000;

/**
 * ORDER BY whitelist — identical trust boundary to the query route: the client
 * only ships a raw column id, the value here is hand-authored SQL. Anything not
 * listed falls back to `id DESC`.
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

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'screen';
}

export async function POST(req: NextRequest) {
  // --- Auth + pro gate ----------------------------------------------------
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  if (user.tier !== 'pro') {
    return NextResponse.json(
      { error: 'PRO_REQUIRED', upsell: true },
      { status: 402 },
    );
  }

  // --- Parse body ---------------------------------------------------------
  let body: z.infer<typeof ExportBodySchema>;
  try {
    const parsed = ExportBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid body', details: parsed.error.format() },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  // --- Resolve the expression + columns -----------------------------------
  // screenId is the canonical path: load the user's saved screen so we export
  // exactly what they saved (never a client-supplied expression for a stored
  // screen). Built-in / live screens have no row → fall back to the body.
  let expression: string;
  let columnIds: string[] | null;
  let screenName: string;

  if (body.screenId != null) {
    const screen = await pool.query(
      'SELECT name, expression, columns FROM terminal_screens WHERE id = $1 AND user_id = $2',
      [body.screenId, user.id],
    );
    if (screen.rowCount === 0) {
      return NextResponse.json(
        { error: 'screen not found or access denied' },
        { status: 404 },
      );
    }
    const row = screen.rows[0];
    expression = typeof row.expression === 'string' ? row.expression : '';
    columnIds = Array.isArray(row.columns) ? (row.columns as string[]) : null;
    screenName = typeof row.name === 'string' ? row.name : 'screen';
  } else if (body.expression) {
    expression = body.expression;
    columnIds = body.columns ?? null;
    screenName = body.name ?? 'screen';
  } else {
    return NextResponse.json(
      { error: 'screenId or expression required' },
      { status: 400 },
    );
  }

  if (!expression.trim()) {
    return NextResponse.json(
      { error: 'screen has no expression to export' },
      { status: 400 },
    );
  }

  // --- Recompile the expression server-side -------------------------------
  let compiled;
  try {
    compiled = compile(parse(expression));
  } catch (err) {
    return NextResponse.json(
      {
        error: 'expression parse/compile error',
        message: (err as Error).message,
        allowedColumns: ALLOWED_COLUMNS_LIST,
      },
      { status: 400 },
    );
  }

  const columns = resolveExportColumns(columnIds);

  // --- Build the SELECT (mirrors the query route WHERE + sale_type default) --
  const saleTypeDefault = compiled.usedColumns.includes('sale_type')
    ? ''
    : `sale_type = 'standard' AND`;
  const orderBySql = buildOrderBy(body.orderBy);
  const sql = `
    SELECT
      id::text AS id,
      address,
      price,
      estimated_rent,
      bedrooms,
      bathrooms,
      sqft,
      year_built,
      sale_type,
      listing_status,
      days_on_market,
      price_cut_pct,
      price_cut_count,
      rent_low,
      rent_high,
      rent_price_ratio,
      zip_code
    FROM listings
    WHERE listing_type = 'for_sale'
      AND ${saleTypeDefault} (${compiled.whereSql})
    ORDER BY ${orderBySql}
    LIMIT ${MAX_ROWS}
  `;

  let rows: CsvExportRow[];
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const result = await withSpan(
        'export.expression',
        () => client.query(sql, compiled.params),
        {
          usedColumns: compiled.usedColumns.join(','),
          paramCount: compiled.params.length,
        },
      );
      await client.query('COMMIT');
      rows = result.rows as CsvExportRow[];
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/properties/export error:', err);
    return NextResponse.json({ error: 'export failed' }, { status: 500 });
  }

  // --- Stream the CSV -----------------------------------------------------
  const encoder = new TextEncoder();
  const headerLine = columns.map((c) => csvEscape(c.def.header)).join(',') + '\n';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(headerLine));
      // Chunk rows so a 10K export doesn't build one giant string.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        let buf = '';
        for (const row of slice) {
          buf += columns.map((c) => csvEscape(c.def.value(row))).join(',') + '\n';
        }
        controller.enqueue(encoder.encode(buf));
      }
      controller.close();
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `oper-screen-${slugify(screenName)}-${date}.csv`;

  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
