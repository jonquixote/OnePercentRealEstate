'use client';

import { useState } from 'react';
import { Bell, Check, Loader2 } from 'lucide-react';
import type { FilterState } from '@/components/PropertyFilters';

/**
 * Wave 5 — "Watch this search": snapshots the current filters as a watchlist
 * criteria query. The alert worker evaluates it every ~15 min; new matches
 * (incl. price cuts once price_cut_pct is in the query) become alert emails.
 */
export function WatchSearchButton({ filters }: { filters: FilterState }) {
    const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'login' | 'error'>('idle');

    const buildQuery = (): Record<string, unknown> => {
        const q: Record<string, unknown> = {};
        if (filters.minPrice > 0 || filters.maxPrice < 10000000) {
            q.price = {
                ...(filters.minPrice > 0 ? { min: filters.minPrice } : {}),
                ...(filters.maxPrice < 10000000 ? { max: filters.maxPrice } : {}),
            };
        }
        if (filters.minBeds > 0) q.bedrooms = { min: filters.minBeds };
        if (filters.minBaths > 0) q.bathrooms = { min: filters.minBaths };
        if (filters.propertyType) q.property_type = filters.propertyType;
        q.sale_type = filters.saleType || 'standard';
        if (filters.hasPriceCut) q.price_cut_pct = { min: 0.0001 };
        if (filters.domMin > 0) q.days_on_market = { min: filters.domMin };
        return q;
    };

    const save = async () => {
        setState('saving');
        try {
            const query = buildQuery();
            const label = Object.keys(query).filter((k) => k !== 'sale_type').join(' · ') || 'all listings';
            const res = await fetch('/api/watchlists', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: `Watch: ${label}`.slice(0, 100), query }),
            });
            if (res.status === 401) { setState('login'); return; }
            if (!res.ok) { setState('error'); return; }
            setState('saved');
            setTimeout(() => setState('idle'), 2500);
        } catch {
            setState('error');
        }
    };

    return (
        <button
            onClick={state === 'login' ? () => (window.location.href = '/login') : save}
            disabled={state === 'saving'}
            className={`inline-flex items-center gap-2 px-3 h-9 rounded-full text-sm font-medium transition-colors ${
                state === 'saved'
                    ? 'bg-pass text-white'
                    : 'bg-white/[0.05] text-haze hover:bg-white/[0.1] border border-line'
            }`}
            title="Get alerted when new listings (and price cuts) match these filters"
        >
            {state === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : state === 'saved' ? <Check className="h-4 w-4" aria-hidden="true" />
                : <Bell className="h-4 w-4" aria-hidden="true" />}
            {state === 'saved' ? 'Watching' : state === 'login' ? 'Log in to watch' : state === 'error' ? 'Retry watch' : 'Watch this search'}
        </button>
    );
}
