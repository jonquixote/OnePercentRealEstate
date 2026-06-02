import * as React from "react"
import { cn } from "@/lib/utils"
import Link from 'next/link';
import { CheckCircle, Loader2 } from 'lucide-react';
import { calculatePropertyMetrics } from '@/lib/calculators';

const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

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

export const PropertyCard = React.memo(function PropertyCard({ property, isSelected, onSelect }: PropertyCardProps) {
    const { address, listing_price, estimated_rent, financial_snapshot, status } = property;

    const { isOnePercentRule, monthlyCashflow } = calculatePropertyMetrics(listing_price, estimated_rent);
    const hasRent = estimated_rent && estimated_rent > 0;

    const handleToggle = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        onSelect?.(property.id);
    }, [onSelect, property.id]);

    return (
        <div className="relative group block h-full">
            {onSelect && (
                <div className="absolute top-4 right-4 z-20 md:opacity-0 md:group-hover:opacity-100 opacity-90 transition-opacity duration-200 bg-white/90 rounded-md p-0.5 shadow-sm" title="Select to Compare">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={handleToggle}
                        aria-label={`Select ${address} for compare`}
                        className="h-5 w-5 rounded-md border-gray-300 text-slate-900 focus:ring-slate-900 cursor-pointer transition-colors"
                    />
                </div>
            )}
            <Link href={`/property/${property.id}`} className="block h-full">
                <div className={cn(
                    "flex flex-col h-full overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1",
                    isSelected ? "ring-2 ring-slate-900 ring-offset-2" : ""
                )}>
                    {/* Main Image */}
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
                        {property.images && property.images.length > 0 ? (
                            <img
                                src={property.images[0]}
                                alt={address}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400">
                                <span className="text-xs">No Image</span>
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    </div>

                    {/* Status Bar */}
                    <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-white relative">
                        {hasRent ? (
                            <div className="flex items-center space-x-2">
                                <span className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide",
                                    isOnePercentRule
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                )}>
                                    <CheckCircle className={cn("h-3 w-3", isOnePercentRule ? "text-emerald-600" : "text-amber-600")} />
                                    {isOnePercentRule ? 'Strong Deal' : 'Review'}
                                </span>
                            </div>
                        ) : (
                            <div className="flex items-center space-x-2">
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide bg-blue-100 text-blue-800">
                                    <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />
                                    Calculating...
                                </span>
                            </div>
                        )}
                        <span className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
                            status === 'watch'
                                ? "bg-blue-50 text-blue-700 border border-blue-100"
                                : "bg-gray-50 text-gray-600 border border-gray-100"
                        )}>
                            {status}
                        </span>
                    </div>

                    <div className="p-6 flex-1 flex flex-col">
                        <div className="mb-6 flex-1">
                            <h3 className="text-xl font-bold leading-tight text-gray-900 group-hover:text-slate-700 transition-colors line-clamp-2">
                                {address}
                            </h3>
                            <div className="mt-3 flex items-center space-x-4 text-sm text-gray-500 font-medium">
                                <span className="flex items-center">
                                    <span className="text-gray-900 font-bold mr-1">{financial_snapshot?.bedrooms || '-'}</span>
                                    <span className="text-xs uppercase tracking-wide">Beds</span>
                                </span>
                                <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                <span className="flex items-center">
                                    <span className="text-gray-900 font-bold mr-1">{financial_snapshot?.bathrooms || '-'}</span>
                                    <span className="text-xs uppercase tracking-wide">Baths</span>
                                </span>
                                <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                <span className="flex items-center">
                                    <span className="text-gray-900 font-bold mr-1">{financial_snapshot?.sqft || '-'}</span>
                                    <span className="text-xs uppercase tracking-wide">SqFt</span>
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6 pt-6 border-t border-gray-50">
                            <div>
                                <p className="text-xs uppercase tracking-wider font-semibold text-gray-600 mb-1">List Price</p>
                                <p className="text-lg font-bold text-gray-900 tracking-tight">{listing_price > 0 ? currencyFormatter.format(listing_price) : '—'}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-wider font-semibold text-gray-600 mb-1 flex items-center gap-1">
                                    Est. Rent
                                    <span className="inline-block w-3 h-3 rounded-full bg-blue-100 text-blue-700 text-[9px] font-bold flex items-center justify-center cursor-help" title="Smart estimate based on nearby rentals and HUD data" aria-label="More info">?</span>
                                </p>
                                <div className="flex items-baseline space-x-1">
                                    {hasRent ? (
                                        <>
                                            <p className="text-lg font-bold text-gray-900 tracking-tight">{currencyFormatter.format(estimated_rent)}</p>
                                            <span className="text-xs text-gray-500 font-medium">/mo</span>
                                        </>
                                    ) : (
                                        <p className="text-sm font-medium text-gray-500 italic">Pending...</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={cn(
                        "px-6 py-4 flex items-center justify-between",
                        hasRent && isOnePercentRule ? "bg-emerald-50/50" : (hasRent ? "bg-amber-50/50" : "bg-gray-50")
                    )}>
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">1% Rule</span>
                        <div className="flex items-center">
                            <span className={cn(
                                "text-lg font-black tracking-tight",
                                hasRent ? (isOnePercentRule ? "text-emerald-600" : "text-amber-600") : "text-gray-300"
                            )}>
                                {hasRent && listing_price > 0 ? ((estimated_rent / listing_price) * 100).toFixed(2) + '%' : '—'}
                            </span>
                        </div>
                    </div>
                </div>
            </Link>
        </div>
    );
});

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
