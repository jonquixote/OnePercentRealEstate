import Link from 'next/link';
import { STRATEGIES, type Strategy } from '@/lib/strategies';

/**
 * The buyer-lens switch.
 *
 * Each lens is a real URL rather than client state, so it is shareable and
 * crawlable, and — the point of this feature — the server re-underwrites the
 * property for the chosen buyer instead of merely re-filtering a list. Labels
 * come from the shared STRATEGIES metadata so this control and the rest of the
 * page cannot disagree about what a lens is called.
 */
export function LensPicker({ active }: { active: Strategy }) {
  return (
    <nav aria-label="Buyer lens" className="mt-4 flex flex-wrap gap-1.5">
      {STRATEGIES.map((s) => {
        const isActive = s.id === active;
        return (
          <Link
            key={s.id}
            href={s.id === 'buy_hold' ? '/' : `/?strat=${s.id}`}
            scroll={false}
            aria-current={isActive ? 'page' : undefined}
            className="rounded-[6px] px-2.5 py-1 text-[12px] font-medium"
            style={
              isActive
                ? { background: 'var(--brass)', color: 'var(--ink)' }
                : { background: 'var(--ink-2)', color: 'var(--haze)' }
            }
          >
            {s.short}
          </Link>
        );
      })}
    </nav>
  );
}
