/**
 * Compiles an AST to parameterized SQL with strict security validation.
 *
 * Security model:
 * - Column names are validated against a strict whitelist and emitted as quoted identifiers.
 * - All values become $N placeholders; no string interpolation.
 * - IN-lists materialize as $N, $N+1, ... placeholders.
 * - Reject anything outside the whitelist with a descriptive error.
 *
 * Test cases (inline validation):
 *   price < 300000
 *     → SELECT ... WHERE "price" < $1 [300000]
 *   bedrooms >= 3 AND state = 'TX'
 *     → SELECT ... WHERE "bedrooms" >= $1 AND "state" = $2 [3, 'TX']
 *   '; DROP TABLE listings;--' (SQL injection attempt)
 *     → Error: Invalid column name
 *   price < (SELECT...) (subquery attempt)
 *     → Error: Expected value but got unexpected token
 *   state in ('TX', 'CA', 'NY')
 *     → SELECT ... WHERE "state" IN ($1, $2, $3) ['TX', 'CA', 'NY']
 */

import type { ASTNode, Clause } from './grammar';

// Strict whitelist of allowed columns for filtering
const ALLOWED_COLUMNS = new Set([
  'price',
  'bedrooms',
  'bathrooms',
  'sqft',
  'estimated_rent',
  'year_built',
  'state',
  'city',
  'zip_code',
]);

export interface CompileResult {
  sql: string;
  params: any[];
}

/**
 * Validate a column name against the whitelist.
 * @param column The column name to validate
 * @throws If the column is not on the whitelist
 */
function validateColumn(column: string): void {
  if (!ALLOWED_COLUMNS.has(column)) {
    throw new Error(
      `Invalid column name: '${column}'. Allowed columns: ${Array.from(ALLOWED_COLUMNS).join(', ')}`
    );
  }
}

/**
 * Compile an AST to a parameterized SQL WHERE clause fragment and parameter list.
 * @param ast The AST to compile
 * @returns An object with 'sql' (WHERE fragment) and 'params' (parameterized values)
 * @throws If validation fails
 */
export function compile(ast: ASTNode): CompileResult {
  const params: any[] = [];
  const conditions: string[] = [];

  for (const clause of ast.clauses) {
    validateColumn(clause.column);

    const quotedCol = `"${clause.column}"`;

    if (clause.op === 'in') {
      // Handle IN operator
      if (!Array.isArray(clause.value)) {
        throw new Error(`IN operator requires an array of values, got ${typeof clause.value}`);
      }
      if (clause.value.length === 0) {
        throw new Error('IN operator requires at least one value');
      }

      const startIdx = params.length;
      for (const v of clause.value) {
        params.push(v);
      }
      const inPlaceholders = Array.from(
        { length: clause.value.length },
        (_, i) => `$${startIdx + i + 1}`
      ).join(', ');

      conditions.push(`${quotedCol} IN (${inPlaceholders})`);
    } else {
      // Handle standard comparison operators
      params.push(clause.value);
      const paramIdx = params.length;
      conditions.push(`${quotedCol} ${clause.op} $${paramIdx}`);
    }
  }

  const sql = conditions.join(' AND ');
  return { sql, params };
}
