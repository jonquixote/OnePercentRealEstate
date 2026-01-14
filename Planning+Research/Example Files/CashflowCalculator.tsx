import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Property } from '@shared/schema';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
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
    property?: Property;
}

interface MonthlyResults {
    cashflow: number;
    totalIncome: number;
    totalExpenses: number;
    mortgage: number;
    operatingExpenses: number;
    taxes: number;
    insurance: number;
}

export function CashflowCalculator({ property }: CashflowCalculatorProps) {
    // Get values from property if available, otherwise use defaults
    const defaultPrice = property ? Number(property.price) : 200000;
    const defaultRent = property ? Number(property.rentEstimate) : 2000;

    const [monthlyResults, setMonthlyResults] = useState<MonthlyResults>({
        cashflow: 0,
        totalIncome: 0,
        totalExpenses: 0,
        mortgage: 0,
        operatingExpenses: 0,
        taxes: 0,
        insurance: 0
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
            insuranceCost: 1200,
            propertyTaxRate: 1.2,
            monthlyRent: defaultRent,
            annualRentGrowth: 3,
            maintenanceRate: 5,
            vacancyRate: 5,
            managementFeeRate: 8,
            capExRate: 5,
            utilities: 0,
            hoaFees: 0,
            garbage: 0,
            otherExpenses: 0
        }
    });

    // Calculate results when any input changes
    useEffect(() => {
        const subscription = form.watch((value) => {
            if (value) {
                calculateMonthlyResults(value as CalculatorInputs);
            }
        });
        return () => subscription.unsubscribe();
    }, [form.watch]);

    // Calculate initial results on mount
    useEffect(() => {
        const initialValues = form.getValues();
        calculateMonthlyResults(initialValues);
    }, []);

    const calculateMonthlyResults = (data: CalculatorInputs) => {
        // Calculate monthly mortgage payment
        const loanAmount = data.purchasePrice - data.downPayment;
        const monthlyRate = data.interestRate / 12 / 100;
        const numPayments = data.loanTerm * 12;
        const monthlyMortgage = loanAmount *
            (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
            (Math.pow(1 + monthlyRate, numPayments) - 1);

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
            operatingExpenses;

        setMonthlyResults({
            cashflow: totalIncome - totalExpenses,
            totalIncome,
            totalExpenses,
            mortgage: monthlyMortgage,
            operatingExpenses,
            taxes: monthlyPropertyTax,
            insurance: monthlyInsurance
        });
    };

    const FormTooltip = ({ content }: { content: string }) => (
        <Tooltip>
            <TooltipTrigger asChild>
                <Info className="h-4 w-4 ml-2 inline-block text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
                <p className="max-w-xs">{content}</p>
            </TooltipContent>
        </Tooltip>
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Monthly Cashflow Calculator</CardTitle>
            </CardHeader>
            <CardContent>
                <Form {...form}>
                    <form className="space-y-6">
                        {/* Purchase Details */}
                        <div className="space-y-4">
                            <h3 className="font-semibold">Purchase Details</h3>
                            <FormField
                                control={form.control}
                                name="purchasePrice"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Purchase Price
                                            <FormTooltip content="The total purchase price of the property" />
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="closingCosts"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Closing Costs
                                            <FormTooltip content="Estimated costs for closing the purchase (typically 2-5% of purchase price)" />
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="downPayment"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Down Payment
                                            <FormTooltip content="The initial payment you'll make (typically 20-25% for investment properties)" />
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Separator />

                        {/* Loan Details */}
                        <div className="space-y-4">
                            <h3 className="font-semibold">Loan Details</h3>
                            <FormField
                                control={form.control}
                                name="loanTerm"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Loan Term (Years)
                                            <FormTooltip content="Length of the mortgage loan in years" />
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="interestRate"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Interest Rate ({field.value.toFixed(2)}%)
                                            <FormTooltip content="Annual interest rate for the mortgage loan" />
                                        </FormLabel>
                                        <FormControl>
                                            <Slider
                                                value={[field.value]}
                                                onValueChange={([value]) => field.onChange(value)}
                                                min={0}
                                                max={20}
                                                step={0.1}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="points"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Points
                                            <FormTooltip content="Mortgage points purchased to lower interest rate" />
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Separator />

                        {/* Rental Income */}
                        <div className="space-y-4">
                            <h3 className="font-semibold">Rental Income</h3>
                            <FormField
                                control={form.control}
                                name="monthlyRent"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Monthly Rent
                                            <FormTooltip content="Expected monthly rental income" />
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                {...field}
                                                onChange={(e) => field.onChange(Number(e.target.value))}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="annualRentGrowth"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Annual Rent Growth ({field.value}%)
                                            <FormTooltip content="Expected yearly increase in rental income" />
                                        </FormLabel>
                                        <FormControl>
                                            <Slider
                                                value={[field.value]}
                                                onValueChange={([value]) => field.onChange(value)}
                                                min={0}
                                                max={10}
                                                step={0.5}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Separator />

                        {/* Operating Expenses */}
                        <div className="space-y-4">
                            <h3 className="font-semibold">Operating Expenses</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="maintenanceRate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Maintenance ({field.value}%)
                                                <FormTooltip content="Percentage of rent allocated for regular maintenance" />
                                            </FormLabel>
                                            <FormControl>
                                                <Slider
                                                    value={[field.value]}
                                                    onValueChange={([value]) => field.onChange(value)}
                                                    min={0}
                                                    max={15}
                                                    step={0.5}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="capExRate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>CapEx ({field.value}%)
                                                <FormTooltip content="Percentage set aside for major repairs and replacements" />
                                            </FormLabel>
                                            <FormControl>
                                                <Slider
                                                    value={[field.value]}
                                                    onValueChange={([value]) => field.onChange(value)}
                                                    min={0}
                                                    max={15}
                                                    step={0.5}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="vacancyRate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Vacancy ({field.value}%)
                                                <FormTooltip content="Expected percentage of time the property will be vacant" />
                                            </FormLabel>
                                            <FormControl>
                                                <Slider
                                                    value={[field.value]}
                                                    onValueChange={([value]) => field.onChange(value)}
                                                    min={0}
                                                    max={15}
                                                    step={0.5}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="managementFeeRate"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Property Management ({field.value}%)
                                                <FormTooltip content="Property management fee as percentage of rent" />
                                            </FormLabel>
                                            <FormControl>
                                                <Slider
                                                    value={[field.value]}
                                                    onValueChange={([value]) => field.onChange(value)}
                                                    min={0}
                                                    max={15}
                                                    step={0.5}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="utilities"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Monthly Utilities
                                                <FormTooltip content="Monthly cost of utilities if owner-paid" />
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    {...field}
                                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="hoaFees"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Monthly HOA Fees
                                                <FormTooltip content="Monthly homeowners association fees" />
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    {...field}
                                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="garbage"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Monthly Garbage Collection
                                                <FormTooltip content="Monthly cost for garbage/recycling service" />
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    {...field}
                                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="otherExpenses"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Other Monthly Expenses
                                                <FormTooltip content="Any additional monthly expenses" />
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    {...field}
                                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {/* Results Display */}
                        <div className="mt-6 p-4 bg-muted rounded-lg">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                    <p className="text-sm text-muted-foreground">Monthly Income</p>
                                    <p className="text-lg font-semibold">
                                        ${monthlyResults.totalIncome.toLocaleString()}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Monthly Expenses</p>
                                    <p className="text-lg font-semibold">
                                        ${monthlyResults.totalExpenses.toLocaleString()}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Monthly Mortgage</p>
                                    <p className="text-lg font-semibold">
                                        ${monthlyResults.mortgage.toLocaleString()}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Monthly Cashflow</p>
                                    <p className={`text-lg font-semibold ${monthlyResults.cashflow >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        ${monthlyResults.cashflow.toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}