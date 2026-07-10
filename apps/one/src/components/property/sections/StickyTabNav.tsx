'use client';

import { useEffect, useState, useRef } from 'react';

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
  const [showRightFade, setShowRightFade] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setShowRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, []);

  return (
    <nav className="sticky top-[121px] z-30 border-b border-line bg-ink/80 backdrop-blur supports-[backdrop-filter]:bg-ink/60">
      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <div ref={scrollRef} className="flex gap-4 overflow-x-auto py-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {TABS.map((tab) => (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(tab.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`whitespace-nowrap border-b-2 py-1 text-sm font-medium transition-colors ${
                active === tab.id
                  ? 'border-pass text-foreground'
                  : 'border-transparent text-haze hover:text-foreground hover:border-line'
              }`}
            >
              {tab.label}
            </a>
          ))}
        </div>
        {/* right fade hint for horizontal scroll */}
        {showRightFade && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-ink to-transparent lg:hidden" />
        )}
      </div>
    </nav>
  );
}
