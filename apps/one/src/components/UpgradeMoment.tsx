'use client';

import Link from 'next/link';

interface UpgradeMomentProps {
  gate: 'compare' | 'alerts' | 'layouts';
  className?: string;
}

// Copy is deliberately honest: every gate names the free alternative so a
// downgrade never feels like a dead end (no dark patterns).
const COPY: Record<UpgradeMomentProps['gate'], { headline: string; freeAlt: string; cta: string }> = {
  compare: {
    headline: 'Compare is a Pro feature.',
    freeAlt: 'Free accounts compare up to 2 side by side.',
    cta: 'Upgrade to compare more',
  },
  alerts: {
    headline: 'Instant alerts are Pro.',
    freeAlt: 'Daily digest stays free.',
    cta: 'Get instant alerts',
  },
  layouts: {
    headline: 'Pro Terminal holds 20 layouts.',
    freeAlt: 'Free desk keeps 5 saved screens.',
    cta: 'Unlock 20 layouts',
  },
};

export default function UpgradeMoment({ gate, className }: UpgradeMomentProps) {
  const { headline, freeAlt, cta } = COPY[gate];

  return (
    <div className={`border border-line bg-ink-2 rounded-[var(--r-panel)] p-6${className ? ` ${className}` : ''}`}>
      <p className="prov prov--real text-brass-hi mb-3 inline-block">Pro</p>
      <h3 className="text-[18px] font-semibold text-foreground">{headline}</h3>
      <p className="mt-1 text-[14px] text-haze">{freeAlt}</p>
      <Link
        href={`/pricing?from=${gate}`}
        className="mt-4 inline-block rounded-[var(--r-chip)] bg-pass px-4 py-2 font-semibold text-white hover:bg-pass-hi"
      >
        {cta}
      </Link>
    </div>
  );
}
