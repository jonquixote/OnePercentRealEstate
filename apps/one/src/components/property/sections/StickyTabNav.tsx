'use client';

import { useEffect, useState } from 'react';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'financials', label: 'Financials' },
  { id: 'comps', label: 'Comps' },
  { id: 'location', label: 'Location' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'nearby', label: 'Nearby' },
];

export default function StickyTabNav() {
  const [active, setActive] = useState('overview');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.filter(e => e.isIntersecting);
        if (intersecting.length === 0) return;
        const topmost = intersecting.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
        )[0];
        setActive(topmost.target.id);
      },
      { rootMargin: '-90px 0px -60% 0px', threshold: 0.1 }
    );

    for (const tab of TABS) {
      const el = document.getElementById(tab.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <nav className="sticky top-[105px] z-30 border-b border-line bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60">
      <div className="mx-auto flex max-w-7xl overflow-x-auto px-6 lg:px-8">
        <div className="flex gap-6">
          {TABS.map((tab) => (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(tab.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors ${
                active === tab.id
                  ? 'border-pass text-foreground'
                  : 'border-transparent text-haze hover:text-foreground hover:border-line'
              }`}
            >
              {tab.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
