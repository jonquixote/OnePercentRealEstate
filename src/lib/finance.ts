/**
 * Financial Engine for Real Estate Investment Analytics
 * Implements the "Bulletproof Enhanced 1% Rule" algorithms.
 */

export interface PropertyFinancials {
  price: number;
  rent: number;
  sqft: number;
  taxRate: number; // Annual percentage (e.g., 0.025 for 2.5%)
  insuranceRate: number; // Annual percentage (e.g., 0.007 for 0.7%)
  interestRate: number; // Annual percentage (e.g., 0.07 for 7%)
  loanTermYears: number;
  ltv: number; // Loan to Value (e.g., 0.80)
  vacancyRate: number; // e.g., 0.05
  managementRate: number; // e.g., 0.10
  conditionCostPerSqft: number; // e.g., 1.50 for older, 0.50 for newer
}

export interface DealAnalysis {
  actualRatio: number;
  requiredRatio: number;
  isPassing: boolean;
  dealScore: number;
  monthlyCashFlow: number;
  monthlyNOI: number;
  monthlyDebtService: number;
  monthlyFixedCosts: number;
}

/**
 * Calculates the Mortgage Constant (Annual Debt Service per dollar borrowed).
 * K = (i * (1 + i)^n) / ((1 + i)^n - 1)
 */
export function calculateMortgageConstant(annualInterestRate: number, loanTermYears: number): number {
  const i = annualInterestRate / 12; // Monthly interest rate
  const n = loanTermYears * 12; // Total number of months
  
  if (i === 0) return 1 / n;
  
  const factor = Math.pow(1 + i, n);
  const monthlyConstant = (i * factor) / (factor - 1);
  
  return monthlyConstant * 12; // Annualize it
}

/**
 * Calculates the Fixed Cost Floor (Taxes, Insurance, CapEx/Maintenance).
 * These are costs that do not fluctuate with rent.
 */
export function calculateFixedCostFloor(
  price: number,
  sqft: number,
  taxRate: number,
  insuranceRate: number,
  conditionCostPerSqft: number
): number {
  const annualTaxes = price * taxRate;
  const annualInsurance = price * insuranceRate;
  const annualCapEx = sqft * conditionCostPerSqft;
  
  return annualTaxes + annualInsurance + annualCapEx;
}

/**
 * Calculates the Minimum Viable Annual Rent (R_min) to achieve a target DSCR.
 * R_min = (D * DSCR + E_fixed) / (1 - E_var_rate)
 */
export function calculateRequiredRent(
  financials: PropertyFinancials,
  targetDSCR: number = 1.25
): number {
  const loanAmount = financials.price * financials.ltv;
  const mortgageConstant = calculateMortgageConstant(financials.interestRate, financials.loanTermYears);
  const annualDebtService = loanAmount * mortgageConstant;
  
  const fixedCosts = calculateFixedCostFloor(
    financials.price,
    financials.sqft,
    financials.taxRate,
    financials.insuranceRate,
    financials.conditionCostPerSqft
  );
  
  const variableExpenseRate = financials.vacancyRate + financials.managementRate;
  
  // Formula: (DebtService * DSCR + FixedCosts) / (1 - VariableExpenseRate)
  const requiredAnnualRent = (annualDebtService * targetDSCR + fixedCosts) / (1 - variableExpenseRate);
  
  return requiredAnnualRent / 12; // Monthly
}

/**
 * Calculates the Deal Score (0-100).
 * 100: Actual Rent >= Required Rent * 1.2
 * 50: Actual Rent == Required Rent
 * 0: Actual Rent <= Required Rent * 0.8
 */
export function calculateDealScore(actualRent: number, requiredRent: number): number {
  const ratio = actualRent / requiredRent;
  
  if (ratio >= 1.2) return 100;
  if (ratio <= 0.8) return 0;
  
  // Linear interpolation between 0.8 (0) and 1.2 (100)
  // Slope = 100 / (1.2 - 0.8) = 100 / 0.4 = 250
  // Score = 250 * (ratio - 0.8)
  return Math.round(250 * (ratio - 0.8));
}

/**
 * Performs a full analysis of the deal.
 */
export function analyzeDeal(financials: PropertyFinancials): DealAnalysis {
  const requiredMonthlyRent = calculateRequiredRent(financials);
  const actualRatio = (financials.rent / financials.price) * 100;
  const requiredRatio = (requiredMonthlyRent / financials.price) * 100;
  
  const loanAmount = financials.price * financials.ltv;
  const mortgageConstant = calculateMortgageConstant(financials.interestRate, financials.loanTermYears);
  const annualDebtService = loanAmount * mortgageConstant;
  
  const fixedCosts = calculateFixedCostFloor(
    financials.price,
    financials.sqft,
    financials.taxRate,
    financials.insuranceRate,
    financials.conditionCostPerSqft
  );
  
  const variableCosts = financials.rent * 12 * (financials.vacancyRate + financials.managementRate);
  const annualNOI = (financials.rent * 12) - fixedCosts - variableCosts;
  const annualCashFlow = annualNOI - annualDebtService;
  
  return {
    actualRatio: Number(actualRatio.toFixed(3)),
    requiredRatio: Number(requiredRatio.toFixed(3)),
    isPassing: financials.rent >= requiredMonthlyRent,
    dealScore: calculateDealScore(financials.rent, requiredMonthlyRent),
    monthlyCashFlow: Number((annualCashFlow / 12).toFixed(2)),
    monthlyNOI: Number((annualNOI / 12).toFixed(2)),
    monthlyDebtService: Number((annualDebtService / 12).toFixed(2)),
    monthlyFixedCosts: Number((fixedCosts / 12).toFixed(2))
  };
}
