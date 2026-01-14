import * as React from "react"
import { cn } from "@/lib/utils"
import Link from 'next/link';

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

export function PropertyCard({ property, isSelected, onSelect }: PropertyCardProps) {
    const { address, listing_price, estimated_rent, financial_snapshot, status } = property;

    // Calculate 1% Rule Ratio
    const ratio = (estimated_rent / listing_price) * 100;
    const isGoodDeal = ratio >= 1.0;

    // Format currency
    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="relative group block h-full">
            {onSelect && (
                <div className="absolute top-4 right-4 z-20">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                            e.stopPropagation();
                            onSelect(property.id);
                        }}
                        className="h-5 w-5 rounded-md border-gray-300 text-slate-900 focus:ring-slate-900 cursor-pointer shadow-sm transition-colors"
                    />
                </div>
            )}
            <Link href={`/property/${property.id}`} className="block h-full">
                <div className={cn(
                    "flex flex-col h-full overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1",
                    isSelected ? "ring-2 ring-slate-900 ring-offset-2" : ""
                )}>
                    {/* Status Bar */}
                    <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between bg-white relative">
                        <div className="flex items-center space-x-2">
                            <span className={cn(
                                "flex h-2.5 w-2.5 rounded-full",
                                isGoodDeal ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-amber-400"
                            )} />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                {isGoodDeal ? 'STRONG' : 'REVIEW'}
                            </span>
                        </div>
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
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-1">List Price</p>
                                <p className="text-lg font-bold text-gray-900 tracking-tight">{formatCurrency(listing_price)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-1">Est. Rent</p>
                                <div className="flex items-baseline space-x-1">
                                    <p className="text-lg font-bold text-gray-900 tracking-tight">{formatCurrency(estimated_rent)}</p>
                                    <span className="text-xs text-gray-400 font-medium">/mo</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={cn(
                        "px-6 py-4 flex items-center justify-between",
                        isGoodDeal ? "bg-emerald-50/50" : "bg-amber-50/50"
                    )}>
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">1% Rule</span>
                        <div className="flex items-center">
                            <span className={cn(
                                "text-lg font-black tracking-tight",
                                isGoodDeal ? "text-emerald-600" : "text-amber-600"
                            )}>
                                {ratio.toFixed(2)}%
                            </span>
                        </div>
                    </div>
                </div>
            </Link>
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

const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
