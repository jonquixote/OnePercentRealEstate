import { describe, it, expect } from 'vitest';
import {
  rentToPriceMonthly,
  grossYield,
  grm,
  capRate,
  monthlyMortgage,
  dscr,
  debtYield,
  maoFlip,
  flipRoi,
  brrrrCashLeft,
  resolveRuleFrom,
  evaluateRules,
  scoreToGrade,
  annualDebtService,
  annualCashflow,
  cashInvested,
  cashOnCash,
  type RuleConfig,
} from './underwriting';

const BUY_HOLD_BASE: RuleConfig = {
  strategy: 'buy_hold',
  targetRatio: 0.01,
  minGrossYield: 0.12,
  targetGrm: 8.33,
  targetCapRate: 0.06,
  targetCoc: 0.08,
  minDscr: 1.2,
  minDebtYield: 0.09,
  maxPriceToRent: 8.33,
  fiftyPctOpexRatio: 0.5,
  downPaymentPct: 0.2,
  interestRate: 0.065,
  loanTermYears: 30,
  closingCostPct: 0.03,
  propertyTaxRate: 0.012,
  insuranceAnnual: 1200,
};

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('pure metric functions (fractions)', () => {
  it('rentToPriceMonthly', () => {
    expect(rentToPriceMonthly(200_000, 2000)).toBeCloseTo(0.01, 12);
    expect(rentToPriceMonthly(0, 2000)).toBeNull();
  });
  it('grossYield = annual rent / price', () => {
    expect(grossYield(200_000, 2000)).toBeCloseTo(0.12, 12);
  });
  it('grm = price / annual rent', () => {
    expect(grm(200_000, 2000)).toBeCloseTo(8.3333333, 6);
    expect(grm(200_000, 0)).toBeNull();
  });
  it('capRate uses 50%-rule NOI', () => {
    // NOI = 2000*12*0.5 = 12000; cap = 12000/200000 = 0.06
    expect(capRate(200_000, 2000, 0.5)).toBeCloseTo(0.06, 12);
  });
  it('monthlyMortgage amortization + zero-rate fallback', () => {
    expect(monthlyMortgage(100_000, 0, 30)).toBeCloseTo(100_000 / 360, 9);
    const m = monthlyMortgage(160_000, 0.065, 30);
    expect(m).toBeGreaterThan(1000);
    expect(m).toBeLessThan(1020); // ~$1011
  });
  it('dscr / debtYield null-safe', () => {
    expect(dscr(12_000, 0)).toBeNull();
    expect(debtYield(12_000, 160_000)).toBeCloseTo(0.075, 12);
  });
  it('maoFlip = 70% rule', () => {
    expect(maoFlip(300_000, 40_000, 0.7)).toBeCloseTo(170_000, 6);
  });
  it('flipRoi', () => {
    const roi = flipRoi(300_000, 170_000, 40_000, 0.08);
    // net = 300k*0.92=276k; allIn=210k; roi=(276-210)/210
    expect(roi!).toBeCloseTo((276_000 - 210_000) / 210_000, 9);
  });
  it('brrrrCashLeft negative when fully recycled', () => {
    // arv 300k * 0.75 = 225k refi; allIn 200k -> cash left -25k
    expect(brrrrCashLeft(300_000, 0.75, 160_000, 40_000)).toBeCloseTo(-25_000, 6);
  });
});

describe('resolveRuleFrom precedence (TS mirror of SQL resolve_rule)', () => {
  const rows: RuleConfig[] = [
    { ...BUY_HOLD_BASE, matchedPropertyType: 'DEFAULT', matchedSaleType: 'standard' },
    { ...BUY_HOLD_BASE, matchedPropertyType: 'SINGLE_FAMILY', matchedSaleType: 'standard', targetRatio: 0.0125 },
    { ...BUY_HOLD_BASE, strategy: 'flip', matchedPropertyType: 'DEFAULT', matchedSaleType: 'auction', arvDiscount: 0.65 },
  ];
  it('exact type/standard match', () => {
    const r = resolveRuleFrom(rows, { propertyType: 'SINGLE_FAMILY', saleType: 'standard', strategy: 'buy_hold' });
    expect(r?.targetRatio).toBe(0.0125);
    expect(r?.resolvedTier).toBe('exact');
  });
  it('falls back to DEFAULT/standard', () => {
    const r = resolveRuleFrom(rows, { propertyType: 'CONDOS', saleType: 'standard', strategy: 'buy_hold' });
    expect(r?.resolvedTier).toBe('default_standard');
  });
  it('falls back to DEFAULT/sale_type for distress flip', () => {
    const r = resolveRuleFrom(rows, { propertyType: 'SINGLE_FAMILY', saleType: 'auction', strategy: 'flip' });
    expect(r?.resolvedTier).toBe('default_saletype');
    expect(r?.arvDiscount).toBe(0.65);
  });
  it('returns null when no strategy match', () => {
    expect(resolveRuleFrom(rows, { propertyType: 'X', saleType: 'standard', strategy: 'str' })).toBeNull();
  });
});

