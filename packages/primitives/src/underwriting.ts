/**
 * underwriting.ts — the single source of truth for real-estate rule math.
 *
 * Every surface (DB filters, API responses, grading, frontend display) resolves
 * from THIS module's formulas and the resolved RuleConfig. SQL mirrors these
 * formulas line-for-line for the hot filter path; a parity test (underwriting.test.ts)
 * asserts they agree.
 *
 * Conventions:
 *  - All ratios/rates are FRACTIONS (0.01 = 1%). Never percentages.
 *  - GRM and price-to-rent use ANNUAL rent (price / (monthlyRent * 12)).
 *  - NOI for rule evaluation uses the 50%-rule operating-expense convention
 *    (opex = opexRatio * gross rent) so it is consistent and SQL-indexable.
 *    The interactive what-if calculator (calculators.ts) keeps a detailed expense
 *    breakdown for user exploration — that is NOT the basis for pass/fail badges.
 */

export type Strategy = 'buy_hold' | 'brrrr' | 'flip' | 'str';

export type SaleType =
  | 'standard'
  | 'foreclosure'
  | 'pre_foreclosure'
  | 'reo'
  | 'auction'
  | 'short_sale';

export type ResolutionTier =
  | 'exact'
  | 'type_standard'
  | 'default_saletype'
  | 'default_standard';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Mirrors the resolved row from SQL resolve_rule(). All thresholds optional/nullable. */
export interface RuleConfig {
  ruleId?: number;
  resolvedTier?: ResolutionTier;
  matchedPropertyType?: string;
  matchedSaleType?: SaleType;
  strategy: Strategy;
  // buy-and-hold thresholds
  targetRatio?: number | null;
  minGrossYield?: number | null;
  targetGrm?: number | null;
  targetCapRate?: number | null;
  targetCoc?: number | null;
  minDscr?: number | null;
  minDebtYield?: number | null;
  maxPriceToRent?: number | null;
  fiftyPctOpexRatio?: number | null;
  // flip / BRRRR
  arvDiscount?: number | null;
  rehabPerSqft?: number | null;
  minFlipRoi?: number | null;
  refiLtv?: number | null;
  // STR
  strAdr?: number | null;
  strOccupancy?: number | null;
  strTargetCapRate?: number | null;
  // financing assumptions
  downPaymentPct: number;
  interestRate: number;
  loanTermYears: number;
  closingCostPct: number;
  propertyTaxRate: number;
  insuranceAnnual: number;
  // provenance
  isProvisional?: boolean;
  ruleVersion?: string | null;
  ruleSetVersion?: number | null;
}

export interface RuleContext {
  propertyType?: string | null;
  saleType?: SaleType | null;
  strategy: Strategy;
}

export interface PropertyInputs {
  price: number;
  monthlyRent: number; // estimated_rent
  sqft?: number | null;
  hoaMonthly?: number | null;
  arv?: number | null; // after-repair value; defaults to price when unknown
  rehabBudget?: number | null; // explicit rehab cost; else derived from rehabPerSqft * sqft
  daysOnMarket?: number | null;
  yearBuilt?: number | null;
}

export type Comparator = 'gte' | 'lte';

export interface RuleResult {
  rule: string; // stable id, e.g. 'one_percent'
  label: string; // human label
  comparator: Comparator;
  value: number | null; // computed metric (fraction or multiple)
  threshold: number | null; // resolved threshold
  available: boolean; // had data + a threshold to evaluate
  passes: boolean | null; // null when unavailable
  summary: string;
}

export interface RuleEvaluation {
  strategy: Strategy;
  context: { propertyType?: string | null; saleType?: SaleType | null };
  config: RuleConfig;
  resolvedTier?: ResolutionTier;
  isProvisional: boolean;
  metrics: Record<string, number | null>;
  rules: RuleResult[];
  applicableRules: number;
  passedRules: number;
  strategyPass: boolean | null; // passes ALL available rules for the strategy
  score?: number; // 0..100 composite
  grade?: Grade;
}

/* ------------------------------------------------------------------ */
/* Pure metric functions (fractions; null-safe)                        */
/* ------------------------------------------------------------------ */

const ok = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

export function rentToPriceMonthly(price: number, monthlyRent: number): number | null {
  return price > 0 && ok(monthlyRent) ? monthlyRent / price : null;
}

