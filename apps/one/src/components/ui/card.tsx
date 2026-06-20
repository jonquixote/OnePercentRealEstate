import * as React from "react"
import Link from 'next/link';
import { LazyMotion, domAnimation, m } from 'motion/react';
import { ArrowDownRight, ArrowUpRight, Loader2 } from 'lucide-react';
import { Media } from '@oper/primitives';
import { cn } from "@/lib/utils"
import { calculatePropertyMetrics } from '@/lib/calculators';

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-US');

const Card = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "rounded-xl border bg-card text-card-foreground shadow",
            className
        )}
        {...props}
    />
))
Card.displayName = "Card"

interface PropertyCardProps {
    property: any;
    isSelected?: boolean;
    onSelect?: (id: string) => void;
}

/**
 * Map raw status values to a display label + tone. The dataset emits
 * `for_sale | pending | sold | watch | ...` — we normalize down for the pill.
 */
function getStatusBadge(status: string | null | undefined): { label: string; tone: 'active' | 'pending' | 'sold' | 'watch' | 'neutral' } {
    const s = (status ?? '').toLowerCase();
    if (s === 'for_sale' || s === 'active' || s === 'forsale' || s === 'for sale') return { label: 'Active', tone: 'active' };
    if (s === 'pending' || s === 'contingent' || s === 'under_contract') return { label: 'Pending', tone: 'pending' };
    if (s === 'sold' || s === 'closed') return { label: 'Sold', tone: 'sold' };
    if (s === 'watch') return { label: 'Watching', tone: 'watch' };
    if (!s) return { label: '—', tone: 'neutral' };
    return { label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), tone: 'neutral' };
}

const statusToneClasses: Record<'active' | 'pending' | 'sold' | 'watch' | 'neutral', string> = {
    active: 'text-emerald-700 dark:text-emerald-300',
    pending: 'text-amber-700 dark:text-amber-300',
    sold: 'text-zinc-600 dark:text-zinc-300',
    watch: 'text-blue-700 dark:text-blue-300',
    neutral: 'text-zinc-600 dark:text-zinc-300',
};

const DISTRESS_LABELS: Record<string, string> = {
    foreclosure: 'Foreclosure',
    pre_foreclosure: 'Pre-Foreclosure',
    reo: 'REO',
    auction: 'Auction',
    short_sale: 'Short Sale',
};

