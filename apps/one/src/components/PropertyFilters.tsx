'use client';

import { useState } from 'react';
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
    };
}

export function PropertyFilters() {
    const [isOpen, setIsOpen] = useState(false);

    // URL-synced filter state. Writes are throttled (debounced at the URL level)
    // so dragging a slider doesn't flood `history.replaceState`. The 300ms value
    // matches the previously local-debounce timing on the parent's data fetch.
    const [qs, setQs] = useQueryStates(propertyFilterParsers, {
        history: 'replace',
        shallow: true,
        throttleMs: 300,
        clearOnDefault: true,
    });

    const filters = toFilterState(qs);

    return (
        <div className="bg-white border-b border-gray-200">
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
                                <span className="text-gray-600">Show Sold</span>
                                <input
                                    type="checkbox"
                                    checked={filters.showSold}
                                    onChange={(e) => setQs({ sold: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="font-medium text-green-600">1% Rule Only</span>
                                <input
                                    type="checkbox"
                                    checked={filters.onlyOnePercentRule}
                                    onChange={(e) => setQs({ op: e.target.checked })}
                                    className="rounded border-gray-300 text-green-600 focus:ring-green-500"
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
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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

                        {/* Property Type */}
                        <div className="space-y-2 md:col-span-4">
                            <Label>Property Type</Label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { value: '', label: 'Any' },
                                    { value: 'single_family', label: 'Single Family' },
                                    { value: 'multi_family', label: 'Multi-Family' },
                                    { value: 'condo', label: 'Condo' },
                                    { value: 'townhouse', label: 'Townhouse' },
                                ].map(opt => (
                                    <button
                                        key={opt.value || 'any'}
                                        onClick={() => setQs({ type: opt.value })}
                                        className={`px-3 h-8 rounded-full text-sm font-medium transition-colors ${filters.propertyType === opt.value
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
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
                                    className="rounded border-gray-300"
                                />
                                <span className="text-gray-600">Show Sold Listings</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={filters.onlyOnePercentRule}
                                    onChange={(e) => setQs({ op: e.target.checked })}
                                    className="rounded border-gray-300"
                                />
                                <span className="font-medium text-green-600">1% Rule Deals Only</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
