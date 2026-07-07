'use client';

import { useState, useEffect } from 'react';
import {
    useQueryStates,
    parseAsInteger,
    parseAsFloat,
    parseAsBoolean,
    parseAsString,
} from 'nuqs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Filter } from 'lucide-react';

export interface FilterState {
    showSold: boolean;
    minPrice: number;
    maxPrice: number;
    minBeds: number;
    minBaths: number;
    onlyOnePercentRule: boolean;
    minCapRate: number;
    minCashOnCash: number;
    propertyType: string;
    saleType: string;
    strategy: string;
    // Wave 4 — investor filters
    hoaMax: number;      // 0 = off
    domMin: number;      // 0 = off
    hasPriceCut: boolean;
}

/**
 * Shared nuqs parser map for the property filter URL state.
 *
 * Exported so the parent page can read/write the exact same query-param keys
 * via `useQueryStates(propertyFilterParsers)` without duplicating definitions.
 *
 * Default values intentionally match the previous local-state defaults so the
 * initial render is unchanged when no query params are present.
 */
export const propertyFilterParsers = {
    sold: parseAsBoolean.withDefault(false),
    pmin: parseAsInteger.withDefault(0),
    pmax: parseAsInteger.withDefault(2000000),
    beds: parseAsInteger.withDefault(0),
    baths: parseAsFloat.withDefault(0),
    op: parseAsBoolean.withDefault(false),
    cap: parseAsFloat.withDefault(0),
    coc: parseAsFloat.withDefault(0),
    type: parseAsString.withDefault(''),
    sale: parseAsString.withDefault(''),
    strat: parseAsString.withDefault('buy_hold'),
    // Wave 4 — investor filters
    hoamax: parseAsInteger.withDefault(0),
    dom: parseAsInteger.withDefault(0),
    cut: parseAsBoolean.withDefault(false),
};

/**
 * Convert the nuqs URL-state shape to the legacy `FilterState` shape consumed
 * by the dashboard and downstream components.
 */
export function toFilterState(qs: {
    sold: boolean;
    pmin: number;
    pmax: number;
    beds: number;
    baths: number;
    op: boolean;
    cap: number;
    coc: number;
    type: string;
    sale: string;
    strat: string;
    hoamax: number;
    dom: number;
    cut: boolean;
}): FilterState {
    return {
        showSold: qs.sold,
        minPrice: qs.pmin,
        maxPrice: qs.pmax,
        minBeds: qs.beds,
        minBaths: qs.baths,
        onlyOnePercentRule: qs.op,
        minCapRate: qs.cap,
        minCashOnCash: qs.coc,
        propertyType: qs.type,
        saleType: qs.sale,
        strategy: qs.strat,
        hoaMax: qs.hoamax,
        domMin: qs.dom,
        hasPriceCut: qs.cut,
    };
}

interface PropertyTypeRule {
    propertyType: string;
    isRentable: boolean;
    targetRatio: number | null;
}

const FALLBACK_TYPES = [
    { value: '', label: 'Any' },
    { value: 'single_family', label: 'Single Family' },
    { value: 'multi_family', label: 'Multi-Family' },
    { value: 'condos', label: 'Condo' },
    { value: 'townhomes', label: 'Townhouse' },
    { value: 'mobile', label: 'Mobile' },
];

