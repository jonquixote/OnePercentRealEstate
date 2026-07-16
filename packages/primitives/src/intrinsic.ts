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
