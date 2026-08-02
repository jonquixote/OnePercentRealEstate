import type { RuleConfig, SaleType, Strategy, ResolutionTier } from '@oper/primitives';

/**
 * Map a SQL rule row onto `RuleConfig`.
 *
 * The database speaks snake_case (`down_payment_pct`) and `RuleConfig` speaks
 * camelCase (`downPaymentPct`), so spreading a row straight into the config
 * silently produces an object where every threshold is `undefined` — and
 * because `evaluateRules` treats a missing threshold as "not enough data to
 * evaluate", the result is not a crash but a property that quietly grades on
 * nothing. That failure is invisible in review and invisible at runtime, which
 * is exactly why this mapping is written out field by field in one place
 * instead of being cast away.
 *
 * Accepts rows from either `resolve_rule()` or `underwriting_rules`; the
 * former adds `rule_id` / `resolved_tier`, which are simply absent on the latter.
 *
 * Defaults match /api/underwriting-rules, which has served them since the rules
 * engine shipped. They apply only to financing assumptions that must exist for
 * the math to run at all — never to a *threshold*, because a missing threshold
 * has to stay missing so the rule reports itself unavailable.
 */

/** pg returns NUMERIC as a string to preserve precision — Number() it, keep null null. */
const num = (v: unknown): number | null => (v != null ? Number(v) : null);

export interface RuleRow {
  [key: string]: unknown;
}

export function ruleConfigFromRow(r: RuleRow, strategy: Strategy): RuleConfig {
  return {
    ruleId: r.rule_id != null ? Number(r.rule_id) : undefined,
    resolvedTier: (r.resolved_tier as ResolutionTier) ?? undefined,
    matchedPropertyType: (r.matched_property_type as string) ?? (r.property_type as string) ?? undefined,
    matchedSaleType: ((r.matched_sale_type as SaleType) ?? (r.sale_type as SaleType)) ?? undefined,
    strategy,

    // Thresholds: never defaulted. A null threshold must stay null so the rule
    // reports `available: false` rather than being judged against a number we
    // invented.
    targetRatio: num(r.target_ratio),
    minGrossYield: num(r.min_gross_yield),
    targetGrm: num(r.target_grm),
    targetCapRate: num(r.target_cap_rate),
    targetCoc: num(r.target_coc),
    minDscr: num(r.min_dscr),
    minDebtYield: num(r.min_debt_yield),
    maxPriceToRent: num(r.max_price_to_rent),
    fiftyPctOpexRatio: num(r.fifty_pct_opex_ratio),
    arvDiscount: num(r.arv_discount),
    rehabPerSqft: num(r.rehab_per_sqft),
    minFlipRoi: num(r.min_flip_roi),
    refiLtv: num(r.refi_ltv),
    strAdr: num(r.str_adr),
    strOccupancy: num(r.str_occupancy),
    strTargetCapRate: num(r.str_target_cap_rate),

    // Financing assumptions: required by the math, so they carry defaults.
    downPaymentPct: num(r.down_payment_pct) ?? 0.2,
    interestRate: num(r.interest_rate) ?? 0.065,
    loanTermYears: r.loan_term_years != null ? Number(r.loan_term_years) : 30,
    closingCostPct: num(r.closing_cost_pct) ?? 0.03,
    propertyTaxRate: num(r.property_tax_rate) ?? 0.012,
    insuranceAnnual: num(r.insurance_annual) ?? 1200,

    isProvisional: !!r.is_provisional,
    ruleVersion: (r.rule_version as string) ?? null,
    ruleSetVersion: r.rule_set_version != null ? Number(r.rule_set_version) : null,
  };
}
