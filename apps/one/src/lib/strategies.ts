/** Display metadata for the four investing strategies (the whole-page "lens"). */
export type Strategy = 'buy_hold' | 'brrrr' | 'flip' | 'str';

export interface StrategyMeta {
  id: Strategy;
  label: string;
  short: string;
  /** what "the line" means for this lens */
  lineName: string;
  /** one-line thesis used in hero / pulse copy */
  thesis: string;
  /** assumption-light strategies we can't fully underwrite yet */
  provisional?: boolean;
}

export const STRATEGIES: StrategyMeta[] = [
  {
    id: 'buy_hold',
    label: 'Buy & Hold',
    short: 'Hold',
    lineName: 'rent-to-price rule',
    thesis: 'Every listing scored on the 1%/2% rule, cap rate, and cashflow — buy what clears.',
  },
  {
    id: 'brrrr',
    label: 'BRRRR',
    short: 'BRRRR',
    lineName: 'recycle line',
    thesis: 'Buy, rehab, rent, refinance — the deals that recycle your capital and still cashflow.',
  },
  {
    id: 'flip',
    label: 'Fix & Flip',
    short: 'Flip',
    lineName: '70% rule',
    thesis: 'The 70% rule on distressed inventory — surfaced first. Add ARV to fully underwrite.',
    provisional: true,
  },
  {
    id: 'str',
    label: 'Short-Term Rental',
    short: 'STR',
    lineName: 'STR cap rate',
    thesis: 'Short-term-rental yield — a provisional lens until a revenue signal lands.',
    provisional: true,
  },
];

export const STRATEGY_BY_ID: Record<Strategy, StrategyMeta> = Object.fromEntries(
  STRATEGIES.map((s) => [s.id, s])
) as Record<Strategy, StrategyMeta>;

export function asStrategy(v: string | null | undefined): Strategy {
  return v && (['buy_hold', 'brrrr', 'flip', 'str'] as const).includes(v as Strategy)
    ? (v as Strategy)
    : 'buy_hold';
}