export const PropertyCard = React.memo(function PropertyCard({ property, isSelected, onSelect }: PropertyCardProps) {
    const { address, listing_price, estimated_rent, financial_snapshot, status } = property;

    const { isOnePercentRule, monthlyCashflow } = calculatePropertyMetrics(listing_price, estimated_rent);
    const hasRent = !!estimated_rent && estimated_rent > 0;
    const hasPrice = !!listing_price && listing_price > 0;

    const ratioPct = hasRent && hasPrice ? (estimated_rent / listing_price) * 100 : null;

    // Tier the 1% chip: emerald >= 1, amber 0.85–1, zinc below.
    const ratioTone: 'emerald' | 'amber' | 'zinc' = (() => {
        if (ratioPct == null) return 'zinc';
        if (ratioPct >= 1) return 'emerald';
        if (ratioPct >= 0.85) return 'amber';
        return 'zinc';
    })();

    const ratioBg: Record<typeof ratioTone, string> = {
        emerald: 'bg-emerald-600',
        amber: 'bg-amber-500',
        zinc: 'bg-zinc-700/90',
    } as const;

    const statusBadge = getStatusBadge(status);
    const distressLabel = property.sale_type && property.sale_type !== 'standard'
        ? DISTRESS_LABELS[property.sale_type] ?? null
        : null;

    const handleToggle = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        onSelect?.(property.id);
    }, [onSelect, property.id]);

    const primaryPhoto: string | null = Array.isArray(property.images) && property.images.length > 0 ? property.images[0] : null;
    const media = { primary_photo: primaryPhoto, media_blur: property.media_blur ?? null };

    const beds = financial_snapshot?.bedrooms;
    const baths = financial_snapshot?.bathrooms;
    const sqft = financial_snapshot?.sqft;

    const cashflowPositive = monthlyCashflow >= 0;
    const cashflowAbs = Math.abs(Math.round(monthlyCashflow));

    return (
        <LazyMotion features={domAnimation} strict>
            <m.div
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '0px 0px -40px 0px' }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="relative group block h-full"
            >
                {onSelect && (
                    <div
                        className="absolute top-3 right-3 z-30 md:opacity-0 md:group-hover:opacity-100 opacity-90 transition-opacity duration-200 bg-white/90 dark:bg-zinc-900/80 backdrop-blur-sm rounded-md p-0.5 shadow-sm"
                        title="Select to Compare"
                    >
                        <input
                            type="checkbox"
                            checked={!!isSelected}
                            onChange={handleToggle}
                            aria-label={`Select ${address} for compare`}
                            className="h-5 w-5 rounded-md border-gray-300 dark:border-zinc-700 text-slate-900 focus:ring-slate-900 cursor-pointer transition-colors"
                        />
                    </div>
                )}
                <Link
                    href={`/property/${property.id}`}
                    aria-label={address}
                    className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-zinc-100 rounded-2xl"
                >
                    <article
                        className={cn(
                            "relative flex flex-col h-full overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 shadow-sm transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-1 group-hover:border-zinc-300 dark:group-hover:border-zinc-700",
                            isSelected && "ring-2 ring-slate-900 dark:ring-zinc-100 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950"
                        )}
                    >
                        {/* Hero image (16:9) */}
                        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-t-2xl bg-zinc-100 dark:bg-zinc-800">
                            {primaryPhoto ? (
                                <div className="absolute inset-0 transition-transform duration-300 ease-out group-hover:scale-[1.03]">
                                    <Media
                                        media={media}
                                        alt={address}
                                        fill
                                        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                                        className="object-cover"
                                    />
                                </div>
                            ) : (
                                <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500">
                                    <span className="text-xs">No Image</span>
                                </div>
                            )}

                            {/* Bottom gradient for legibility under chip on bright photos */}
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/25 to-transparent" />

                            {/* Status pill + distress badge (top-left, stacked) */}
                            <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1.5">
                                <span
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-full bg-white/85 dark:bg-zinc-900/80 backdrop-blur-sm px-2.5 py-1 text-[11px] font-semibold tracking-wide shadow-sm",
                                        statusToneClasses[statusBadge.tone]
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            statusBadge.tone === 'active' && 'bg-emerald-500',
                                            statusBadge.tone === 'pending' && 'bg-amber-500',
                                            statusBadge.tone === 'sold' && 'bg-zinc-400',
                                            statusBadge.tone === 'watch' && 'bg-blue-500',
                                            statusBadge.tone === 'neutral' && 'bg-zinc-400',
                                        )}
                                    />
                                    {statusBadge.label}
                                </span>
                                {distressLabel && (
                                    <span
                                        className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white shadow-sm"
                                        aria-label={`Distress sale: ${distressLabel}`}
                                    >
                                        {distressLabel}
                                    </span>
                                )}
                            </div>

                            {/* 1% Rule chip (top-right) */}
                            <div className="absolute top-3 right-3 z-10" style={{ marginRight: onSelect ? '2.25rem' : 0 }}>
                                {hasRent && ratioPct != null ? (
                                    <span
                                        className={cn(
                                            "inline-flex items-center rounded-full px-3 py-1.5 text-base font-bold tracking-tight text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]",
                                            ratioBg[ratioTone]
                                        )}
                                        aria-label={`${ratioPct.toFixed(2)} percent of price`}
                                    >
                                        {ratioPct.toFixed(2)}%
                                    </span>
                                ) : (
                                    <span
                                        className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200/90 dark:bg-zinc-800/90 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 shadow-sm animate-pulse"
                                        aria-label="Calculating one percent rule"
                                    >
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        Calculating…
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex flex-1 flex-col p-5">
                            {/* Price */}
                            <div className="flex items-baseline justify-between gap-3">
                                <p className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900 dark:text-zinc-50">
                                    {hasPrice ? currencyFormatter.format(listing_price) : '—'}
                                </p>
                                {hasRent ? (
                                    <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                                        {currencyFormatter.format(estimated_rent)}<span className="text-zinc-400 dark:text-zinc-500">/mo rent</span>
                                    </span>
                                ) : null}
                            </div>

                            {/* Address */}
                            <h3 className="mt-1 line-clamp-1 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                                {address}
                            </h3>

                            {/* Spec strip */}
                            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 tabular-nums">
                                <span>{beds || '—'} bd</span>
                                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                                <span>{baths || '—'} ba</span>
                                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                                <span>{sqft ? numberFormatter.format(sqft) : '—'} sqft</span>
                            </div>

                            {/* Bottom row: monthly cashflow */}
                            <div className="mt-auto pt-4 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800 mt-4">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                    Est. Cashflow
                                </span>
                                {hasRent ? (
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1 text-sm font-semibold tabular-nums",
                                            cashflowPositive
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-rose-600 dark:text-rose-400'
                                        )}
                                    >
                                        {cashflowPositive ? (
                                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                        ) : (
                                            <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                                        )}
                                        {cashflowPositive ? '+' : '−'}{currencyFormatter.format(cashflowAbs)}/mo
                                    </span>
                                ) : (
                                    <span className="text-sm font-medium italic text-zinc-400 dark:text-zinc-500">
                                        Pending…
                                    </span>
                                )}
                            </div>
                        </div>
                    </article>
                </Link>
            </m.div>
        </LazyMotion>
    );
});

/**
 * Skeleton that matches PropertyCard layout dimensions. Pulses while data
 * is loading. Safe to render in a grid where PropertyCard would be.
 */
export function PropertyCardSkeleton() {
    return (
        <div className="relative h-full">
            <div className="flex flex-col h-full overflow-hidden rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800 shadow-sm animate-pulse">
                {/* Image area */}
                <div className="relative aspect-[16/9] w-full bg-zinc-200 dark:bg-zinc-800">
                    <div className="absolute top-3 left-3 h-6 w-16 rounded-full bg-zinc-300/70 dark:bg-zinc-700" />
                    <div className="absolute top-3 right-3 h-7 w-16 rounded-full bg-zinc-300/70 dark:bg-zinc-700" />
                </div>
                {/* Body */}
                <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-baseline justify-between gap-3">
                        <div className="h-7 w-28 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-3 w-20 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                    </div>
                    <div className="mt-2 h-4 w-3/4 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                    <div className="mt-3 h-4 w-40 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                    <div className="mt-auto pt-4 mt-4 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800">
                        <div className="h-3 w-24 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                        <div className="h-4 w-20 rounded-md bg-zinc-200 dark:bg-zinc-800" />
                    </div>
                </div>
            </div>
        </div>
    );
}

const CardHeader = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("flex flex-col space-y-1.5 p-6", className)}
        {...props}
    />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    <h3
        ref={ref}
        className={cn(
            "text-2xl font-semibold leading-none tracking-tight",
            className
        )}
        {...props}
    />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <p
        ref={ref}
        className={cn("text-sm text-muted-foreground", className)}
        {...props}
    />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent, CardDescription }
