export type Tier = 'free' | 'pro';
export type Gate = 'compare' | 'alerts' | 'layouts';

// Single source of truth for cap numbers.
export const COMPARE_FREE_MAX = 2;
export const COMPARE_PRO_MAX = 4;
export const LAYOUT_FREE_MAX = 5;   // mirror apps/two layouts route FREE_CAP
export const LAYOUT_PRO_MAX = 20;   // mirror apps/two layouts route PRO_CAP

export interface Entitlement {
  tier: Tier;
  compareMax: number;
  layoutsMax: number;
  alerts: 'daily' | 'instant';
}

export const ENTITLEMENTS: Record<Tier, Entitlement> = {
  free: { tier: 'free', compareMax: COMPARE_FREE_MAX, layoutsMax: LAYOUT_FREE_MAX, alerts: 'daily' },
  pro:  { tier: 'pro',  compareMax: COMPARE_PRO_MAX,  layoutsMax: LAYOUT_PRO_MAX,  alerts: 'instant' },
};

export function entitlementsFor(tier: Tier | undefined | null): Entitlement {
  return ENTITLEMENTS[tier === 'pro' ? 'pro' : 'free'];
}
