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

/** A weighted scoring category (property-quality + rule signals) for the grade. */
export interface GradeCategory {
  label: string;
  weight: number;
  points: number;
  available: boolean;
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
  headline?: string;
  breakdown: GradeCategory[]; // weighted category bars (the single grade source)
  pros: string[];
  cons: string[];
  // false when the strategy lacks the inputs to produce a meaningful grade
  // (e.g. STR with no revenue signal, flip with no ARV) — UI shows an
  // "insufficient data" state instead of a misleading hard F.
  gradable: boolean;
  gradableReason?: string;
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
    breakdown: [],
    pros: [],
    cons: [],
    gradable: true,
  };

  // A strategy is only gradable when it has the inputs it needs. STR needs a
  // revenue signal (ADR×occupancy); flip needs a real ARV (we don't fake ARV=price).
  if (cfg.strategy === 'str' && (!ok(cfg.strAdr) || !ok(cfg.strOccupancy))) {
    evaluation.gradable = false;
    evaluation.gradableReason =
      'Short-term-rental grading needs a revenue signal (ADR × occupancy), which is not available yet.';
  } else if (cfg.strategy === 'flip' && !ok(inputs.arv)) {
    evaluation.gradable = false;
    evaluation.gradableReason =
      'Fix-and-flip grading needs an after-repair value (ARV) and rehab estimate.';
  } else if (applicable.length === 0) {
    evaluation.gradable = false;
    evaluation.gradableReason = 'Not enough data to grade this property.';
  }

  const scored = compositeScore(inputs, evaluation);
  evaluation.score = scored.score;
  evaluation.grade = scored.grade;
  evaluation.headline = scored.headline;
  evaluation.breakdown = scored.breakdown;
  evaluation.pros = scored.pros;
  evaluation.cons = scored.cons;
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

export interface ScoreResult {
  score: number;
  grade: Grade;
  headline: string;
  breakdown: GradeCategory[];
  pros: string[];
  cons: string[];
}

const fpct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmoney = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

/**
 * Composite 0..100 score + full category breakdown + pros/cons — the SINGLE
 * grade source consumed by the UI. Buy-hold/BRRRR use a weighted category model
 * (rescaled against available data); flip/STR derive categories from their rule
 * pass/fail set blended with the headline return metric.
 */
