'use client';

import { useEffect, useState } from 'react';
import { LayoutDashboard, DollarSign, BarChart3, MapPin, ClipboardCheck, Calculator, Building2 } from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'financials', label: 'Financials', Icon: DollarSign },
  { id: 'comps', label: 'Comps', Icon: BarChart3 },
  { id: 'location', label: 'Location', Icon: MapPin },
  { id: 'analysis', label: 'Analysis', Icon: ClipboardCheck },
  { id: 'calculator', label: 'Calculator', Icon: Calculator },
  { id: 'nearby', label: 'Nearby', Icon: Building2 },
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
    <nav className="sticky top-[57px] z-30 border-b border-line bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60">
      <div className="mx-auto flex max-w-7xl overflow-x-auto px-6 lg:px-8">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              title={tab.label}
              aria-label={tab.label}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(tab.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                active === tab.id
                  ? 'border-pass text-foreground bg-pass-dim'
                  : 'border-transparent text-haze hover:text-foreground hover:border-line'
              }`}
            >
              <tab.Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
