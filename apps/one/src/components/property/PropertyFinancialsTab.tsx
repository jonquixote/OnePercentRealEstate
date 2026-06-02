'use client';

import { AdvancedRentEstimator } from '@/components/AdvancedRentEstimator';
import { CashflowCalculator } from '@/components/CashflowCalculator';

interface PropertyFinancialsTabProps {
    property: any;
    isOnePercentRule: boolean;
}

export function PropertyFinancialsTab({ property, isOnePercentRule }: PropertyFinancialsTabProps) {
    return (
        <div id="tabpanel-financials" role="tabpanel" aria-labelledby="tab-financials" className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
            <div className="lg:col-span-1 space-y-6">
                <AdvancedRentEstimator
                    property={property}
                    onEstimateUpdate={() => { }}
                />
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
                    <h3 className="text-blue-900 font-semibold mb-2">Analyst Note</h3>
                    <p className="text-sm text-blue-800">
                        This property {isOnePercentRule ? 'passes' : 'does not pass'} the 1% rule.
                        {isOnePercentRule
                            ? ' It shows strong potential for immediate cash flow.'
                            : ' Consider negotiating the price down or verifying if market rents are higher.'}
                    </p>
                </div>
            </div>
            <div className="lg:col-span-2">
                <CashflowCalculator property={property} />
            </div>
        </div>
    );
}
