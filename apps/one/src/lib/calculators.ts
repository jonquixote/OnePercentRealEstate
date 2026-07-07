import type { RuleConfig } from '@oper/primitives';

/** Strip undefined/null so a partial config never clobbers a default. */
function definedOnly<T extends object>(o: T): Partial<T> {
    const out: Partial<T> = {};
    for (const k in o) {
        const v = o[k];
        if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
}

export interface LoanOptions {
    downPaymentPercent: number;
    interestRate: number;
    loanTermYears: number;
    pmiRate?: number; // Annual rate (e.g., 0.005 for 0.5%)
}

export interface ExpenseOptions {
    propertyTaxRate: number; // Annual rate (e.g., 0.012 for 1.2%)
    insuranceAnnual: number;
    maintenanceRate: number; // % of gross rent
    vacancyRate: number; // % of gross rent
    managementRate: number; // % of gross rent
    capExRate: number; // % of gross rent
    hoaMonthly: number;
    utilitiesMonthly: number;
    otherMonthly: number;
    taxAnnual?: number; // Override: actual annual tax instead of price * propertyTaxRate
}

export interface CashflowResult {
    monthlyMortgage: number;
    monthlyPMI: number;
    monthlyPropertyTax: number;
    monthlyInsurance: number;
    monthlyExpenses: number; // Ops + Tax + Ins + PMI
    totalMonthlyExpense: number; // Mortgage + Ops + etc.
    monthlyCashflow: number;
    noi: number;
    capRate: number;
    cashOnCash: number;
    isOnePercentRule: boolean;
}

export const DEFAULT_LOAN_OPTIONS: LoanOptions = {
    downPaymentPercent: 0.20,
    interestRate: 0.065, // 6.5%
    loanTermYears: 30,
    pmiRate: 0.005, // 0.5%
};

export const DEFAULT_EXPENSE_OPTIONS: ExpenseOptions = {
    propertyTaxRate: 0.012, // 1.2% national avg
    insuranceAnnual: 1200, // $100/mo default
    maintenanceRate: 0.05,
    vacancyRate: 0.05,
    managementRate: 0.08,
    capExRate: 0.05,
    hoaMonthly: 0,
    utilitiesMonthly: 0,
    otherMonthly: 0,
};

/**
 * Calculates monthly mortgage payment (PI)
 */
export function calculateMortgage(principal: number, annualRate: number, years: number): number {
    if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / (years * 12);

    const monthlyRate = annualRate / 12;
    const numPayments = years * 12;

    return principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
}

/**
 * Calculates comprehensive rental property metrics
 */
export function calculatePropertyMetrics(
    price: number,
    rent: number,
    loanOptions: Partial<LoanOptions> = {},
    expenseOptions: Partial<ExpenseOptions> = {},
    cfg?: Partial<RuleConfig>
): CashflowResult {
    // Precedence: explicit options > resolved rule config > module defaults.
    // The rule config (underwriting_rules) is the single source of truth for
    // financing assumptions and the 1%-rule threshold.
    const cfgLoan = cfg
        ? definedOnly<Partial<LoanOptions>>({
              downPaymentPercent: cfg.downPaymentPct,
              interestRate: cfg.interestRate,
              loanTermYears: cfg.loanTermYears,
          })
        : {};
    const cfgExpense = cfg
        ? definedOnly<Partial<ExpenseOptions>>({
              propertyTaxRate: cfg.propertyTaxRate,
              insuranceAnnual: cfg.insuranceAnnual,
          })
        : {};
    const loan = { ...DEFAULT_LOAN_OPTIONS, ...cfgLoan, ...loanOptions };
    const expenses = { ...DEFAULT_EXPENSE_OPTIONS, ...cfgExpense, ...expenseOptions };
    const closingCostPct = cfg?.closingCostPct ?? 0.03;
    const targetRatio = cfg?.targetRatio ?? 0.01;

    // 1. Loan Calculations
    const downPayment = price * loan.downPaymentPercent;
    const loanAmount = price - downPayment;
    const monthlyMortgage = calculateMortgage(loanAmount, loan.interestRate, loan.loanTermYears);

    // 2. PMI (if < 20% down)
    let monthlyPMI = 0;
    if (loan.downPaymentPercent < 0.20 && loan.pmiRate) {
        monthlyPMI = (loanAmount * loan.pmiRate) / 12;
    }

    // 3. Fixed Monthly Expenses
    const monthlyPropertyTax = expenses.taxAnnual != null && expenses.taxAnnual > 0
        ? expenses.taxAnnual / 12
        : (price * expenses.propertyTaxRate) / 12;
    const monthlyInsurance = expenses.insuranceAnnual / 12;

    // 4. Variable Monthly Expenses (% of rent)
    const monthlyMaintenance = rent * expenses.maintenanceRate;
    const monthlyVacancy = rent * expenses.vacancyRate;
    const monthlyManagement = rent * expenses.managementRate;
    const monthlyCapEx = rent * expenses.capExRate;

    // 5. Total Expenses
    const monthlyOperatingExpenses =
        monthlyPropertyTax +
        monthlyInsurance +
        monthlyMaintenance +
        monthlyVacancy +
        monthlyManagement +
        monthlyCapEx +
        expenses.hoaMonthly +
        expenses.utilitiesMonthly +
        expenses.otherMonthly;

    const totalMonthlyExpense = monthlyMortgage + monthlyOperatingExpenses + monthlyPMI;

    // 6. Metrics
    const monthlyCashflow = rent - totalMonthlyExpense;
    const annualCashflow = monthlyCashflow * 12;
    const noi = (rent * 12) - (monthlyOperatingExpenses * 12);
    // Fractions (0.08 = 8%) — consistent with @oper/primitives underwriting + grading.
    const capRate = price > 0 ? (noi / price) : 0;

    // Cash on Cash Return = Annual Cashflow / Initial Investment (down payment + closing costs)
    const closingCosts = price * closingCostPct;
  const totalCashInvested = downPayment + closingCosts;
  const cashOnCash = totalCashInvested > 0 ? (annualCashflow / totalCashInvested) : 0;

    // 1% rule — threshold from the resolved rule config (per property type / sale type).
    const isOnePercentRule = price > 0 && (rent / price) >= targetRatio;

    return {
        monthlyMortgage,
        monthlyPMI,
        monthlyPropertyTax,
        monthlyInsurance,
        monthlyExpenses: monthlyOperatingExpenses + monthlyPMI,
        totalMonthlyExpense,
        monthlyCashflow,
        noi,
        capRate,
        cashOnCash,
        isOnePercentRule,
    };
}
