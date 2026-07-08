'use client';

import { useEffect, useState } from 'react';

interface Point { observed_at: string; price: number | null }

/**
 * Wave 5 (W4 leftover) — tiny inline price-history sparkline fed by
 * /api/properties/[id]/history (listings_history rows). Pure SVG, no chart
 * dependency; renders nothing until ≥2 priced observations exist.
 */
export function PriceSparkline({ propertyId }: { propertyId: string | number }) {
    const [points, setPoints] = useState<Point[] | null>(null);

    useEffect(() => {
        let alive = true;
        fetch(`/api/properties/${propertyId}/history`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (alive) setPoints(Array.isArray(d?.points) ? d.points : Array.isArray(d) ? d : []); })
            .catch(() => { if (alive) setPoints([]); });
        return () => { alive = false; };
    }, [propertyId]);

    const priced = (points ?? []).filter((p): p is Point & { price: number } => p.price != null && Number(p.price) > 0)
        .map((p) => ({ ...p, price: Number(p.price) }));
    if (priced.length < 2) return null;

    const w = 160, h = 36, pad = 2;
    const min = Math.min(...priced.map((p) => p.price));
    const max = Math.max(...priced.map((p) => p.price));
    const span = max - min || 1;
    const xy = priced.map((p, i) => {
        const x = pad + (i / (priced.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((p.price - min) / span) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const falling = priced[priced.length - 1].price < priced[0].price;

    return (
        <span className="inline-flex items-center gap-2" title={`Price history: ${priced.length} observations`}>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Price history sparkline" className="overflow-visible">
                <polyline
                    points={xy.join(' ')}
                    fill="none"
                    stroke={falling ? 'var(--brass-hi, #c9a35c)' : 'var(--pass, #0e7a52)'}
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                <circle cx={xy[xy.length - 1].split(',')[0]} cy={xy[xy.length - 1].split(',')[1]} r="2.5" fill={falling ? 'var(--brass-hi, #c9a35c)' : 'var(--pass, #0e7a52)'} />
            </svg>
            <span className="text-xs tabular-nums text-muted-foreground">{priced.length} price points</span>
        </span>
    );
}
