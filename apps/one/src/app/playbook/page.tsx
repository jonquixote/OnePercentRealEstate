import Link from 'next/link';
import { TrendingUp, DollarSign, Home, Shield, Sparkles, ArrowRight } from 'lucide-react';

const STRATEGIES = [
  {
    slug: 'buy-hold',
    title: 'Buy & Hold',
    tagline: 'The 1% Rule — cashflow through long-term rental income',
    icon: TrendingUp,
    color: 'var(--pass)',
    description: 'Acquire properties that rent for ≥ 1% of purchase price per month. Collect cashflow, build equity, and scale over decades.',
  },
  {
    slug: 'brrrr',
    title: 'BRRRR',
    tagline: 'Buy, Rehab, Rent, Refinance, Repeat — recycle your capital',
    icon: Sparkles,
    color: 'var(--brass-hi)',
    description: 'Buy distressed at a discount, force equity through rehab, rent, then cash-out refi to pull your capital back for the next deal.',
  },
  {
    slug: 'flip',
    title: 'Buy & Flip',
    tagline: 'Forced appreciation through renovation — in and out in under 6 months',
    icon: DollarSign,
    color: 'var(--loss)',
    description: 'Buy below market, renovate quickly, and sell before carrying costs eat your margin. Speed and accurate ARV estimation are everything.',
  },
  {
    slug: 'str',
    title: 'Short-Term Rental',
    tagline: 'Maximize yield through nightly occupancy in tourist and business markets',
    icon: Shield,
    color: 'var(--pass)',
    description: 'Generate 2-3x the gross rent of a long-term lease with active management, higher operating costs, and local regulation navigation.',
  },
];

export const metadata = {
  title: 'The Playbook | OnePercentRealEstate',
  description: 'Master BRRRR, buy-and-hold, flipping, and short-term rental strategies with our playbooks.',
};

export default function PlaybookPage() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-12 text-center">
          <h1 className="display-1 mb-4">The Playbook</h1>
          <p className="text-[15px] text-haze max-w-lg mx-auto leading-relaxed">
            Each strategy has its own set of rules, metrics, and workflows. Pick the one that matches your capital, timeline, and risk tolerance.
          </p>
        </header>

        <div className="grid gap-6">
          {STRATEGIES.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.slug}
                href={`/strategy/${s.slug}`}
                className="group rounded-[var(--r-panel)] border border-line bg-card p-6 transition-all hover:border-pass/30 hover:shadow-[var(--shadow-pop)]"
              >
                <div className="flex items-start gap-5">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: `${s.color}15` }}>
                    <Icon className="h-6 w-6" style={{ color: s.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{s.title}</p>
                        <p className="text-xs text-haze mt-0.5">{s.tagline}</p>
                      </div>
                      <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                    <p className="mt-3 text-sm text-haze leading-relaxed">{s.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-12 rounded-[var(--r-panel)] bg-ink-2 border border-line p-6 text-center">
          <p className="text-sm text-haze mb-4">Not sure which strategy fits? Use the calculator to compare scenarios side by side.</p>
          <Link
            href="/calculator"
            className="inline-flex items-center gap-2 rounded-full border border-pass px-6 py-2.5 text-sm font-semibold text-pass transition-colors hover:bg-pass/10"
          >
            Try the Calculator
          </Link>
        </div>
      </div>
    </div>
  );
}
