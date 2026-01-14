import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Info } from 'lucide-react';

const calculatorSchema = z.object({
    // Purchase Details
    purchasePrice: z.number().min(0),
    closingCosts: z.number().min(0),
    downPayment: z.number().min(0),

    // Loan Details
    loanTerm: z.number().min(1).max(40),
    interestRate: z.number().min(0).max(20),
    points: z.number().min(0).max(10),
    pmiRate: z.number().min(0).max(5),

    // Insurance & Taxes
    insuranceCost: z.number().min(0),
    propertyTaxRate: z.number().min(0).max(10),

    // Rental Income
    monthlyRent: z.number().min(0),
    annualRentGrowth: z.number().min(0).max(10),

    // Operating Expenses
    maintenanceRate: z.number().min(0).max(100),
    vacancyRate: z.number().min(0).max(100),
    managementFeeRate: z.number().min(0).max(100),
    capExRate: z.number().min(0).max(100),
    utilities: z.number().min(0),
    hoaFees: z.number().min(0),
    garbage: z.number().min(0),
    otherExpenses: z.number().min(0)
});

type CalculatorInputs = z.infer<typeof calculatorSchema>;

export interface CashflowCalculatorProps {
    property?: any; // Using any to match the loose typing in the project for now
}

interface MonthlyResults {
    cashflow: number;
    totalIncome: number;
    totalExpenses: number;
    mortgage: number;
    operatingExpenses: number;
    taxes: number;
    insurance: number;
    pmi: number;
}

