'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Filter, X } from 'lucide-react';

export interface FilterState {
    showSold: boolean;
    minPrice: number;
    maxPrice: number;
    minBeds: number;
    minBaths: number;
    onlyOnePercentRule: boolean;
}

interface PropertyFiltersProps {
    filters: FilterState;
    setFilters: (filters: FilterState) => void;
}

export function PropertyFilters({ filters, setFilters }: PropertyFiltersProps) {
    const [isOpen, setIsOpen] = useState(false);

    // Debounce or local state might be needed for sliders if costly
    // For now, direct update.

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
                                    onChange={(e) => setFilters({ ...filters, showSold: e.target.checked })}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="font-medium text-green-600">1% Rule Only</span>
                                <input
                                    type="checkbox"
                                    checked={filters.onlyOnePercentRule}
                                    onChange={(e) => setFilters({ ...filters, onlyOnePercentRule: e.target.checked })}
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
                                onChange={(e) => setFilters({ ...filters, maxPrice: Number(e.target.value) })}
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
                                        onClick={() => setFilters({ ...filters, minBeds: num })}
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
                                        onClick={() => setFilters({ ...filters, minBaths: num })}
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

                        {/* Mobile Toggles */}
                        <div className="md:hidden space-y-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={filters.showSold}
                                    onChange={(e) => setFilters({ ...filters, showSold: e.target.checked })}
                                    className="rounded border-gray-300"
                                />
                                <span className="text-gray-600">Show Sold Listings</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={filters.onlyOnePercentRule}
                                    onChange={(e) => setFilters({ ...filters, onlyOnePercentRule: e.target.checked })}
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