describe('evaluateRules — pass/fail fixtures', () => {
  it('buy_hold: a strong 1.5% deal passes all core rules', () => {
    const ev = evaluateRules({ price: 100_000, monthlyRent: 1500, sqft: 1200 }, BUY_HOLD_BASE);
    const onePct = ev.rules.find((r) => r.rule === 'one_percent')!;
    expect(onePct.passes).toBe(true);
    expect(ev.metrics.capRate).toBeCloseTo(0.09, 6); // 1500*12*0.5/100000
    expect(ev.strategyPass).toBe(true);
  });
  it('buy_hold: a 0.5% deal fails the 1% rule', () => {
    const ev = evaluateRules({ price: 400_000, monthlyRent: 2000 }, BUY_HOLD_BASE);
    expect(ev.rules.find((r) => r.rule === 'one_percent')!.passes).toBe(false);
    expect(ev.strategyPass).toBe(false);
  });
  it('flip: 70% rule passes below MAO, fails above', () => {
    const cfg: RuleConfig = { ...BUY_HOLD_BASE, strategy: 'flip', arvDiscount: 0.7, rehabPerSqft: 35, minFlipRoi: 0.15 };
    const pass = evaluateRules({ price: 150_000, monthlyRent: 0, arv: 300_000, rehabBudget: 40_000 }, cfg);
    expect(pass.rules.find((r) => r.rule === 'seventy_rule')!.passes).toBe(true); // MAO=170k, price 150k
    const fail = evaluateRules({ price: 200_000, monthlyRent: 0, arv: 300_000, rehabBudget: 40_000 }, cfg);
    expect(fail.rules.find((r) => r.rule === 'seventy_rule')!.passes).toBe(false);
  });
  it('str: provisional flag propagates', () => {
    const cfg: RuleConfig = { ...BUY_HOLD_BASE, strategy: 'str', strAdr: 150, strOccupancy: 0.6, strTargetCapRate: 0.08, isProvisional: true };
    const ev = evaluateRules({ price: 300_000, monthlyRent: 1500 }, cfg);
    expect(ev.isProvisional).toBe(true);
    expect(ev.rules.find((r) => r.rule === 'str_cap_rate')).toBeTruthy();
  });
  it('null/zero/missing data → rule unavailable, strategyPass null', () => {
    const ev = evaluateRules({ price: 0, monthlyRent: 0 }, BUY_HOLD_BASE);
    expect(ev.applicableRules).toBe(0);
    expect(ev.strategyPass).toBeNull();
  });
});

describe('gradable — insufficient-data instead of a misleading hard F', () => {
  it('STR with no ADR is not gradable', () => {
    const cfg: RuleConfig = { ...BUY_HOLD_BASE, strategy: 'str', strAdr: null, strOccupancy: 0.55, isProvisional: true };
    const ev = evaluateRules({ price: 300_000, monthlyRent: 1500 }, cfg);
    expect(ev.gradable).toBe(false);
    expect(ev.gradableReason).toMatch(/revenue signal/i);
  });
  it('flip without ARV is not gradable; with ARV it is', () => {
    const cfg: RuleConfig = { ...BUY_HOLD_BASE, strategy: 'flip', arvDiscount: 0.7, rehabPerSqft: 35, minFlipRoi: 0.15 };
    const noArv = evaluateRules({ price: 150_000, monthlyRent: 0, sqft: 1500 }, cfg);
    expect(noArv.gradable).toBe(false);
    const withArv = evaluateRules({ price: 150_000, monthlyRent: 0, sqft: 1500, arv: 300_000, rehabBudget: 40_000 }, cfg);
    expect(withArv.gradable).toBe(true);
  });
  it('buy_hold with real data is gradable', () => {
    const ev = evaluateRules({ price: 100_000, monthlyRent: 1500, sqft: 1200 }, BUY_HOLD_BASE);
    expect(ev.gradable).toBe(true);
  });
});

