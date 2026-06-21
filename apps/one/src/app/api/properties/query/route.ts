import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { withSpan } from '@/lib/tracing';
import { parse, compile, ALLOWED_COLUMNS_LIST } from '@oper/query-lang';

export const dynamic = 'force-dynamic';

const QueryBodySchema = z.object({
  expression: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(1000).optional(),
});

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;
const STATEMENT_TIMEOUT_MS = 5_000;

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
    return NextResponse.json(
      {
        error: 'expression parse/compile error',
        message: (err as Error).message,
        allowedColumns: ALLOWED_COLUMNS_LIST,
      },
      { status: 400 }
    );
  }

  const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

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
  const sql = `
    SELECT
      id::text AS id,
      address,
      price,
      bedrooms,
      bathrooms,
      sqft,
      estimated_rent,
      year_built,
      primary_photo,
      sale_type,
      listing_status
    FROM listings
    WHERE listing_type = 'for_sale'
      AND ${saleTypeDefault} (${compiled.whereSql})
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  try {
    const client = await pool.connect();
    try {
      await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const result = await withSpan(
        'query.expression',
        () => client.query(sql, compiled.params),
        { usedColumns: compiled.usedColumns.join(','), paramCount: compiled.params.length }
      );
      return NextResponse.json({
        items: result.rows,
        usedColumns: compiled.usedColumns,
        compiledWhere: compiled.whereSql,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('/api/properties/query error:', err);
    return NextResponse.json({ error: 'query failed' }, { status: 500 });
  }
}
