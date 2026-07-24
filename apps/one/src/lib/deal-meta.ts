export type DealLite = {
  address: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  rent: number | null;
  ratioPct: number | null;
  beds: number | null;
  baths: number | null;
};

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatRatio(ratio: number): string {
  return (Math.round(ratio * 10) / 10).toString();
}

export function buildDealTitle(lite: DealLite): string {
  if (!lite.address) return 'Rental property deal | OnePercent';
  const segments: string[] = [];
  if (lite.price != null && lite.price > 0) segments.push(usd0.format(lite.price));
  if (lite.beds != null && lite.beds > 0) segments.push(`${lite.beds}bd`);
  if (lite.rent != null && lite.rent > 0 && lite.ratioPct != null && lite.ratioPct > 0) {
    segments.push(`~${formatRatio(lite.ratioPct)}% rule`);
  }
  const body = segments.length > 0 ? ` — ${segments.join(' · ')}` : '';
  return `${lite.address}${body} | OnePercent`;
}

export function buildDealDescription(lite: DealLite): string {
  if (!lite.address) {
    return 'Rental property deal on OnePercent. See modeled rent, comps, and risk.';
  }
  const rentStr = lite.rent != null && lite.rent > 0 ? `modeled rent ${usd0.format(lite.rent)}/mo` : null;
  const ratioStr = lite.ratioPct != null && lite.ratioPct > 0 ? `~${formatRatio(lite.ratioPct)}% rule estimate` : null;
  const cityState = [lite.city, lite.state].filter(Boolean).join(', ');
  const parts: string[] = [`${lite.address} —`];
  const mid: string[] = [];
  if (rentStr) mid.push(rentStr);
  if (ratioStr) mid.push(ratioStr);
  if (mid.length > 0) parts.push(mid.join(', '));
  if (cityState) parts.push(`in ${cityState}`);
  return `${parts.join(' ')}. OnePercent deal analysis.`;
}
