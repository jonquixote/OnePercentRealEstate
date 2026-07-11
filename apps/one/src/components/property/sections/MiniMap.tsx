'use client';

// Property-page location context map (C1). Lazy-mounted (IntersectionObserver
// + next/dynamic in the page) so maplibre never touches the critical path.
// Static camera: no drag/zoom — clicking anywhere opens the full map at this
// viewport. Rent-heat overlay on by default at low opacity: every property
// page quietly demonstrates the hyperlocal data moat. Nearby active listings
// arrive for free via the shared MVT pin layers.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// dynamic + ssr:false keeps maplibre (~220KB) out of the property page's
// critical chunk entirely; the IntersectionObserver below defers even the
// dynamic fetch until the section approaches the viewport.
const PropertyMap = dynamic(
  () => import('@/components/PropertyMap').then((m) => m.PropertyMap),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse" style={{ background: 'var(--ink-2)' }} /> },
);

interface MiniMapProps {
  latitude: number;
  longitude: number;
  id: string;
}

export function MiniMap({ latitude, longitude, id }: MiniMapProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);

  // Mount the map only when scrolled near (one viewport of margin).
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '100% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const openFullMap = () => {
    router.push(`/search?mv=${longitude.toFixed(4)},${latitude.toFixed(4)},14.0`);
  };

  return (
    <div
      ref={holderRef}
      className="relative h-[320px] overflow-hidden rounded-2xl border"
      style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}
    >
      {visible ? (
        <>
          <PropertyMap
            interactive={false}
            initialCenter={[longitude, latitude]}
            initialZoom={13.5}
            defaultLayers={['rent-heat']}
            onMarkerClick={(pid) => router.push(`/property/${pid}`)}
            onMapInstance={(map, ready) => {
              if (!map || !ready || map.getLayer('minimap-subject')) return;
              // Subject pin: accent dot + halo above everything else.
              map.addSource('minimap-subject', {
                type: 'geojson',
                data: {
                  type: 'FeatureCollection',
                  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: {} }],
                },
              });
              map.addLayer({
                id: 'minimap-subject-halo',
                type: 'circle',
                source: 'minimap-subject',
                paint: { 'circle-color': '#2a2520', 'circle-radius': 12, 'circle-opacity': 0.25 },
              });
              map.addLayer({
                id: 'minimap-subject',
                type: 'circle',
                source: 'minimap-subject',
                paint: {
                  'circle-color': '#b0532f',
                  'circle-radius': 7,
                  'circle-stroke-color': '#faf7f2',
                  'circle-stroke-width': 2,
                },
              });
            }}
          />
          {/* click-through veil: whole mini-map opens the full map */}
          <button
            type="button"
            onClick={openFullMap}
            className="absolute inset-0 z-10 cursor-pointer"
            style={{ background: 'transparent' }}
            aria-label="Open the full map at this location"
            title="Open the full map"
          />
          <span
            className="pointer-events-none absolute bottom-3 right-3 z-20 rounded-full border px-3 py-1 text-[11px] font-medium backdrop-blur"
            style={{ background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)', color: 'var(--haze)' }}
          >
            Rent $/sqft shading · click to explore →
          </span>
        </>
      ) : (
        <div className="h-full w-full animate-pulse" style={{ background: 'var(--ink-2)' }} />
      )}
    </div>
  );
}
