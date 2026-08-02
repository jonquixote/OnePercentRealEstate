import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { query: h.query } }));

/** A subject row as `ARV_CTE` returns it — listing columns plus the comp-derived ARV. */
const listing = (over: Record<string, unknown> = {}) => ({
  id: '1',
  price: 120000,
  estimated_rent: 1500,
  sqft: 1400,
  property_type: 'Single Family',
  sale_type: 'standard',
  zip_code: '77002',
  arv: 165000,
  arv_comp_count: 12,
  ...over,
});

/** A resolve_rule() row: snake_case, NUMERIC as strings, exactly as pg returns it. */
const ruleRow = (over: Record<string, unknown> = {}) => ({
  rule_id: 7,
  resolved_tier: 'exact',
  matched_property_type: 'Single Family',
  matched_sale_type: 'standard',
  target_ratio: '0.01',
  min_gross_yield: '0.08',
  target_grm: '12',
  target_cap_rate: '0.05',
  target_coc: '0.06',
  min_dscr: '1.2',
  min_debt_yield: '0.08',
  max_price_to_rent: '15',
  fifty_pct_opex_ratio: '0.5',
  arv_discount: '0.7',
  rehab_per_sqft: '25',
  min_flip_roi: '0.15',
  refi_ltv: '0.75',
  str_adr: null,
  str_occupancy: null,
  str_target_cap_rate: '0.08',
  down_payment_pct: '0.25',
  interest_rate: '0.07',
  loan_term_years: 30,
  closing_cost_pct: '0.03',
  property_tax_rate: '0.012',
  insurance_annual: '1800',
  is_provisional: false,
  rule_version: 'v3',
  rule_set_version: 2,
  ...over,
});

/**
 * First query is the subject/ARV lookup; every later one is resolve_rule.
 *
 * `rule` uses an explicit null rather than an optional parameter because
 * `mockDb(listing(), undefined)` would trigger the default and silently supply
 * a rule to the very test asserting no rule exists.
 */
function mockDb(subject: Record<string, unknown> | undefined, rule: Record<string, unknown> | null = ruleRow()) {
  h.query.mockImplementation((sql: string) => {
    if (sql.includes('resolve_rule')) return Promise.resolve({ rows: rule ? [rule] : [] });
    return Promise.resolve({ rows: subject ? [subject] : [] });
  });
}

// The braces matter. `beforeEach(() => h.query.mockReset())` implicitly returns
// the mock, and vitest treats a value returned from beforeEach as that test's
// teardown function — so it invokes the mock with zero arguments after every
// test, and any implementation that reads its first argument throws during
// cleanup.
beforeEach(async () => {
  h.query.mockReset();
  // resolve_rule() results are cached in module state for an hour; without this
  // a later test would be answered by an earlier test's rule row.
  const { __clearRuleCache } = await import('./underwrite-deal');
  __clearRuleCache();
});