describe('grade boundaries', () => {
  it('maps scores to letters', () => {
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(85)).toBe('A');
    expect(scoreToGrade(84)).toBe('B');
    expect(scoreToGrade(70)).toBe('B');
    expect(scoreToGrade(55)).toBe('C');
    expect(scoreToGrade(40)).toBe('D');
    expect(scoreToGrade(39)).toBe('F');
  });
});

// ---------------------------------------------------------------------------
// DB-gated acceptance gate: TS formula == SQL formula, + classify precedence.
// Runs only when TEST_DATABASE_URL is set (CI / local-with-DB); otherwise skipped.
// ---------------------------------------------------------------------------
const TEST_DB = process.env.TEST_DATABASE_URL;
(TEST_DB ? describe : describe.skip)('SQL parity + classify precedence (DB-gated)', () => {
  it('TS metrics match raw SQL arithmetic', async () => {
    const { Client } = await import('pg');
    const c = new (Client as any)({ connectionString: TEST_DB });
    await c.connect();
    try {
      const fixtures = [
        { price: 200_000, rent: 2000 },
        { price: 135_000, rent: 1600 },
        { price: 410_000, rent: 1850 },
      ];
      for (const f of fixtures) {
        const { rows } = await c.query(
          `SELECT ($2::numeric/$1)             AS rtp,
                  (($2::numeric*12)/$1)         AS gy,
                  ($1::numeric/($2*12))         AS grm,
                  (($2::numeric*12*0.5)/$1)     AS cap`,
          [f.price, f.rent],
        );
        const r = rows[0];
        expect(near(rentToPriceMonthly(f.price, f.rent)!, Number(r.rtp))).toBe(true);
        expect(near(grossYield(f.price, f.rent)!, Number(r.gy))).toBe(true);
        expect(near(grm(f.price, f.rent)!, Number(r.grm), 1e-6)).toBe(true);
        expect(near(capRate(f.price, f.rent, 0.5)!, Number(r.cap))).toBe(true);
      }
    } finally {
      await c.end();
    }
  });

  it('classify_sale_type precedence reo>auction>short_sale>pre_foreclosure>foreclosure', async () => {
    const { Client } = await import('pg');
    const c = new (Client as any)({ connectionString: TEST_DB });
    await c.connect();
    try {
      const cases: Array<[string, string]> = [
        ['bank owned REO foreclosure auction', 'reo'],
        ['foreclosure auction short sale', 'auction'],
        ['short sale pending foreclosure', 'short_sale'],
        ['notice of default pre-foreclosure', 'pre_foreclosure'],
        ['foreclosure property', 'foreclosure'],
        ['lovely updated ranch', 'standard'],
        ['auctioneer listed this home', 'standard'], // word-boundary: not "auction"
        // v2: plural / verb forms must match
        ['multiple auctions scheduled', 'auction'],
        ['portfolio of reos', 'reo'],
        ['accepting short sales only', 'short_sale'],
        ['recently foreclosed property', 'foreclosure'],
      ];
      for (const [text, expected] of cases) {
        const { rows } = await c.query(
          `SELECT sale_type FROM classify_sale_type(jsonb_build_object('text', $1::text), NULL)`,
          [text],
        );
        expect(rows[0].sale_type).toBe(expected);
      }
    } finally {
      await c.end();
    }
  });

  it('classify_sale_type detects structured flags.is_foreclosure + confidence', async () => {
    const { Client } = await import('pg');
    const c = new (Client as any)({ connectionString: TEST_DB });
    await c.connect();
    try {
      // flags object with is_foreclosure true, no foreclosure text → still foreclosure
      const { rows } = await c.query(
        `SELECT sale_type, sale_type_source, sale_type_confidence
         FROM classify_sale_type(jsonb_build_object('text','nice home','flags', jsonb_build_object('is_foreclosure', true)), NULL)`,
      );
      expect(rows[0].sale_type).toBe('foreclosure');
      expect(Number(rows[0].sale_type_confidence)).toBeCloseTo(0.95, 5);
      // free-text-only match → lower confidence
      const { rows: r2 } = await c.query(
        `SELECT sale_type_confidence FROM classify_sale_type(jsonb_build_object('text','this is an auction'), NULL)`,
      );
      expect(Number(r2[0].sale_type_confidence)).toBeCloseTo(0.6, 5);
    } finally {
      await c.end();
    }
  });

  it('SQL resolve_rule precedence + thresholds match TS resolveRuleFrom', async () => {
    const { Client } = await import('pg');
    const c = new (Client as any)({ connectionString: TEST_DB });
    await c.connect();
    try {
      // Load the active rule matrix into TS (mirror of /api/underwriting-rules).
      const { rows } = await c.query(
        `SELECT property_type AS "matchedPropertyType", sale_type AS "matchedSaleType", strategy,
                target_ratio AS "targetRatio", down_payment_pct AS "downPaymentPct",
                interest_rate AS "interestRate", loan_term_years AS "loanTermYears",
                closing_cost_pct AS "closingCostPct", property_tax_rate AS "propertyTaxRate",
                insurance_annual AS "insuranceAnnual", arv_discount AS "arvDiscount"
         FROM underwriting_rules WHERE is_active AND effective_to IS NULL`,
      );
      const cfgRows = rows.map((r: any) => ({
        ...r,
        targetRatio: r.targetRatio != null ? Number(r.targetRatio) : null,
        downPaymentPct: Number(r.downPaymentPct), interestRate: Number(r.interestRate),
        loanTermYears: Number(r.loanTermYears), closingCostPct: Number(r.closingCostPct),
        propertyTaxRate: Number(r.propertyTaxRate), insuranceAnnual: Number(r.insuranceAnnual),
        arvDiscount: r.arvDiscount != null ? Number(r.arvDiscount) : null,
      }));
      const cases: Array<[string, string, 'buy_hold' | 'flip']> = [
        ['MULTI_FAMILY', 'standard', 'buy_hold'],
        ['SINGLE_FAMILY', 'auction', 'flip'],
        ['NONEXISTENT_TYPE', 'standard', 'buy_hold'],
        ['CONDOS', 'standard', 'buy_hold'],
      ];
      for (const [type, sale, strat] of cases) {
        const { rows: sql } = await c.query(
          `SELECT resolved_tier, target_ratio FROM resolve_rule($1,$2,$3)`,
          [type, sale, strat],
        );
        const ts = resolveRuleFrom(cfgRows as any, { propertyType: type, saleType: sale as any, strategy: strat });
        expect(ts).not.toBeNull();
        expect(ts!.resolvedTier).toBe(sql[0].resolved_tier);
        const sqlTr = sql[0].target_ratio != null ? Number(sql[0].target_ratio) : null;
        expect(ts!.targetRatio ?? null).toEqual(sqlTr);
      }
    } finally {
      await c.end();
    }
  });

  it('SQL cash-on-cash filter matches TS cashOnCash() (default financing)', async () => {
    const { Client } = await import('pg');
    const c = new (Client as any)({ connectionString: TEST_DB });
    await c.connect();
    try {
      const cfg: RuleConfig = { ...BUY_HOLD_BASE };
      for (const f of [{ price: 120_000, rent: 1500 }, { price: 300_000, rent: 1800 }]) {
        const { rows } = await c.query(
          `SELECT (((($2::numeric * 12 * 0.5) - ($1 * 0.8 * (0.0054166667 * power(1.0054166667,360) / (power(1.0054166667,360)-1)) * 12)) / NULLIF($1 * 0.23, 0))) AS coc`,
          [f.price, f.rent],
        );
        const noi = f.rent * 12 * 0.5;
        const ds = annualDebtService(cfg, f.price);
        const tsCoc = cashOnCash(annualCashflow(noi, ds), cashInvested(cfg, f.price));
        expect(near(tsCoc!, Number(rows[0].coc), 1e-6)).toBe(true);
      }
    } finally {
      await c.end();
    }
  });
});
