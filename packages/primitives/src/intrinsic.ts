export type IntrinsicInput = {
  monthlyRent: number;   // estimated monthly rent (dollars)
  opexRatio: number;     // operating-expense fraction of gross rent (from property_type_rules)
  marketCapRate: number; // market capitalization rate (fraction), metro-derived
};

/**
 * Income-approach intrinsic value: the price at which the property's own net
 * operating income yields the market cap rate. NOI = annual gross rent net of
 * operating expenses; value = NOI / capRate. Financing-agnostic by design
 * (Buffett values the asset, not the loan).
 */
export function intrinsicValue({ monthlyRent, opexRatio, marketCapRate }: IntrinsicInput): number {
  if (!(marketCapRate > 0) || !(monthlyRent > 0)) return 0;
  const noi = monthlyRent * 12 * (1 - opexRatio);
  return noi / marketCapRate;
}

/** Cushion between value and price, as a fraction of value. Positive = discount. */
export function marginOfSafety(intrinsic: number, price: number): number {
  if (!(intrinsic > 0)) return 0;
  return (intrinsic - price) / intrinsic;
}

export type OwnerReturnInput = {
  price: number;
  downPct: number;         // fraction down (e.g. 0.2)
  monthlyRent: number;
  opexRatio: number;
  appreciationRate: number; // annual, fraction (HPI-derived)
  rentGrowthRate: number;   // annual, fraction
  mortgageRate: number;     // annual, fraction
};
export type OwnerReturnYear = { year: number; equity: number; cumCashFlow: number; propertyValue: number };
export type OwnerReturn = { years: OwnerReturnYear[]; equityMultiple: number; avgAnnualCashOnCash: number };

// Standard fixed-rate amortization over 30 years, monthly compounding.
function monthlyPayment(principal: number, annualRate: number, years = 30): number {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
function remainingBalance(principal: number, annualRate: number, monthsPaid: number, years = 30): number {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return Math.max(0, principal * (1 - monthsPaid / n));
  const pmt = monthlyPayment(principal, annualRate, years);
  const bal = principal * Math.pow(1 + r, monthsPaid) - pmt * ((Math.pow(1 + r, monthsPaid) - 1) / r);
  return Math.max(0, bal);
}

/**
 * Ten-year owner return. Value and rent compound annually; cash flow each year
 * is NOI minus debt service; equity is property value minus loan balance.
 * equityMultiple = (final equity + cumulative cash flow) / cash invested.
 */
export function ownerReturn10yr(i: OwnerReturnInput): OwnerReturn {
  const loan = i.price * (1 - i.downPct);
  const cashInvested = i.price * i.downPct;
  const annualDebtService = monthlyPayment(loan, i.mortgageRate) * 12;

  const years: OwnerReturnYear[] = [];
  let cumCashFlow = 0;
  for (let y = 1; y <= 10; y++) {
    const rent = i.monthlyRent * 12 * Math.pow(1 + i.rentGrowthRate, y - 1);
    const noi = rent * (1 - i.opexRatio);
    const cashFlow = noi - annualDebtService;
    cumCashFlow += cashFlow;
    const propertyValue = i.price * Math.pow(1 + i.appreciationRate, y);
    const balance = remainingBalance(loan, i.mortgageRate, y * 12);
    const equity = propertyValue - balance;
    years.push({ year: y, equity, cumCashFlow, propertyValue });
  }
  const finalEquity = years[9].equity;
  const equityMultiple = cashInvested > 0 ? (finalEquity + cumCashFlow) / cashInvested : 0;
  const avgAnnualCashOnCash = cashInvested > 0 ? cumCashFlow / 10 / cashInvested : 0;
  return { years, equityMultiple, avgAnnualCashOnCash };
}