export function CashflowCalculator({ property }: CashflowCalculatorProps) {
    // Get values from property if available, otherwise use defaults
    const defaultPrice = property?.listing_price || 200000;
    const defaultRent = property?.estimated_rent || 2000;

    // Calculate default tax rate if tax amount is available
    let defaultTaxRate = 1.2;
    if (property?.raw_data?.tax_annual_amount && defaultPrice > 0) {
        defaultTaxRate = (property.raw_data.tax_annual_amount / defaultPrice) * 100;
    }

    // Default HOA
    const defaultHOA = property?.raw_data?.hoa_fee || 0;

    const [monthlyResults, setMonthlyResults] = useState<MonthlyResults>({
        cashflow: 0,
        totalIncome: 0,
        totalExpenses: 0,
        mortgage: 0,
        operatingExpenses: 0,
        taxes: 0,
        insurance: 0,
        pmi: 0
    });

    const form = useForm<CalculatorInputs>({
        resolver: zodResolver(calculatorSchema),
        defaultValues: {
            purchasePrice: defaultPrice,
            closingCosts: defaultPrice * 0.03, // 3% closing costs
            downPayment: defaultPrice * 0.20, // 20% down
            loanTerm: 30,
            interestRate: 6.5,
            points: 0,
            pmiRate: 0.5, // Default 0.5% PMI
            insuranceCost: 1200,
            propertyTaxRate: Number(defaultTaxRate.toFixed(2)),
            monthlyRent: defaultRent,
            annualRentGrowth: 3,
            maintenanceRate: 5,
            vacancyRate: 5,
            managementFeeRate: 8,
            capExRate: 5,
            utilities: 0,
            hoaFees: defaultHOA,
            garbage: 0,
            otherExpenses: 0
        }
    });

    // Calculate results when any input changes
    useEffect(() => {
        const subscription = form.watch((value) => {
            if (value) {
                // Ensure all values are treated as numbers
                const safeValue = Object.fromEntries(
                    Object.entries(value).map(([k, v]) => [k, Number(v) || 0])
                ) as CalculatorInputs;
                calculateMonthlyResults(safeValue);
            }
        });
        return () => subscription.unsubscribe();
    }, [form.watch]);

    // Calculate initial results on mount
    useEffect(() => {
        const initialValues = form.getValues();
        calculateMonthlyResults(initialValues);

        // Fetch live mortgage rate
        async function fetchRate() {
            try {
                const res = await fetch('/api/mortgage-rates');
                const data = await res.json();
                if (data.rate) {
                    form.setValue('interestRate', data.rate);
                    // Recalculate with new rate
                    calculateMonthlyResults({ ...form.getValues(), interestRate: data.rate });
                }
            } catch (err) {
                console.error("Failed to fetch mortgage rate", err);
            }
        }
        fetchRate();
    }, []);

    const calculateMonthlyResults = (data: CalculatorInputs) => {
        // Calculate monthly mortgage payment
        const loanAmount = data.purchasePrice - data.downPayment;
        const monthlyRate = data.interestRate / 12 / 100;
        const numPayments = data.loanTerm * 12;

        let monthlyMortgage = 0;
        if (monthlyRate > 0) {
            monthlyMortgage = loanAmount *
                (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
                (Math.pow(1 + monthlyRate, numPayments) - 1);
        } else {
            monthlyMortgage = loanAmount / numPayments;
        }

        // Calculate PMI
        let monthlyPMI = 0;
        const downPaymentPercent = data.downPayment / data.purchasePrice;
        if (downPaymentPercent < 0.20 && data.pmiRate > 0) {
            monthlyPMI = (loanAmount * (data.pmiRate / 100)) / 12;
        }

        // Calculate monthly income
        const monthlyRent = data.monthlyRent;
        const totalIncome = monthlyRent;

        // Calculate monthly expenses
        const monthlyInsurance = data.insuranceCost / 12;
        const monthlyPropertyTax = data.purchasePrice * data.propertyTaxRate / 12 / 100;
        const monthlyMaintenance = monthlyRent * data.maintenanceRate / 100;
        const monthlyVacancy = monthlyRent * data.vacancyRate / 100;
        const monthlyManagement = monthlyRent * data.managementFeeRate / 100;
        const monthlyCapEx = monthlyRent * data.capExRate / 100;
        const monthlyUtilities = data.utilities;
        const monthlyHOA = data.hoaFees;
        const monthlyGarbage = data.garbage;
        const monthlyOther = data.otherExpenses;

        const operatingExpenses =
            monthlyMaintenance +
            monthlyVacancy +
            monthlyManagement +
            monthlyCapEx +
            monthlyUtilities +
            monthlyHOA +
            monthlyGarbage +
            monthlyOther;

        const totalExpenses =
            monthlyMortgage +
            monthlyInsurance +
            monthlyPropertyTax +
            operatingExpenses +
            monthlyPMI;

        setMonthlyResults({
            cashflow: totalIncome - totalExpenses,
            totalIncome,
            totalExpenses,
            mortgage: monthlyMortgage,
            operatingExpenses,
            taxes: monthlyPropertyTax,
            insurance: monthlyInsurance,
            pmi: monthlyPMI
        });
    };

    // Helper components for styling
    const Label = ({ children, tooltip }: { children: React.ReactNode, tooltip?: string }) => (
        <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {children}
            </label>
            {tooltip && (
                <div title={tooltip} className="cursor-help text-muted-foreground">
                    <Info className="h-4 w-4" />
                </div>
            )}
        </div>
    );

    const InputField = ({ name, label, tooltip, type = "number" }: any) => (
        <div className="space-y-1">
            <Label tooltip={tooltip}>{label}</Label>
            <input
                type={type}
                {...form.register(name, { valueAsNumber: true })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 border-gray-200 text-gray-900"
            />
        </div>
    );

    const SliderField = ({ name, label, tooltip, min, max, step }: any) => {
        const value = form.watch(name);
        return (
            <div className="space-y-3">
                <div className="flex justify-between">
                    <Label tooltip={tooltip}>{label}</Label>
                    <span className="text-sm text-muted-foreground">{value}%</span>
                </div>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    {...form.register(name, { valueAsNumber: true })}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
            </div>
        );
    };

    return (
        <Card className="bg-white border-blue-100 shadow-sm">
            <CardHeader className="bg-blue-50/30 border-b border-blue-100">
                <CardTitle className="text-blue-900 flex items-center gap-2">
                    Monthly Cashflow Calculator
                </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
                <form className="space-y-8">
                    {/* Purchase Details */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-900">Purchase Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <InputField name="purchasePrice" label="Purchase Price" tooltip="The total purchase price of the property" />
                            <InputField name="closingCosts" label="Closing Costs" tooltip="Estimated costs for closing the purchase" />
                            <InputField name="downPayment" label="Down Payment" tooltip="The initial payment you'll make" />
                        </div>
                    </div>

                    <div className="h-px bg-gray-100" />

                    {/* Loan Details */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-900">Loan Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <InputField name="loanTerm" label="Loan Term (Years)" />
                            <SliderField name="interestRate" label="Interest Rate" min={0} max={15} step={0.125} />
                            <InputField name="points" label="Points" />
                            {form.watch('downPayment') / form.watch('purchasePrice') < 0.20 && (
                                <SliderField
                                    name="pmiRate"
                                    label="PMI Rate (Down Payment < 20%)"
                                    min={0}
                                    max={2.5}
                                    step={0.1}
                                    tooltip="Private Mortgage Insurance rate (typically 0.5% - 1.5%)"
                                />
                            )}
                        </div>
                    </div>

                    <div className="h-px bg-gray-100" />

                    {/* Income & Taxes */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-900">Income & Taxes</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <InputField name="monthlyRent" label="Monthly Rent" />
                            <SliderField name="propertyTaxRate" label="Property Tax Rate" min={0} max={5} step={0.1} />
                            <InputField name="insuranceCost" label="Annual Insurance" />
                            <SliderField name="annualRentGrowth" label="Annual Rent Growth" min={0} max={10} step={0.5} />
                        </div>
                    </div>

                    <div className="h-px bg-gray-100" />

                    {/* Operating Expenses */}
                    <div className="space-y-4">
                        <h3 className="font-semibold text-gray-900">Operating Expenses</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <SliderField name="maintenanceRate" label="Maintenance" min={0} max={15} step={0.5} />
                                <SliderField name="capExRate" label="CapEx" min={0} max={15} step={0.5} />
                                <SliderField name="vacancyRate" label="Vacancy" min={0} max={15} step={0.5} />
                                <SliderField name="managementFeeRate" label="Management Fee" min={0} max={15} step={0.5} />
                            </div>
                            <div className="space-y-4">
                                <InputField name="utilities" label="Monthly Utilities" />
                                <InputField name="hoaFees" label="Monthly HOA" />
                                <InputField name="garbage" label="Monthly Garbage" />
                                <InputField name="otherExpenses" label="Other Monthly" />
                            </div>
                        </div>
                    </div>

                    {/* Results Display */}
                    <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">Income</p>
                                <p className="text-lg font-semibold text-gray-900">
                                    ${Math.round(monthlyResults.totalIncome).toLocaleString()}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">Expenses</p>
                                <p className="text-lg font-semibold text-gray-900">
                                    ${Math.round(monthlyResults.totalExpenses).toLocaleString()}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">Mortgage</p>
                                <p className="text-lg font-semibold text-gray-900">
                                    ${Math.round(monthlyResults.mortgage).toLocaleString()}
                                </p>
                                {monthlyResults.pmi > 0 && (
                                    <p className="text-xs text-red-500 mt-1">
                                        + ${Math.round(monthlyResults.pmi)} PMI
                                    </p>
                                )}
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">Cashflow</p>
                                <p className={`text-xl font-bold ${monthlyResults.cashflow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    ${Math.round(monthlyResults.cashflow).toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
