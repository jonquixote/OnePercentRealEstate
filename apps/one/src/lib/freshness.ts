/**
 * How recently did the crawler actually confirm this listing exists?
 *
 * Measured on prod 2026-07-26: of 446,270 listings the product calls "active",
 * only 29% had been confirmed in the last three days and 101,864 (22.8%) had
 * not been seen in over a week. The crawler's own rechecks corroborate it —
 * 63 of 160 zip_recheck jobs a day find NOTHING in ZIPs where our database says
 * listings are active. The source is telling us those listings are gone.
 *
 * "Active" therefore means "not yet reaped", not "verified". This makes the
 * difference visible instead of letting the badge imply a freshness the data
 * does not have — the same correction applied to rent_calc_status ('done' now
 * implies an estimate) and to listing photos (a column that claimed nothing was
 * there when the image was sitting in the jsonb beside it).
 *
 * Thresholds match the measured buckets, so each level describes a real
 * population rather than an invented one.
 */

export type FreshnessLevel = 'verified' | 'recent' | 'aging' | 'unconfirmed';

export interface Freshness {
  level: FreshnessLevel;
  /** Whole days since last confirmation; 0 for today, Infinity when unknown. */
  days: number;
  /** Short human label — readable without a legend. */
  label: string;
}

const DAY_MS = 86_400_000;

const UNKNOWN: Freshness = {
  level: 'unconfirmed',
  days: Infinity,
  label: 'Unconfirmed — last check unknown',
};

export function freshnessOf(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
): Freshness {
  if (lastSeenAt == null) return UNKNOWN;

  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  const t = seen.getTime();
  if (!Number.isFinite(t)) return UNKNOWN;

  // A future timestamp means clock skew, not staleness. Treat it as just-seen
  // rather than reporting a negative age.
  const elapsed = Math.max(0, now.getTime() - t);
  const days = Math.floor(elapsed / DAY_MS);

  if (days < 1) return { level: 'verified', days, label: 'Confirmed in the last few hours' };
  if (days < 3) return { level: 'recent', days, label: `Confirmed ${days} day${days === 1 ? '' : 's'} ago` };
  if (days < 7) return { level: 'aging', days, label: `Last confirmed ${days} days ago` };
  return { level: 'unconfirmed', days, label: `Unconfirmed for ${days} days — may no longer be available` };
}