function formatTypeLabel(type: string): string {
    return type
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PropertyFilters() {
    const [isOpen, setIsOpen] = useState(false);
    const [propertyTypes, setPropertyTypes] = useState<{ value: string; label: string; isRentable: boolean }[]>([]);
    const [typesLoading, setTypesLoading] = useState(true);

    // URL-synced filter state
    const [qs, setQs] = useQueryStates(propertyFilterParsers, {
        history: 'replace',
        shallow: true,
        throttleMs: 300,
        clearOnDefault: true,
    });

    const filters = toFilterState(qs);

    // Fetch property types dynamically from the API
    useEffect(() => {
        let cancelled = false;
        fetch('/api/property-types', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((data: PropertyTypeRule[]) => {
                if (cancelled) return;
                const types = [
                    { value: '', label: 'Any', isRentable: true },
                    ...data
                        .filter((t) => t.isRentable)
                        .map((t) => ({
                            value: t.propertyType.toLowerCase(),
                            label: formatTypeLabel(t.propertyType),
                            isRentable: true,
                        })),
                    ...data
                        .filter((t) => !t.isRentable)
                        .map((t) => ({
                            value: t.propertyType.toLowerCase(),
                            label: formatTypeLabel(t.propertyType),
                            isRentable: false,
                        })),
                ];
                setPropertyTypes(types);
                setTypesLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setPropertyTypes(FALLBACK_TYPES.map((t) => ({ ...t, isRentable: true })));
                setTypesLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const displayTypes = typesLoading
        ? FALLBACK_TYPES.map((t) => ({ ...t, isRentable: true }))
        : propertyTypes;

    return (
        <div className="bg-transparent">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button variant="outline" size="sm" onClick={() => setIsOpen(!isOpen)} className="gap-2">
                            <Filter className="h-4 w-4" />
                            Filters
                        </Button>

                        {/* Quick Toggles */}
                        <div className="hidden md:flex items-center gap-4 text-sm">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-haze">Show Sold</span>
                                <input
                                    type="checkbox"
                                    checked={filters.showSold}
                                    onChange={(e) => setQs({ sold: e.target.checked })}
                                    className="rounded border-line bg-white/10 accent-[#0e9f6e]"
                                />
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="font-medium text-pass-hi">1% Rule Only</span>
                                <input
                                    type="checkbox"
                                    checked={filters.onlyOnePercentRule}
                                    onChange={(e) => setQs({ op: e.target.checked })}
                                    className="rounded border-line bg-white/10 accent-[#0e9f6e]"
                                />
                            </label>
                        </div>
                    </div>
                </div>

                {/* Expanded Filters */}
                {isOpen && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-6 animate-in slide-in-from-top-2 duration-200">
                        {/* Price Range */}
                        <div className="space-y-2">
                            <Label>Max Price: ${filters.maxPrice.toLocaleString()}</Label>
                            <input
                                type="range"
                                min="0"
                                max="2000000"
                                step="50000"
                                value={filters.maxPrice}
                                onChange={(e) => setQs({ pmax: Number(e.target.value) })}
                                className="w-full"
                            />
                        </div>

                        {/* Beds */}
                        <div className="space-y-2">
                            <Label>Min. Beds: {filters.minBeds}</Label>
                            <div className="flex gap-2">
                                {[0, 1, 2, 3, 4].map(num => (
                                    <button
                                        key={num}
                                        onClick={() => setQs({ beds: num })}
                                        className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${filters.minBeds === num
                                            ? 'bg-pass text-white'
                                            : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                            }`}
                                    >
                                        {num}+
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Baths */}
                        <div className="space-y-2">
                            <Label>Min. Baths: {filters.minBaths}</Label>
                            <div className="flex gap-2">
                                {[1, 1.5, 2, 2.5, 3].map(num => (
                                    <button
                                        key={num}
                                        onClick={() => setQs({ baths: num })}
                                        className={`px-2 h-8 rounded-full text-sm font-medium transition-colors ${filters.minBaths === num
                                            ? 'bg-pass text-white'
                                            : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                            }`}
                                    >
                                        {num}+
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Investor Metrics */}
                        <div className="space-y-2">
                            <Label>Min Cap Rate: {filters.minCapRate}%</Label>
                            <input
                                type="range"
                                min="0"
                                max="15"
                                step="0.5"
                                value={filters.minCapRate}
                                onChange={(e) => setQs({ cap: Number(e.target.value) })}
                                className="w-full"
                                aria-label="Minimum cap rate"
                            />
                            <Label className="block pt-2">Min Cash-on-Cash: {filters.minCashOnCash}%</Label>
                            <input
                                type="range"
                                min="0"
                                max="20"
                                step="0.5"
                                value={filters.minCashOnCash}
                                onChange={(e) => setQs({ coc: Number(e.target.value) })}
                                className="w-full"
                                aria-label="Minimum cash-on-cash return"
                            />
                        </div>

                        {/* Property Type — dynamically loaded */}
                        <div className="space-y-2 md:col-span-4">
                            <Label>Property Type</Label>
                            <div className="flex flex-wrap gap-2">
                                {displayTypes.map(opt => (
                                    <button
                                        key={opt.value || 'any'}
                                        onClick={() => setQs({ type: opt.value })}
                                        className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${
                                            filters.propertyType === opt.value
                                                ? 'bg-pass text-white'
                                                : opt.isRentable
                                                    ? 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                                    : 'bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06]'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Strategy — drives which rule thresholds apply */}
                        <div className="space-y-2 md:col-span-4">
                            <Label>Strategy</Label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { value: 'buy_hold', label: 'Buy & Hold' },
                                    { value: 'brrrr', label: 'BRRRR' },
                                    { value: 'flip', label: 'Fix & Flip' },
                                    { value: 'str', label: 'Short-Term Rental' },
                                ].map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setQs({ strat: opt.value })}
                                        className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${
                                            filters.strategy === opt.value
                                                ? 'bg-pass text-white'
                                                : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Deal Type — standard vs distress (foreclosure/auction/REO/...) */}
                        <div className="space-y-2 md:col-span-4">
                            <Label>Deal Type</Label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { value: '', label: 'Standard' },
                                    { value: 'foreclosure', label: 'Foreclosure' },
                                    { value: 'pre_foreclosure', label: 'Pre-Foreclosure' },
                                    { value: 'reo', label: 'REO' },
                                    { value: 'auction', label: 'Auction' },
                                    { value: 'short_sale', label: 'Short Sale' },
                                ].map(opt => (
                                    <button
                                        key={opt.value || 'standard'}
                                        onClick={() => setQs({ sale: opt.value })}
                                        className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${
                                            filters.saleType === opt.value
                                                ? 'bg-amber-600 text-white'
                                                : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Wave 4 — Motivated-seller signals */}
                        <div className="space-y-2 md:col-span-4">
                            <Label>Seller Signals</Label>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={() => setQs({ cut: !filters.hasPriceCut })}
                                    className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${
                                        filters.hasPriceCut
                                            ? 'bg-brass text-zinc-950'
                                            : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                    }`}
                                    aria-pressed={filters.hasPriceCut}
                                >
                                    Price Reduced
                                </button>
                                {[
                                    { value: 30, label: '30+ DOM' },
                                    { value: 60, label: '60+ DOM' },
                                    { value: 90, label: '90+ DOM' },
                                ].map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setQs({ dom: filters.domMin === opt.value ? 0 : opt.value })}
                                        className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${
                                            filters.domMin === opt.value
                                                ? 'bg-brass text-zinc-950'
                                                : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                        }`}
                                        aria-pressed={filters.domMin === opt.value}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                                {[
                                    { value: 100, label: 'HOA ≤ $100' },
                                    { value: 300, label: 'HOA ≤ $300' },
                                ].map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setQs({ hoamax: filters.hoaMax === opt.value ? 0 : opt.value })}
                                        className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${
                                            filters.hoaMax === opt.value
                                                ? 'bg-pass text-white'
                                                : 'bg-white/[0.05] text-haze hover:bg-white/[0.1]'
                                        }`}
                                        aria-pressed={filters.hoaMax === opt.value}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Mobile Toggles */}
                        <div className="md:hidden space-y-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={filters.showSold}
                                    onChange={(e) => setQs({ sold: e.target.checked })}
                                    className="rounded border-line bg-white/10 accent-[#0e9f6e]"
                                />
                                <span className="text-haze">Show Sold Listings</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={filters.onlyOnePercentRule}
                                    onChange={(e) => setQs({ op: e.target.checked })}
                                    className="rounded border-line bg-white/10 accent-[#0e9f6e]"
                                />
                                <span className="font-medium text-pass-hi">1% Rule Deals Only</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
