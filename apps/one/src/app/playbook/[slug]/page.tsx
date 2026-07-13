import { notFound } from 'next/navigation';
import Link from 'next/link';
import Breadcrumbs from '@/components/Breadcrumbs';
import { ArrowLeft, TrendingUp, DollarSign, Home, Shield, Sparkles } from 'lucide-react';

const STRATEGIES: Record<string, {
  title: string;
  subtitle: string;
  icon: typeof TrendingUp;
  color: string;
  description: string;
  principles: string[];
  metrics: { label: string; target: string; description: string }[];
  sections: { heading: string; body: string }[];
}> = {
  'buy-hold': {
    title: 'Buy & Hold',
    subtitle: 'The 1% Rule — cashflow through long-term rental income',
    icon: TrendingUp,
    color: 'var(--pass)',
    description: 'The foundational strategy: acquire a property that rents for at least 1% of its purchase price per month, hold for 5+ years, and collect cashflow while the mortgage amortizes and the market appreciates.',
    principles: [
      'Monthly rent ≥ 1% of purchase price',
      '50% of gross rent covers all operating expenses',
      'Debt service coverage ratio (DSCR) ≥ 1.25x',
      'Cash-on-cash return ≥ 8%',
      'Minimum 20% down to avoid PMI',
    ],
    metrics: [
      { label: 'Rent-to-Price', target: '≥ 1.0%', description: 'Gross monthly rent divided by purchase price' },
      { label: 'Cap Rate', target: '≥ 6%', description: 'Net operating income ÷ property value' },
      { label: 'Cash-on-Cash', target: '≥ 8%', description: 'Annual pre-tax cashflow ÷ total cash invested' },
      { label: 'DSCR', target: '≥ 1.25', description: 'NOI ÷ annual debt service' },
    ],
    sections: [
      { heading: 'Find the deal', body: 'Look in B- and C-class neighborhoods with strong employment anchors. Zip codes near hospitals, distribution centers, and manufacturing corridors often clear the 1% rule. Filter our search to only show 1% Rule-qualified listings.' },
      { heading: 'Run the numbers', body: 'Use the property detail page to see the verdict rail — cap rate, cash-on-cash, and cashflow are calculated live using current financing assumptions. Toggle down payment and interest rate in the calculator tab to stress-test.' },
      { heading: 'Inspect & close', body: 'Always order a general inspection, sewer scope, and termite report before closing. Factor major repairs into your initial rehab budget. We assume a 5% capex reserve in the verdict.' },
      { heading: 'Manage & scale', body: 'Self-manage the first unit to learn the business. Once you have 3-4 units, hire a professional property manager (8-10% of gross rent). Use the saved cashflow to fund your next down payment.' },
    ],
  },
  brrrr: {
    title: 'BRRRR',
    subtitle: 'Buy, Rehab, Rent, Refinance, Repeat — recycle your capital',
    icon: Sparkles,
    color: 'var(--brass-hi)',
    description: 'The BRRRR method lets you recycle the same down payment across multiple deals. Buy a distressed property below market, force equity through rehab, rent it, then cash-out refinance to pull your capital back out.',
    principles: [
      'Purchase price + rehab ≤ 70% of ARV',
      'After-repair value based on recent sold comps',
      'Rehab budget at $40/sqft for moderate work',
      'Refinance LTV at 75% of ARV',
      'Target ROI ≥ 15% on the recycled capital',
    ],
    metrics: [
      { label: 'ARV Discount', target: '≥ 30%', description: 'Purchase must be at least 30% below ARV' },
      { label: 'Rehab Budget', target: '≤ $40/sqft', description: 'Typical moderate renovation cost per sqft' },
      { label: 'Refi LTV', target: '≤ 75%', description: 'Cash-out refinance loan-to-value ratio' },
      { label: 'ROI on Recycled', target: '≥ 15%', description: 'Return on the capital pulled out at refi' },
    ],
    sections: [
      { heading: 'Source distressed inventory', body: 'Target properties that have been on market 90+ days, are bank-owned, or show price cuts. Use our Stalest sort on the search page to find stale inventory.' },
      { heading: 'Estimate ARV accurately', body: 'Pull 3-5 comparable sold listings within 0.5 miles, same beds/baths, closed in the last 6 months. Our sold comps section on the detail page does this for you.' },
      { heading: 'Finance the acquisition', body: 'Use a hard money lender or a conventional loan with rehab escrow. Plan for 6-9 months from purchase to refinance. The calculator tab handles BRRRR scenarios.' },
      { heading: 'Rehab, rent, and rinse', body: 'Focus on kitchens, bathrooms, flooring, and paint. Once rented for 6+ months, refinance into a conventional 30-year fixed. Pull your capital out for the next deal.' },
    ],
  },
  flip: {
    title: 'Buy & Flip',
    subtitle: 'Forced appreciation through renovation — in and out in under 6 months',
    icon: DollarSign,
    color: 'var(--loss)',
    description: 'Target high-turnover properties in hot submarkets. Buy at a discount, renovate quickly, and sell before carrying costs eat your margin. Speed and accurate ARV estimation are everything.',
    principles: [
      'Purchase ≤ 70% of ARV minus rehab',
      'Rehab timeline under 90 days',
      'Holding costs ≤ 3% of ARV',
      'Minimum ROI ≥ 20% on total capital',
      'Exit strategy confirmed before purchase',
    ],
    metrics: [
      { label: 'Max Purchase Price', target: '70% of ARV \u2212 rehab', description: 'Strict MAO formula for every deal' },
      { label: 'Holding Period', target: '≤ 180 days', description: 'Days from purchase to sale' },
      { label: 'Gross Margin', target: '≥ 20%', description: 'Sale price minus all-in cost ÷ all-in cost' },
      { label: 'Rehab Velocity', target: '≤ 90 days', description: 'Days from start to certificate of occupancy' },
    ],
    sections: [
      { heading: 'Find the deal', body: 'Look for outdated but structurally sound properties in appreciating neighborhoods. Avoid foundation issues, knob-and-tube wiring, and cast-iron drain stacks unless you have the margin to absorb them.' },
      { heading: 'Use the comps tool', body: 'The comps page lets you analyze recent sold listings and active inventory side by side. Cross-reference ARV against at least three closed comps before making an offer.' },
      { heading: 'Manage the reno', body: 'Build a 30-day, 60-day, 90-day milestone calendar. Kitchen and bath are the highest-ROI rooms. Keep finishes neutral and trade-friendly.' },
      { heading: 'Time the market', body: 'List on Thursday, price 5% above ARV, and plan for a 30-day close. If no offers in 2 weeks, drop price weekly until you get traction. Carrying costs compound fast.' },
    ],
  },
  str: {
    title: 'Short-Term Rental',
    subtitle: 'Maximize yield through nightly occupancy in tourist and business markets',
    icon: Shield,
    color: 'var(--pass)',
    description: 'Short-term rentals can generate 2-3x the gross rent of a long-term lease, but require active management, higher operating costs, and navigating local regulations.',
    principles: [
      'ADR (Average Daily Rate) based on comparable STR comps',
      'Occupancy rate ≥ 65% for feasibility',
      'Gross yield target ≥ 12%',
      'Professional cleaning + turnover baked into expenses',
      'Local STR regulations and licensing confirmed',
    ],
    metrics: [
      { label: 'ADR', target: 'Market comps', description: 'Average daily rate from comparable listings' },
      { label: 'Occupancy', target: '≥ 65%', description: 'Booked nights ÷ total available' },
      { label: 'Gross Yield', target: '≥ 12%', description: 'Annual projected gross rent ÷ purchase price' },
      { label: 'Effective Cap Rate', target: '≥ 10%', description: 'NOI (after 50% opex) ÷ property value' },
    ],
    sections: [
      { heading: 'Check regulations first', body: 'Confirm the municipality allows STRs. Some cities require a license, limit the number of nights per year, or prohibit non-owner-occupied STRs entirely.' },
      { heading: 'Analyze the comps', body: 'Use AirDNA or scrape local Airbnb/Vrbo listings to estimate ADR and occupancy. Factor in seasonal variation — summer peak may not carry the whole year.' },
      { heading: 'Budget for operations', body: 'Expect 35-50% opex ratio for STRs (higher than LTR due to cleaning, turnover, supplies, and platform fees). The calculator tab has an STR mode with appropriate defaults.' },
      { heading: 'Optimize for revenue', body: 'Professional photography, competitive pricing, and instant-book are table stakes. Use dynamic pricing tools and review management to maintain Superhost status and lift occupancy.' },
    ],
  },
  model: {
    title: 'How the Model Works',
    subtitle: 'Rent estimates triangulated from government, scraped, and learned sources',
    icon: Sparkles,
    color: 'var(--pass)',
    description: 'Every listing shows an estimated rent we do not take from a single source. We triangulate three independent signals — a government fair-market benchmark, scraped comparable listings, and a machine-learned model — then weight them so no single noisy input swings the number.',
    principles: [
      'HUD Small Area Fair Market Rent (SAFMR) as the regulatory floor',
      'Scraped active + recently-rented comps within the same submarket',
      'ML model trained on closed-rental history, corrected for beds/baths/sqft',
      'Outlier comps down-weighted, not dropped',
      'Estimates refreshed continuously as new listings close',
    ],
    metrics: [
      { label: 'Government Benchmark', target: 'HUD SAFMR', description: 'Area median rent set by HUD each year' },
      { label: 'Comp Window', target: '≤ 0.5 mi', description: 'Comparable radius for scraped rent comps' },
      { label: 'Refresh', target: 'Continuous', description: 'Re-estimated as new leases close' },
      { label: '1% Rule Input', target: 'Est. Rent ÷ Price', description: 'The single figure our deal score is built on' },
    ],
    sections: [
      { heading: 'The government floor', body: 'HUD publishes Small Area Fair Market Rents annually. It is a defensible, regulation-grade baseline — but it lags the market and is coarse at the ZIP level, so we treat it as one input, not the answer.' },
      { heading: 'Scraped comparables', body: 'We pull active and recently-rented listings in the same submarket and compute a rent-per-square-foot distribution. This captures what tenants are actually paying right now, including amenities and condition.' },
      { heading: 'The learned model', body: 'A regression model blends beds, baths, square footage, age, and location into a predicted rent, trained on historical closed rentals. It generalizes where comps are thin.' },
      { heading: 'Weighted, not averaged', body: 'The displayed estimate weights each source by confidence for that property. When comps are dense we lean on them; when a ZIP is sparse we lean on the model and the HUD floor. Outliers are down-weighted so one bad listing cannot distort a deal.' },
    ],
  },
};

