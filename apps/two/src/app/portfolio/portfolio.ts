import type { PropertyListItem } from "@oper/api-client";

export interface PortfolioMetrics {
  irr: number | null;
  mom: number | null;
  avgCapRate: number | null;
  totalMonthlyCashflow: number;
}

/**
 * Calculate portfolio-level metrics from a list of properties.
 *
 * - IRR: Rough estimate using 10-year assumption with 3% annual appreciation + monthly cashflow
 * - MoM: Month-over-month appreciation (using 3% annual / 12)
 * - Average Cap Rate: (sum of monthly cashflows * 12) / (sum of prices)
 * - Total Monthly Cashflow: sum of estimated_rent across all properties
 */
export function calculatePortfolioMetrics(
  properties: PropertyListItem[]
): PortfolioMetrics {
  if (properties.length === 0) {
    return {
      irr: null,
      mom: null,
      avgCapRate: null,
      totalMonthlyCashflow: 0,
    };
  }

  let totalPrice = 0;
  let totalMonthlyCashflow = 0;
  let validCount = 0;

  for (const prop of properties) {
    const price = prop.listing_price ?? 0;
    const rent = prop.estimated_rent ?? 0;

    if (price > 0) {
      totalPrice += price;
      totalMonthlyCashflow += rent;
      validCount++;
    }
  }

  if (validCount === 0 || totalPrice === 0) {
    return {
      irr: null,
      mom: null,
      avgCapRate: null,
      totalMonthlyCashflow,
    };
  }

  // Rough IRR estimation:
  // Assume 10-year hold with 3% annual appreciation + monthly cashflow.
  // Simple formula: IRR ≈ (annualized cashflow / total price) + appreciation_rate
  const annualCashflow = totalMonthlyCashflow * 12;
  const cashflowYield = (annualCashflow / totalPrice) * 100;
  const appreciationRate = 3; // 3% annual
  const irr = cashflowYield + appreciationRate;

  // Month-over-month appreciation (3% annual / 12)
  const mom = 3 / 12;

  // Average cap rate
  const avgCapRate = cashflowYield;

  return {
    irr,
    mom,
    avgCapRate,
    totalMonthlyCashflow,
  };
}