export function grossYield(price: number, monthlyRent: number): number | null {
  return price > 0 && ok(monthlyRent) ? (monthlyRent * 12) / price : null;
}

export function grm(price: number, monthlyRent: number): number | null {
  const annual = monthlyRent * 12;
  return annual > 0 && ok(price) ? price / annual : null;
}

/** Annual NOI using the 50%-rule operating-expense convention. */
export function noiAnnual(monthlyRent: number, opexRatio: number): number | null {
  return ok(monthlyRent) && ok(opexRatio) ? monthlyRent * 12 * (1 - opexRatio) : null;
}

export function capRate(
  price: number,
  monthlyRent: number,
  opexRatio: number
): number | null {
  const noi = noiAnnual(monthlyRent, opexRatio);
  return noi !== null && price > 0 ? noi / price : null;
}

export function loanAmount(price: number, downPaymentPct: number): number {
  return price * (1 - downPaymentPct);
}

/** Standard amortizing monthly payment. */
export function monthlyMortgage(
  principal: number,
  annualRate: number,
  years: number
): number {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 12;
  const n = years * 12;
  return (principal * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

export function annualDebtService(cfg: RuleConfig, price: number): number {
  const principal = loanAmount(price, cfg.downPaymentPct);
  return monthlyMortgage(principal, cfg.interestRate, cfg.loanTermYears) * 12;
}

export function dscr(noi: number | null, debtService: number): number | null {
  return noi !== null && debtService > 0 ? noi / debtService : null;
}

export function debtYield(noi: number | null, loan: number): number | null {
  return noi !== null && loan > 0 ? noi / loan : null;
}

export function cashInvested(cfg: RuleConfig, price: number): number {
  return price * cfg.downPaymentPct + price * cfg.closingCostPct;
}

export function annualCashflow(noi: number | null, debtService: number): number | null {
  return noi !== null ? noi - debtService : null;
}

export function cashOnCash(cashflow: number | null, invested: number): number | null {
  return cashflow !== null && invested > 0 ? cashflow / invested : null;
}

/** 70% rule maximum allowable offer: ARV * arvDiscount - rehab. */
export function maoFlip(arv: number, rehab: number, arvDiscount: number): number {
  return arv * arvDiscount - rehab;
}

/** Flip ROI = (net sale proceeds - all-in cost) / all-in cost. */
export function flipRoi(
  arv: number,
  purchasePrice: number,
  rehab: number,
  sellingCostPct = 0.08
): number | null {
  const allIn = purchasePrice + rehab;
  if (allIn <= 0) return null;
  return (arv * (1 - sellingCostPct) - allIn) / allIn;
}

/** Cash left in a BRRRR deal after cash-out refi. Negative/zero = fully recycled. */
export function brrrrCashLeft(
  arv: number,
  refiLtv: number,
  purchasePrice: number,
  rehab: number
): number {
  return purchasePrice + rehab - arv * refiLtv;
}

/** Provisional STR annual revenue = ADR * occupancy * 365. */
export function strRevenueAnnual(adr: number, occupancy: number): number | null {
  return ok(adr) && ok(occupancy) ? adr * occupancy * 365 : null;
}

function deriveRehab(inputs: PropertyInputs, cfg: RuleConfig): number {
  if (ok(inputs.rehabBudget)) return inputs.rehabBudget!;
  if (ok(inputs.sqft) && ok(cfg.rehabPerSqft)) return inputs.sqft! * cfg.rehabPerSqft!;
  return 0;
}

/* ------------------------------------------------------------------ */
/* TS mirror of resolve_rule() — pick from the active rule rows         */
/* ------------------------------------------------------------------ */

// Label the matched candidate. When saleType is 'standard' the (DEFAULT,standard)
// pair satisfies both "default_saletype" and "default_standard" — the standard
// check wins so the tier is reported honestly. Mirrors the SQL CASE in resolve_rule.
function tierLabel(mp: string, ms: string, type: string, sale: string): ResolutionTier {
  if (mp === type && ms === sale) return 'exact';
  if (mp === type && ms === 'standard') return 'type_standard';
  if (mp === 'DEFAULT' && ms === 'standard') return 'default_standard';
  return 'default_saletype';
}

export function resolveRuleFrom(
  rows: RuleConfig[],
  ctx: RuleContext
): RuleConfig | null {
  const type = (ctx.propertyType || 'DEFAULT').toUpperCase();
  const sale = ctx.saleType || 'standard';
  const chain: Array<[string, string]> = [
    [type, sale],
    [type, 'standard'],
    ['DEFAULT', sale],
    ['DEFAULT', 'standard'],
  ];
  for (const [mp, ms] of chain) {
    const hit = rows.find(
      (r) =>
        r.strategy === ctx.strategy &&
        (r.matchedPropertyType || 'DEFAULT').toUpperCase() === mp &&
        (r.matchedSaleType || 'standard') === ms
    );
    if (hit) return { ...hit, resolvedTier: tierLabel(mp, ms, type, sale) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Rule evaluation (explainable-first)                                 */
/* ------------------------------------------------------------------ */

function mkRule(
  rule: string,
  label: string,
  comparator: Comparator,
  value: number | null,
  threshold: number | null | undefined,
  fmt: (v: number) => string
): RuleResult {
  const t = threshold ?? null;
  const available = value !== null && t !== null;
  let passes: boolean | null = null;
  if (available) passes = comparator === 'gte' ? value! >= t! : value! <= t!;
  const summary = available
    ? `${label}: ${fmt(value!)} ${comparator === 'gte' ? '≥' : '≤'} ${fmt(t!)} → ${passes ? 'pass' : 'fail'}`
    : `${label}: insufficient data`;
  return { rule, label, comparator, value, threshold: t, available, passes, summary };
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const mult = (v: number) => `${v.toFixed(1)}×`;
const ratio = (v: number) => v.toFixed(2);

export function evaluateRules(
  inputs: PropertyInputs,
  cfg: RuleConfig,
  ctx?: Partial<RuleContext>
): RuleEvaluation {
  const { price, monthlyRent } = inputs;
  const opex = cfg.fiftyPctOpexRatio ?? 0.5;
  const noi = noiAnnual(monthlyRent, opex);
  const ds = annualDebtService(cfg, price);
  const loan = loanAmount(price, cfg.downPaymentPct);
  const invested = cashInvested(cfg, price);
  const cf = annualCashflow(noi, ds);

  const metrics: Record<string, number | null> = {
    rentToPriceMonthly: rentToPriceMonthly(price, monthlyRent),
    grossYield: grossYield(price, monthlyRent),
    grm: grm(price, monthlyRent),
    priceToRent: grm(price, monthlyRent),
    capRate: capRate(price, monthlyRent, opex),
    cashOnCash: cashOnCash(cf, invested),
    dscr: dscr(noi, ds),
    debtYield: debtYield(noi, loan),
    noiAnnual: noi,
    annualCashflow: cf,
  };

  const rules: RuleResult[] = [];

  if (cfg.strategy === 'buy_hold' || cfg.strategy === 'brrrr') {
    rules.push(
      mkRule('one_percent', '1% rule', 'gte', metrics.rentToPriceMonthly, cfg.targetRatio, pct),
      mkRule('gross_yield', 'Gross yield', 'gte', metrics.grossYield, cfg.minGrossYield, pct),
      mkRule('grm', 'GRM', 'lte', metrics.grm, cfg.targetGrm, mult),
      mkRule('cap_rate', 'Cap rate', 'gte', metrics.capRate, cfg.targetCapRate, pct),
      mkRule('cash_on_cash', 'Cash-on-cash', 'gte', metrics.cashOnCash, cfg.targetCoc, pct),
      mkRule('dscr', 'DSCR', 'gte', metrics.dscr, cfg.minDscr, ratio),
      mkRule('debt_yield', 'Debt yield', 'gte', metrics.debtYield, cfg.minDebtYield, pct),
      mkRule('price_to_rent', 'Price-to-rent', 'lte', metrics.priceToRent, cfg.maxPriceToRent, mult)
    );
  }

  if (cfg.strategy === 'flip' || cfg.strategy === 'brrrr') {
    const arv = ok(inputs.arv) ? inputs.arv! : price;
    const rehab = deriveRehab(inputs, cfg);
    const mao = ok(cfg.arvDiscount) ? maoFlip(arv, rehab, cfg.arvDiscount!) : null;
    const roi = flipRoi(arv, price, rehab);
    metrics.mao = mao;
    metrics.flipRoi = roi;
    // 70% rule: purchase price must be at or below MAO.
    rules.push(
      mkRule('seventy_rule', '70% rule (price ≤ MAO)', 'lte', price, mao, (v) =>
        `$${Math.round(v).toLocaleString()}`
      )
    );
    if (cfg.strategy === 'flip') {
      rules.push(mkRule('flip_roi', 'Flip ROI', 'gte', roi, cfg.minFlipRoi, pct));
    } else {
      // BRRRR: cash left in deal after refi should be ≤ 0 (fully recycled).
      const cashLeft = ok(cfg.refiLtv) ? brrrrCashLeft(arv, cfg.refiLtv!, price, rehab) : null;
      metrics.brrrrCashLeft = cashLeft;
      rules.push(
        mkRule('brrrr_recycle', 'BRRRR capital recycled', 'lte', cashLeft, 0, (v) =>
          `$${Math.round(v).toLocaleString()}`
        )
      );
    }
  }

  if (cfg.strategy === 'str') {
    const rev = ok(cfg.strAdr) && ok(cfg.strOccupancy)
      ? strRevenueAnnual(cfg.strAdr!, cfg.strOccupancy!)
      : null;
    const strCap = rev !== null && price > 0 ? (rev * (1 - opex)) / price : null;
    metrics.strRevenueAnnual = rev;
    metrics.strCapRate = strCap;
    rules.push(mkRule('str_cap_rate', 'STR cap rate', 'gte', strCap, cfg.strTargetCapRate, pct));
  }

  const applicable = rules.filter((r) => r.available);
  const passed = applicable.filter((r) => r.passes);
  const strategyPass = applicable.length > 0 ? passed.length === applicable.length : null;

  const evaluation: RuleEvaluation = {
    strategy: cfg.strategy,
    context: { propertyType: ctx?.propertyType, saleType: ctx?.saleType },
    config: cfg,
    resolvedTier: cfg.resolvedTier,
    isProvisional: !!cfg.isProvisional,
    metrics,
    rules,
    applicableRules: applicable.length,
    passedRules: passed.length,
    strategyPass,
  };

  const scored = compositeScore(inputs, evaluation);
  evaluation.score = scored.score;
  evaluation.grade = scored.grade;
  return evaluation;
}

/* ------------------------------------------------------------------ */
/* Composite score / grade                                             */
/* ------------------------------------------------------------------ */

const HEADLINES: Record<Grade, string> = {
  A: 'Exceptional opportunity',
  B: 'Above-average opportunity',
  C: 'Solid but unremarkable',
  D: 'Marginal — proceed carefully',
  F: 'Likely unprofitable — avoid',
};

export function scoreToGrade(score: number): Grade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function headlineForGrade(g: Grade): string {
  return HEADLINES[g];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Composite 0..100 score. Buy-hold/BRRRR use a weighted category model
 * (rescaled against available data); flip/STR score off their rule pass ratio
 * blended with the headline return metric.
 */
export function compositeScore(
  inputs: PropertyInputs,
  evaluation: RuleEvaluation
): { score: number; grade: Grade; headline: string } {
  let score: number;
  if (evaluation.strategy === 'flip' || evaluation.strategy === 'str') {
    const ratioPart =
      evaluation.applicableRules > 0
        ? evaluation.passedRules / evaluation.applicableRules
        : 0;
    const roi = evaluation.metrics.flipRoi ?? evaluation.metrics.strCapRate ?? 0;
    const roiPart = clamp((roi ?? 0) / 0.25, 0, 1); // 25% ROI/cap saturates
    score = Math.round((ratioPart * 0.6 + roiPart * 0.4) * 100);
  } else {
    score = buyHoldScore(inputs, evaluation);
  }
  const grade = scoreToGrade(score);
  return { score, grade, headline: HEADLINES[grade] };
}

const BUY_HOLD_WEIGHTS = {
  one_percent: 25,
  cap_rate: 20,
  cash_on_cash: 20,
  cashflow: 15,
  hoa: 5,
  age: 5,
  sqft: 5,
  dom: 5,
} as const;

function buyHoldScore(inputs: PropertyInputs, ev: RuleEvaluation): number {
  const cats: Array<{ pts: number; weight: number; available: boolean }> = [];
  const ratioM = ev.metrics.rentToPriceMonthly;
  const target = ev.config.targetRatio ?? 0.01;

  // 1% rule
  if (ratioM === null) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.one_percent, available: false });
  else {
    let pts = 0;
    if (ratioM >= target) pts = BUY_HOLD_WEIGHTS.one_percent;
    else if (ratioM >= target * 0.85) pts = 12;
    cats.push({ pts, weight: BUY_HOLD_WEIGHTS.one_percent, available: true });
  }
  // cap rate, linear vs (targetCapRate or 0.10 ceiling)
  const cap = ev.metrics.capRate;
  const capCeil = Math.max(0.06, (ev.config.targetCapRate ?? 0.06) * 1.6);
  if (cap === null || cap === 0) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.cap_rate, available: false });
  else cats.push({ pts: Math.round(clamp(cap / capCeil, 0, 1) * BUY_HOLD_WEIGHTS.cap_rate), weight: BUY_HOLD_WEIGHTS.cap_rate, available: true });
  // cash-on-cash, linear vs ceiling
  const coc = ev.metrics.cashOnCash;
  const cocCeil = Math.max(0.10, (ev.config.targetCoc ?? 0.08) * 1.6);
  if (coc === null) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.cash_on_cash, available: false });
  else cats.push({ pts: Math.round(clamp(coc / cocCeil, 0, 1) * BUY_HOLD_WEIGHTS.cash_on_cash), weight: BUY_HOLD_WEIGHTS.cash_on_cash, available: true });
  // cashflow (monthly)
  const cf = ev.metrics.annualCashflow;
  if (cf === null) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.cashflow, available: false });
  else {
    const m = cf / 12;
    let pts = 0;
    if (m >= 200) pts = BUY_HOLD_WEIGHTS.cashflow;
    else if (m > 0) pts = 10;
    else if (m === 0) pts = 4;
    cats.push({ pts, weight: BUY_HOLD_WEIGHTS.cashflow, available: true });
  }
  // HOA reasonableness
  const hoa = inputs.hoaMonthly;
  if (hoa === null || hoa === undefined || hoa === 0)
    cats.push({ pts: BUY_HOLD_WEIGHTS.hoa, weight: BUY_HOLD_WEIGHTS.hoa, available: true });
  else if (!inputs.monthlyRent || inputs.monthlyRent <= 0)
    cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.hoa, available: false });
  else {
    const r = hoa / inputs.monthlyRent;
    const pts = r < 0.1 ? BUY_HOLD_WEIGHTS.hoa : r <= 0.2 ? 2 : 0;
    cats.push({ pts, weight: BUY_HOLD_WEIGHTS.hoa, available: true });
  }
  // age
  const yb = inputs.yearBuilt;
  if (!yb || yb <= 0) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.age, available: false });
  else {
    const age = new Date().getFullYear() - yb;
    const pts = age <= 30 ? BUY_HOLD_WEIGHTS.age : age <= 60 ? 3 : 1;
    cats.push({ pts, weight: BUY_HOLD_WEIGHTS.age, available: true });
  }
  // sqft
  const sqft = inputs.sqft;
  if (!sqft || sqft <= 0) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.sqft, available: false });
  else cats.push({ pts: sqft >= 800 ? BUY_HOLD_WEIGHTS.sqft : 2, weight: BUY_HOLD_WEIGHTS.sqft, available: true });
  // days on market
  const dom = inputs.daysOnMarket;
  if (dom === null || dom === undefined || dom < 0) cats.push({ pts: 0, weight: BUY_HOLD_WEIGHTS.dom, available: false });
  else cats.push({ pts: dom < 14 ? BUY_HOLD_WEIGHTS.dom : dom <= 60 ? 3 : 0, weight: BUY_HOLD_WEIGHTS.dom, available: true });

  const evalable = cats.filter((c) => c.available);
  const raw = evalable.reduce((a, c) => a + c.pts, 0);
  const max = evalable.reduce((a, c) => a + c.weight, 0);
  return max > 0 ? Math.round((raw / max) * 100) : 0;
}