describe('underwriteDeal', () => {
  it('always returns all four lenses, in a stable order', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('1');
    expect(out.map((v) => v.strategy)).toEqual(['buy_hold', 'brrrr', 'flip', 'str']);
  });

  it('marks STR unavailable with a reason — never a fabricated number', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const str = (await underwriteDeal('1')).find((v) => v.strategy === 'str')!;
    expect(str.available).toBe(false);
    expect(str.reason).toMatch(/nightly.rate/i);
    expect(str.grade).toBeUndefined();
    expect(str.metrics).toEqual([]);
  });

  it('marks flip unavailable when the listing has no sqft (no rehab basis)', async () => {
    mockDb(listing({ sqft: null, arv: null, arv_comp_count: null }));
    const { underwriteDeal } = await import('./underwrite-deal');
    const flip = (await underwriteDeal('1')).find((v) => v.strategy === 'flip')!;
    expect(flip.available).toBe(false);
    expect(flip.reason).toMatch(/square footage/i);
  });

  it('marks flip and BRRRR unavailable when comps are too thin for an ARV', async () => {
    // The naive fallback would be arv = price, which asserts zero forced
    // appreciation as though it were a finding. It must not be reached.
    mockDb(listing({ arv: null, arv_comp_count: null }));
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('1');
    for (const s of ['flip', 'brrrr'] as const) {
      const v = out.find((x) => x.strategy === s)!;
      expect(v.available).toBe(false);
      expect(v.reason).toMatch(/comparable sales/i);
      expect(v.grade).toBeUndefined();
    }
    // Buy & hold does not depend on an ARV, so it still computes.
    expect(out.find((v) => v.strategy === 'buy_hold')!.available).toBe(true);
  });

  it('marks buy_hold unavailable when there is no rent estimate', async () => {
    mockDb(listing({ estimated_rent: null }));
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;
    expect(bh.available).toBe(false);
    expect(bh.reason).toMatch(/rent estimate/i);
  });

  it('computes a buy_hold grade and metrics when inputs exist', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;
    expect(bh.available).toBe(true);
    expect(bh.grade).toMatch(/^[ABCDF]$/);
    expect(bh.metrics.map((m) => m.label)).toEqual(
      expect.arrayContaining(['Cap rate', 'DSCR', 'Cash-on-cash']),
    );
  });

  it('formats each metric in its own unit rather than assuming percentages', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('1');

    const bh = out.find((v) => v.strategy === 'buy_hold')!;
    expect(bh.metrics.find((m) => m.label === 'Cap rate')!.value).toMatch(/^\d+\.\d{2}%$/);
    expect(bh.metrics.find((m) => m.label === 'GRM')!.value).toMatch(/^\d+\.\d×$/);
    expect(bh.metrics.find((m) => m.label === 'DSCR')!.value).toMatch(/^\d+\.\d{2}$/);

    // The dollar-denominated rules are the ones a blanket percent formatter
    // would render as "18200000.00%".
    const brrrr = out.find((v) => v.strategy === 'brrrr')!;
    expect(brrrr.metrics.find((m) => m.label.startsWith('70% rule'))!.value).toMatch(/^\$[\d,]+$/);
  });

  it('reads snake_case rule columns — a spread of the raw row would grade on nothing', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;

    // down_payment_pct 0.25 must arrive as downPaymentPct, not fall back to 0.2.
    expect(bh.assumptions!.downPaymentPct).toBe(0.25);
    expect(bh.assumptions!.interestRate).toBe(0.07);
    // Thresholds resolved, so rules were actually evaluated rather than skipped
    // as "insufficient data".
    expect(bh.metrics.every((m) => m.threshold !== null)).toBe(true);
    expect(bh.metrics.length).toBeGreaterThan(0);
  });

  it('carries rule provenance so the assumptions can be shown', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;
    expect(bh.assumptions).toMatchObject({
      resolvedTier: 'exact',
      isProvisional: false,
      ruleVersion: 'v3',
      opexRatio: 0.5,
    });
  });

  it('reports the comp count behind an ARV, and only on ARV-dependent lenses', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('1');
    expect(out.find((v) => v.strategy === 'brrrr')!.assumptions).toMatchObject({
      arv: 165000,
      arvCompCount: 12,
    });
    expect(out.find((v) => v.strategy === 'buy_hold')!.assumptions!.arv).toBeUndefined();
  });

  it('omits assumptions on an unavailable lens', async () => {
    mockDb(listing());
    const { underwriteDeal } = await import('./underwrite-deal');
    const str = (await underwriteDeal('1')).find((v) => v.strategy === 'str')!;
    expect(str.assumptions).toBeUndefined();
  });

  it('returns all-unavailable rather than throwing when the listing is missing', async () => {
    mockDb(undefined);
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('nope');
    expect(out).toHaveLength(4);
    expect(out.every((v) => !v.available)).toBe(true);
  });

  it('returns all-unavailable rather than throwing when the database errors', async () => {
    h.query.mockRejectedValue(new Error('connection terminated'));
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('1');
    expect(out).toHaveLength(4);
    expect(out.every((v) => !v.available)).toBe(true);
  });

  it('marks a lens unavailable when no rule is configured for the property type', async () => {
    mockDb(listing(), null);
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;
    expect(bh.available).toBe(false);
    expect(bh.reason).toMatch(/no underwriting rule/i);
  });
});
