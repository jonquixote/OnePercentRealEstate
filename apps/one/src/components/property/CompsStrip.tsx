'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Media } from '@oper/primitives';

interface CompItem {
    id: string;
    address: string;
    price: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    estimated_rent: number | null;
    primary_photo: string | null;
    distance_m: number;
    status: string;
}

interface CompsResponse {
    items: CompItem[];
}

interface CompsStripProps {
    propertyId: string | number;
}

const priceFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

const milesFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
});

function formatDistance(meters: number): string {
    const miles = meters / 1609.344;
    if (miles < 0.1) return '< 0.1 mi away';
    return `${milesFormatter.format(miles)} mi away`;
}

function formatBeds(beds: number | null): string {
    if (beds === null) return '— bd';
    // Drop trailing .0 for whole numbers
    const display = Number.isInteger(beds) ? beds.toString() : beds.toFixed(1);
    return `${display} bd`;
}

function formatBaths(baths: number | null): string {
    if (baths === null) return '— ba';
    const display = Number.isInteger(baths) ? baths.toString() : baths.toFixed(1);
    return `${display} ba`;
}

function formatSqft(sqft: number | null): string {
    if (sqft === null) return '— sqft';
    return `${sqft.toLocaleString('en-US')} sqft`;
}

export function CompsStrip({ propertyId }: CompsStripProps) {
    const [items, setItems] = useState<CompItem[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [emblaRef, emblaApi] = useEmblaCarousel({
        loop: false,
        slidesToScroll: 1,
        align: 'start',
        dragFree: false,
        watchDrag: true,
        containScroll: 'trimSnaps',
    });

    const [canPrev, setCanPrev] = useState(false);
    const [canNext, setCanNext] = useState(false);

    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setCanPrev(emblaApi.canScrollPrev());
        setCanNext(emblaApi.canScrollNext());
    }, [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;
        onSelect();
        emblaApi.on('select', onSelect);
        emblaApi.on('reInit', onSelect);
        return () => {
            emblaApi.off('select', onSelect);
            emblaApi.off('reInit', onSelect);
        };
    }, [emblaApi, onSelect]);

    useEffect(() => {
        let cancelled = false;
        async function fetchComps() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/properties/${propertyId}/comps`);
                if (!res.ok) {
                    if (!cancelled) {
                        setError(`Failed: ${res.status}`);
                        setItems([]);
                    }
                    return;
                }
                const data = (await res.json()) as CompsResponse;
                if (!cancelled) {
                    setItems(Array.isArray(data.items) ? data.items : []);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load comps');
                    setItems([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        fetchComps();
        return () => {
            cancelled = true;
        };
    }, [propertyId]);

    // Loading skeleton
    if (loading) {
        return (
            <section aria-label="Comparable properties" className="space-y-4">
                <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Comparable Properties</h3>
                </div>
                <div className="overflow-hidden">
                    <div className="flex gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="shrink-0 basis-[260px] sm:basis-[280px] md:basis-[320px]"
                            >
                                <div className="aspect-[16/9] w-full animate-pulse rounded-lg bg-gray-200" />
                                <div className="mt-2 space-y-2">
                                    <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                                    <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200" />
                                    <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
        );
    }

    // Hide section entirely on error or empty
    if (error || !items || items.length === 0) {
        return null;
    }

    return (
        <section aria-label="Comparable properties" className="space-y-4">
            <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Comparable Properties</h3>
                <p className="hidden text-xs text-gray-500 sm:block">
                    {items.length} similar listings nearby
                </p>
            </div>

            <div className="relative">
                <div className="overflow-hidden" ref={emblaRef}>
                    <div className="flex gap-4">
                        {items.map((it) => (
                            <Link
                                key={it.id}
                                href={`/property/${it.id}`}
                                className="group shrink-0 basis-[260px] sm:basis-[280px] md:basis-[320px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-lg"
                            >
                                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-gray-100">
                                    <Media
                                        media={{ primary_photo: it.primary_photo }}
                                        alt={it.address}
                                        fill
                                        sizes="320px"
                                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                                    />
                                    <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-medium text-gray-700 shadow-sm">
                                        {formatDistance(it.distance_m)}
                                    </span>
                                </div>
                                <div className="mt-2 space-y-1">
                                    <p className="font-semibold tabular-nums text-gray-900">
                                        {it.price != null ? priceFormatter.format(it.price) : '—'}
                                    </p>
                                    <p className="line-clamp-1 text-sm text-gray-700">
                                        {it.address || 'Address unavailable'}
                                    </p>
                                    <p className="text-xs text-gray-500 tabular-nums">
                                        {formatBeds(it.bedrooms)} · {formatBaths(it.bathrooms)} ·{' '}
                                        {formatSqft(it.sqft)}
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>

                {/* Desktop-only nav arrows */}
                <button
                    type="button"
                    aria-label="Previous comparable properties"
                    onClick={() => emblaApi?.scrollPrev()}
                    disabled={!canPrev}
                    className="absolute left-0 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white p-2 shadow-md transition hover:bg-gray-50 disabled:opacity-0 md:flex"
                >
                    <ChevronLeft className="h-4 w-4 text-gray-700" />
                </button>
                <button
                    type="button"
                    aria-label="Next comparable properties"
                    onClick={() => emblaApi?.scrollNext()}
                    disabled={!canNext}
                    className="absolute right-0 top-1/2 hidden translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white p-2 shadow-md transition hover:bg-gray-50 disabled:opacity-0 md:flex"
                >
                    <ChevronRight className="h-4 w-4 text-gray-700" />
                </button>
            </div>
        </section>
    );
}

export default CompsStrip;
