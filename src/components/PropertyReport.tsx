import React from 'react';

interface PropertyReportProps {
    property: any;
    id?: string; // For the DOM element ID
}

export const PropertyReport = React.forwardRef<HTMLDivElement, PropertyReportProps>(
    ({ property, id }, ref) => {
        const { address, listing_price, estimated_rent, financial_snapshot, status, images, raw_data } = property;

        // Helper to format currency
        const formatCurrency = (val: number) =>
            new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

        // Helper to format percent
        const formatPercent = (val: number) =>
            `${(val * 100).toFixed(2)}%`;

        const ratio = (estimated_rent / listing_price);
        const grossYield = (estimated_rent * 12) / listing_price;

        // Simple expenses for report
        const vacancy = estimated_rent * 0.05;
        const maintenance = estimated_rent * 0.05;
        const management = estimated_rent * 0.10;
        const taxes = (listing_price * 0.02) / 12;
        const insurance = (listing_price * 0.005) / 12;
        const totalExpenses = vacancy + maintenance + management + taxes + insurance;
        const cashFlow = estimated_rent - totalExpenses;

        return (
            <div
                id={id}
                ref={ref}
                className="bg-white p-8 max-w-[800px] mx-auto text-gray-900"
                style={{ width: '800px', minHeight: '1000px' }} // Fixed width for consistent PDF
            >
                {/* Header */}
                <div className="border-b border-gray-200 pb-6 mb-6">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-2">{address}</h1>
                            <p className="text-gray-500 text-sm uppercase tracking-wide font-semibold">Investment Analysis Report</p>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-bold text-blue-600">{formatCurrency(listing_price)}</div>
                            <div className="text-sm text-gray-500">Listing Price</div>
                        </div>
                    </div>
                </div>

                {/* Main Image */}
                {images && images.length > 0 && (
                    <div className="mb-8">
                        <img
                            src={images[0]}
                            alt="Property"
                            className="w-full h-64 object-cover rounded-lg shadow-sm"
                        />
                    </div>
                )}

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-3 gap-6 mb-8 bg-gray-50 p-6 rounded-lg">
                    <div>
                        <p className="text-sm text-gray-500 mb-1">Estimated Rent</p>
                        <p className="text-xl font-bold text-gray-900">{formatCurrency(estimated_rent)}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 mb-1">1% Rule Ratio</p>
                        <p className={`text-xl font-bold ${ratio >= 0.01 ? 'text-green-600' : 'text-yellow-600'}`}>
                            {formatPercent(ratio)}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500 mb-1">Gross Yield</p>
                        <p className="text-xl font-bold text-gray-900">{formatPercent(grossYield)}</p>
                    </div>
                </div>

                {/* Property Specs */}
                <div className="mb-8">
                    <h2 className="text-lg font-bold border-b border-gray-100 pb-2 mb-4">Property Specifications</h2>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                            <span className="block text-gray-500">Bedrooms</span>
                            <span className="font-semibold">{financial_snapshot?.bedrooms || '-'}</span>
                        </div>
                        <div>
                            <span className="block text-gray-500">Bathrooms</span>
                            <span className="font-semibold">{financial_snapshot?.bathrooms || '-'}</span>
                        </div>
                        <div>
                            <span className="block text-gray-500">Square Feet</span>
                            <span className="font-semibold">{financial_snapshot?.sqft?.toLocaleString() || '-'}</span>
                        </div>
                        <div>
                            <span className="block text-gray-500">Year Built</span>
                            <span className="font-semibold">{financial_snapshot?.year_built || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Financial Breakdown */}
                <div className="mb-8">
                    <h2 className="text-lg font-bold border-b border-gray-100 pb-2 mb-4">Monthly Financial Breakdown</h2>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between font-semibold">
                            <span>Gross Income</span>
                            <span>{formatCurrency(estimated_rent)}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                            <span>Vacancy (5%)</span>
                            <span>-{formatCurrency(vacancy)}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                            <span>Maintenance (5%)</span>
                            <span>-{formatCurrency(maintenance)}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                            <span>Management (10%)</span>
                            <span>-{formatCurrency(management)}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                            <span>Property Taxes (Est)</span>
                            <span>-{formatCurrency(taxes)}</span>
                        </div>
                        <div className="flex justify-between text-red-600">
                            <span>Insurance (Est)</span>
                            <span>-{formatCurrency(insurance)}</span>
                        </div>
                        <div className="border-t border-gray-300 my-2 pt-2 flex justify-between font-bold text-lg">
                            <span>Net Operating Income</span>
                            <span className="text-blue-600">{formatCurrency(cashFlow)}</span>
                        </div>
                    </div>
                </div>

                {/* Footer / Watermark */}
                <div className="mt-auto pt-8 border-t border-gray-200 text-center">
                    <p className="text-gray-400 text-sm italic">
                        Generated by OnePercentRealEstate - Analyze your deals for free.
                    </p>
                </div>
            </div>
        );
    }
);

PropertyReport.displayName = 'PropertyReport';