// Content is fully static — prerender all four at build time instead of
// rendering on demand. Unknown slugs still 404 via notFound() below.
export function generateStaticParams() {
  return Object.keys(STRATEGIES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = STRATEGIES[slug];
  if (!s) return { title: 'Strategy Not Found' };
  return {
    title: `${s.title} Investment Strategy | OnePercentRealEstate`,
    description: s.subtitle,
  };
}

export default async function StrategyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = STRATEGIES[slug];
  if (!s) notFound();

  const Icon = s.icon;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Breadcrumbs items={[
            { label: 'Home', href: '/' },
            { label: 'Playbook', href: '/playbook' },
            { label: s.title },
        ]} />

        {/* Back link */}
        <Link href="/playbook" className="mb-8 flex items-center gap-1.5 text-sm text-haze hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to the Playbook
        </Link>

        {/* Hero */}
        <header className="mb-12">
          <div className="flex items-center gap-4 mb-4">
            <div className="grid h-12 w-12 place-items-center rounded-full" style={{ background: `${s.color}15` }}>
              <Icon className="h-6 w-6" style={{ color: s.color }} />
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-widest" style={{ color: s.color }}>{s.title}</p>
              {s.subtitle && <p className="text-sm text-haze mt-0.5">{s.subtitle}</p>}
            </div>
          </div>
          <p className="text-[15px] leading-relaxed text-foreground max-w-2xl">{s.description}</p>
        </header>

        {/* Key metrics */}
        <section className="mb-12">
          <h2 className="prov mb-5 inline-block">targets</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {s.metrics.map((m) => (
              <div key={m.label} className="rounded-[var(--r-panel)] border border-line bg-card p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">{m.label}</span>
                  <span className="figure text-sm" style={{ color: s.color }}>{m.target}</span>
                </div>
                <p className="text-xs text-haze">{m.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Principles */}
        <section className="mb-12">
          <h2 className="prov mb-5 inline-block">principles</h2>
          <ul className="space-y-2">
            {s.principles.map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-foreground">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold" style={{ background: `${s.color}15`, color: s.color }}>{i + 1}</span>
                {p}
              </li>
            ))}
          </ul>
        </section>

        {/* Sections */}
        <section className="space-y-6">
          {s.sections.map((sec) => (
            <div key={sec.heading} className="rounded-[var(--r-panel)] border border-line bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-2">{sec.heading}</h3>
              <p className="text-sm text-haze leading-relaxed">{sec.body}</p>
            </div>
          ))}
        </section>

        {/* CTA */}
        <div className="mt-12 flex justify-center">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: s.color }}
          >
            <Home className="h-4 w-4" />
            Find {s.title} Deals
          </Link>
        </div>
      </div>
    </div>
  );
}
