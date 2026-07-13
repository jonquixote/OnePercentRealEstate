'use client';

import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useOperMap, rentHeatLayer } from '@oper/map';

// J1 step 3 — the data moat, made visible. A static (non-interactive) LA
// rent-heat surface. Lazy-mounted when scrolled near the viewport so it
// never costs the above-the-fold LCP budget.
function HeatMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { onStyleLoad } = useOperMap({
    container: containerRef,
    center: [-118.315, 34.074],
    zoom: 11.5,
    interactive: false,
  });

  useEffect(() => {
    onStyleLoad((map) => {
      rentHeatLayer().add(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}

export function RentHeatTeaser() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="mx-auto max-w-7xl px-6 py-16 lg:px-8" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="grid items-center gap-10 lg:grid-cols-[2fr_3fr]">
        <div>
          <h2 style={{ font: '400 var(--display-2)/1.15 var(--font-display)' }}>
            Rent, block by block.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed" style={{ color: 'var(--haze)' }}>
            98,000 hexes of observed rent per square foot, refreshed nightly.
            The model prices Hancock Park and Koreatown differently — because
            they are.
          </p>
          <a
            href="/search?mv=-118.3150,34.0740,12.5"
            className="mt-5 inline-block text-[14px] font-semibold hover:underline"
            style={{ color: 'var(--pass)' }}
          >
            Explore the surface →
          </a>
        </div>
        <div ref={ref} className="mat">
          <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[var(--r-mat)]" style={{ background: 'var(--ink-2)' }}>
            {inView ? (
              <HeatMap />
            ) : (
              <span className="prov" style={{ color: 'var(--mute)' }}>live rent-heat map</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
