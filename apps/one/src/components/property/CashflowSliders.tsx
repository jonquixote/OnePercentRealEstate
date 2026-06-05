'use client';

import { useState, useMemo } from 'react';
import { Slider } from '@radix-ui/react-slider';
import { Button } from '@oper/primitives';

interface CashflowSlidersProps {
  listingPrice: number;
  estimatedRent: number;
}

export function CashflowSliders({
  listingPrice,
  estimatedRent,
}: CashflowSlidersProps) {
  const price = listingPrice || 200000;
  const rent = estimatedRent || 2000;

  // Local state for sliders
  const [downPct, setDownPct] = useState(0.2);
  const [ratePct, setRatePct] = useState(0.065);
  const [years, setYears] = useState(30);
  const [vacancyPct, setVacancyPct] = useState(0.05);
  const [capexPct, setCapexPct] = useState(0.05);
  const [mgmtPct, setMgmtPct] = useState(0.08);

  // Fixed expenses
  const taxAnnual = price * 0.012;
  const insuranceAnnual = 1200;
  const hoaMonthly = 0;

  // Calculations
  const loanAmount = price * (1 - downPct);
  const r = ratePct;
  const n = years * 12;
  const monthlyRate = r / 12;
  const monthlyPayment =
    n > 0
      ? (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n))
      : 0;

  const effectiveRent = rent * (1 - vacancyPct);
  const operatingExpenses = rent * (capexPct + mgmtPct);
  const monthlyCashflow =
    effectiveRent -
    monthlyPayment -
    taxAnnual / 12 -
    insuranceAnnual / 12 -
    hoaMonthly -
    operatingExpenses / 12;

  const cashOnCash =
    price * downPct > 0
      ? ((monthlyCashflow * 12) / (price * downPct)) * 100
      : 0;

  // Scenario helpers
  const setScenario = (scenario: 'cash' | 'conservative' | 'aggressive') => {
    switch (scenario) {
      case 'cash':
        setDownPct(1);
        setRatePct(0);
        break;
      case 'conservative':
        setDownPct(0.25);
        setRatePct(0.07);
        setVacancyPct(0.08);
        break;
      case 'aggressive':
        setDownPct(0.1);
        setRatePct(0.06);
        setVacancyPct(0.03);
        break;
    }
  };

  return (
    <div className="space-y-6">
      {/* Scenario chips */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setScenario('cash')}
          className="text-xs"
        >
          Cash
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setScenario('conservative')}
          className="text-xs"
        >
          Conservative
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setScenario('aggressive')}
          className="text-xs"
        >
          Aggressive
        </Button>
      </div>

      {/* Sliders grid */}
      <div className="grid grid-cols-2 gap-8">
        {/* Down Payment % */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <label className="text-sm font-medium text-gray-700">
              Down Payment
            </label>
            <span className="font-mono text-sm text-gray-900 text-right tabular-nums">
              {(downPct * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[downPct]}
            onValueChange={(vals) => setDownPct(vals[0])}
            min={0}
            max={1}
            step={0.01}
            className="w-full"
          />
        </div>

        {/* Interest Rate % */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <label className="text-sm font-medium text-gray-700">
              Interest Rate
            </label>
            <span className="font-mono text-sm text-gray-900 text-right tabular-nums">
              {(ratePct * 100).toFixed(2)}%
            </span>
          </div>
          <Slider
            value={[ratePct]}
            onValueChange={(vals) => setRatePct(vals[0])}
            min={0}
            max={0.12}
            step={0.001}
            className="w-full"
          />
        </div>

        {/* Loan Years */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <label className="text-sm font-medium text-gray-700">
              Loan Term
            </label>
            <span className="font-mono text-sm text-gray-900 text-right tabular-nums">
              {years} years
            </span>
          </div>
          <Slider
            value={[years]}
            onValueChange={(vals) => setYears(vals[0])}
            min={1}
            max={40}
            step={1}
            className="w-full"
          />
        </div>

        {/* Vacancy % */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <label className="text-sm font-medium text-gray-700">
              Vacancy Rate
            </label>
            <span className="font-mono text-sm text-gray-900 text-right tabular-nums">
              {(vacancyPct * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[vacancyPct]}
            onValueChange={(vals) => setVacancyPct(vals[0])}
            min={0}
            max={0.2}
            step={0.01}
            className="w-full"
          />
        </div>

        {/* CapEx % */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <label className="text-sm font-medium text-gray-700">
              CapEx
            </label>
            <span className="font-mono text-sm text-gray-900 text-right tabular-nums">
              {(capexPct * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[capexPct]}
            onValueChange={(vals) => setCapexPct(vals[0])}
            min={0}
            max={0.15}
            step={0.01}
            className="w-full"
          />
        </div>

        {/* Management % */}
        <div className="space-y-3">
          <div className="flex justify-between items-baseline">
            <label className="text-sm font-medium text-gray-700">
              Management
            </label>
            <span className="font-mono text-sm text-gray-900 text-right tabular-nums">
              {(mgmtPct * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[mgmtPct]}
            onValueChange={(vals) => setMgmtPct(vals[0])}
            min={0}
            max={0.15}
            step={0.01}
            className="w-full"
          />
        </div>
      </div>

      {/* Metrics card */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
        <div className="grid grid-cols-2 gap-6 text-center">
          <div>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">
              Monthly Cashflow
            </p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums ${
                monthlyCashflow >= 0 ? 'text-green-600' : 'text-rose-600'
              }`}
            >
              ${Math.round(monthlyCashflow).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">
              Cash-on-Cash
            </p>
            <p className="text-2xl font-bold font-mono tabular-nums text-gray-900">
              {cashOnCash.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
