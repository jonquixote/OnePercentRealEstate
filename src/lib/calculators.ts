
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
    if (principal <= 0 || annualRate <= 0 || years <= 0) return 0;

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
    expenseOptions: Partial<ExpenseOptions> = {}
): CashflowResult {
    const loan = { ...DEFAULT_LOAN_OPTIONS, ...loanOptions };
    const expenses = { ...DEFAULT_EXPENSE_OPTIONS, ...expenseOptions };

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
    const monthlyPropertyTax = (price * expenses.propertyTaxRate) / 12;
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
    const capRate = price > 0 ? (noi / price) * 100 : 0;

    // Cash on Cash Return = Annual Cashflow / Initial Investment (Down Payment + Closing Costs usually, simplifying to Down Payment)
    // TODO: Add closing costs to initial investment calculation for more accuracy
    const cashOnCash = downPayment > 0 ? (annualCashflow / downPayment) * 100 : 0;

    // 1% Rule
    // Monthly Rent >= 1% of Purchase Price
    const isOnePercentRule = price > 0 && (rent / price) >= 0.01;

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