export function compositeScore(inputs: PropertyInputs, evaluation: RuleEvaluation): ScoreResult {
  const breakdown =
    evaluation.strategy === 'flip' || evaluation.strategy === 'str'
      ? strategyBreakdown(evaluation)
      : buyHoldBreakdown(inputs, evaluation);

  const evalable = breakdown.filter((c) => c.available);
  const raw = evalable.reduce((a, c) => a + c.points, 0);
  const max = evalable.reduce((a, c) => a + c.weight, 0);
  const score = max > 0 ? Math.round((raw / max) * 100) : 0;
  const grade = scoreToGrade(score);

  const pros: string[] = [];
  const cons: string[] = [];
  for (const c of breakdown) {
    if (!c.available) continue;
    if (c.points >= c.weight) pros.push(c.summary);
    else if (c.points === 0) cons.push(c.summary);
  }

  return { score, grade, headline: HEADLINES[grade], breakdown, pros, cons };
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

/** Flip/STR breakdown: each evaluated rule becomes a pass/fail category, plus the headline return. */
function strategyBreakdown(ev: RuleEvaluation): GradeCategory[] {
  const cats: GradeCategory[] = ev.rules.map((r) => ({
    label: r.label,
    weight: 1,
    points: r.passes ? 1 : 0,
    available: r.available,
    summary: r.summary,
  }));
  const roi = ev.metrics.flipRoi ?? ev.metrics.strCapRate ?? null;
  if (roi !== null) {
    cats.push({
      label: ev.strategy === 'flip' ? 'Projected ROI' : 'STR cap rate',
      weight: 2,
      points: Math.round(clamp(roi / 0.25, 0, 1) * 2),
      available: true,
      summary: `${ev.strategy === 'flip' ? 'Projected ROI' : 'STR cap rate'} ${fpct(roi)}`,
    });
  }
  return cats;
}

function buyHoldBreakdown(inputs: PropertyInputs, ev: RuleEvaluation): GradeCategory[] {
  const cats: GradeCategory[] = [];
  const ratioM = ev.metrics.rentToPriceMonthly;
  const target = ev.config.targetRatio ?? 0.01;

  // 1% rule
  if (ratioM === null) cats.push({ label: '1% Rule', weight: BUY_HOLD_WEIGHTS.one_percent, points: 0, available: false, summary: 'Rent-to-price unknown' });
  else if (ratioM >= target) cats.push({ label: '1% Rule', weight: BUY_HOLD_WEIGHTS.one_percent, points: BUY_HOLD_WEIGHTS.one_percent, available: true, summary: `Clears the rule (${fpct(ratioM)} ≥ ${fpct(target)})` });
  else if (ratioM >= target * 0.85) cats.push({ label: '1% Rule', weight: BUY_HOLD_WEIGHTS.one_percent, points: 12, available: true, summary: `Near the rule (${fpct(ratioM)})` });
  else cats.push({ label: '1% Rule', weight: BUY_HOLD_WEIGHTS.one_percent, points: 0, available: true, summary: `Below the rule (${fpct(ratioM)})` });

  // cap rate (linear vs ceiling derived from target)
  const cap = ev.metrics.capRate;
  const capCeil = Math.max(0.06, (ev.config.targetCapRate ?? 0.06) * 1.6);
  if (cap === null || cap === 0) cats.push({ label: 'Cap Rate', weight: BUY_HOLD_WEIGHTS.cap_rate, points: 0, available: false, summary: 'Cap rate unavailable' });
  else cats.push({ label: 'Cap Rate', weight: BUY_HOLD_WEIGHTS.cap_rate, points: Math.round(clamp(cap / capCeil, 0, 1) * BUY_HOLD_WEIGHTS.cap_rate), available: true, summary: `Cap rate ${fpct(cap)}` });

  // cash-on-cash
  const coc = ev.metrics.cashOnCash;
  const cocCeil = Math.max(0.10, (ev.config.targetCoc ?? 0.08) * 1.6);
  if (coc === null) cats.push({ label: 'Cash-on-Cash', weight: BUY_HOLD_WEIGHTS.cash_on_cash, points: 0, available: false, summary: 'Cash-on-cash unavailable' });
  else cats.push({ label: 'Cash-on-Cash', weight: BUY_HOLD_WEIGHTS.cash_on_cash, points: Math.round(clamp(coc / cocCeil, 0, 1) * BUY_HOLD_WEIGHTS.cash_on_cash), available: true, summary: `Cash-on-cash ${fpct(coc)}` });

  // monthly cashflow
  const cf = ev.metrics.annualCashflow;
  if (cf === null) cats.push({ label: 'Cashflow', weight: BUY_HOLD_WEIGHTS.cashflow, points: 0, available: false, summary: 'Cashflow unknown' });
  else {
    const m = cf / 12;
    if (m >= 200) cats.push({ label: 'Cashflow', weight: BUY_HOLD_WEIGHTS.cashflow, points: BUY_HOLD_WEIGHTS.cashflow, available: true, summary: `Strong cashflow (${fmoney(m)}/mo)` });
    else if (m > 0) cats.push({ label: 'Cashflow', weight: BUY_HOLD_WEIGHTS.cashflow, points: 10, available: true, summary: `Thin positive cashflow (${fmoney(m)}/mo)` });
    else if (m === 0) cats.push({ label: 'Cashflow', weight: BUY_HOLD_WEIGHTS.cashflow, points: 4, available: true, summary: 'Breakeven cashflow' });
    else cats.push({ label: 'Cashflow', weight: BUY_HOLD_WEIGHTS.cashflow, points: 0, available: true, summary: `Negative cashflow (${fmoney(m)}/mo)` });
  }

  // HOA reasonableness
  const hoa = inputs.hoaMonthly;
  if (hoa === null || hoa === undefined || hoa === 0) cats.push({ label: 'HOA', weight: BUY_HOLD_WEIGHTS.hoa, points: BUY_HOLD_WEIGHTS.hoa, available: true, summary: 'No HOA dues' });
  else if (!inputs.monthlyRent || inputs.monthlyRent <= 0) cats.push({ label: 'HOA', weight: BUY_HOLD_WEIGHTS.hoa, points: 0, available: false, summary: 'HOA impact unknown' });
  else {
    const r = hoa / inputs.monthlyRent;
    if (r < 0.1) cats.push({ label: 'HOA', weight: BUY_HOLD_WEIGHTS.hoa, points: BUY_HOLD_WEIGHTS.hoa, available: true, summary: `Reasonable HOA (${fpct(r)} of rent)` });
    else if (r <= 0.2) cats.push({ label: 'HOA', weight: BUY_HOLD_WEIGHTS.hoa, points: 2, available: true, summary: `Elevated HOA (${fpct(r)} of rent)` });
    else cats.push({ label: 'HOA', weight: BUY_HOLD_WEIGHTS.hoa, points: 0, available: true, summary: `High HOA drag (${fpct(r)} of rent)` });
  }

  // age
  const yb = inputs.yearBuilt;
  if (!yb || yb <= 0) cats.push({ label: 'Age', weight: BUY_HOLD_WEIGHTS.age, points: 0, available: false, summary: 'Year built unknown' });
  else {
    const age = new Date().getFullYear() - yb;
    if (age <= 30) cats.push({ label: 'Age', weight: BUY_HOLD_WEIGHTS.age, points: BUY_HOLD_WEIGHTS.age, available: true, summary: `Newer construction (built ${yb})` });
    else if (age <= 60) cats.push({ label: 'Age', weight: BUY_HOLD_WEIGHTS.age, points: 3, available: true, summary: `Mid-age home (built ${yb})` });
    else cats.push({ label: 'Age', weight: BUY_HOLD_WEIGHTS.age, points: 1, available: true, summary: `Older home (built ${yb})` });
  }

  // sqft
  const sqft = inputs.sqft;
  if (!sqft || sqft <= 0) cats.push({ label: 'Size', weight: BUY_HOLD_WEIGHTS.sqft, points: 0, available: false, summary: 'Square footage unknown' });
  else if (sqft >= 800) cats.push({ label: 'Size', weight: BUY_HOLD_WEIGHTS.sqft, points: BUY_HOLD_WEIGHTS.sqft, available: true, summary: `Healthy size (${sqft.toLocaleString()} sqft)` });
  else cats.push({ label: 'Size', weight: BUY_HOLD_WEIGHTS.sqft, points: 2, available: true, summary: `Small footprint (${sqft.toLocaleString()} sqft)` });

  // days on market
  const dom = inputs.daysOnMarket;
  if (dom === null || dom === undefined || dom < 0) cats.push({ label: 'Days on Market', weight: BUY_HOLD_WEIGHTS.dom, points: 0, available: false, summary: 'Days on market unknown' });
  else if (dom < 14) cats.push({ label: 'Days on Market', weight: BUY_HOLD_WEIGHTS.dom, points: BUY_HOLD_WEIGHTS.dom, available: true, summary: `Fresh listing (${dom} days)` });
  else if (dom <= 60) cats.push({ label: 'Days on Market', weight: BUY_HOLD_WEIGHTS.dom, points: 3, available: true, summary: `Standard market time (${dom} days)` });
  else cats.push({ label: 'Days on Market', weight: BUY_HOLD_WEIGHTS.dom, points: 0, available: true, summary: `Stale listing (${dom} days)` });

  return cats;
}
