'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, X, Award, Bookmark, GitCompare, FileDown } from 'lucide-react';
import {
    Button,
    resolveRuleFrom,
    evaluateRules,
    resolveCosts,
    type RuleConfig,
    type PropertyInputs,
    type Strategy,
    type SaleType,
    type Grade,
    type RealCosts,
} from '@oper/primitives';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const STRATEGIES: Strategy[] = ['buy_hold', 'brrrr', 'flip', 'str'];

const STRATEGY_LABELS: Record<string, string> = {
    buy_hold: 'Buy & Hold',
    brrrr: 'BRRRR',
    flip: 'Fix & Flip',
    str: 'Short-Term Rental',
};

interface PropertyScorecardTabProps {
    property: any;
}

const GRADE_RING: Record<Grade, string> = {
    A: 'bg-emerald-500 text-white ring-emerald-200',
    B: 'bg-sky-500 text-white ring-sky-200',
    C: 'bg-amber-500 text-white ring-amber-200',
    D: 'bg-orange-500 text-white ring-orange-200',
    F: 'bg-rose-500 text-white ring-rose-200',
};

const GRADE_BAR: Record<Grade, string> = {
    A: 'bg-emerald-500',
    B: 'bg-sky-500',
    C: 'bg-amber-500',
    D: 'bg-orange-500',
    F: 'bg-rose-500',
};

const GRADE_TEXT: Record<Grade, string> = {
    A: 'text-emerald-600',
    B: 'text-sky-600',
    C: 'text-amber-600',
    D: 'text-orange-600',
    F: 'text-rose-600',
};

function computeDaysOnMarket(property: any): number | null {
    const raw = property?.raw_data || {};
    const candidate: string | undefined = raw.list_date || raw.listed_date || property?.created_at;
    if (!candidate) return null;
    const t = Date.parse(candidate);
    if (Number.isNaN(t)) return null;
    const diffMs = Date.now() - t;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return days < 0 ? 0 : days;
}

function fmtByRule(rule: string, v: number): string {
    if (rule === 'grm' || rule === 'price_to_rent') return `${v.toFixed(1)}×`;
    if (rule === 'dscr') return v.toFixed(2);
    if (rule === 'seventy_rule' || rule === 'brrrr_recycle')
        return `$${Math.round(v).toLocaleString()}`;
    return `${(v * 100).toFixed(2)}%`;
}
function formatRuleValue(r: { rule: string; value: number | null }): string {
    return r.value != null ? fmtByRule(r.rule, r.value) : '—';
}
function formatRuleThreshold(r: { rule: string; threshold: number | null }): string {
    return r.threshold != null ? fmtByRule(r.rule, r.threshold) : '—';
}

export function PropertyScorecardTab({ property }: PropertyScorecardTabProps) {
    const { showToast, ToastView } = useToast();

    const listing_price = Number(property?.listing_price ?? 0);
    const estimated_rent = Number(property?.estimated_rent ?? 0);
    const rawData = property?.raw_data || {};
    const fin = property?.financial_snapshot || {};

    // Underwrite this property for a chosen strategy against the single source of
    // truth (resolve_rule → evaluateRules). The grade, the per-rule pass/fail
    // breakdown, and the provisional flag all derive from ONE evaluation.
    const [strategy, setStrategy] = useState<Strategy>('buy_hold');
    const [rules, setRules] = useState<RuleConfig[] | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetch('/api/underwriting-rules', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((rows: RuleConfig[]) => {
                if (!cancelled) setRules(rows);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const [liveRatePct, setLiveRatePct] = useState<number | null>(null);
    useEffect(() => {
        let cancelled = false;
        fetch('/api/mortgage-rates', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((data) => {
                if (!cancelled && data?.rate) setLiveRatePct(data.rate);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const propType: string | null =
        property?.property_type ?? rawData?.style ?? rawData?.property_type ?? null;
    const saleType = (property?.sale_type ?? 'standard') as SaleType;

    const num = (v: unknown): number | null => (v != null && v !== '' ? Number(v) : null);
    const inputs: PropertyInputs = {
        price: listing_price,
        monthlyRent: estimated_rent,
        sqft: num(fin?.sqft ?? rawData?.sqft),
        hoaMonthly: num(property?.hoa_fee ?? rawData?.hoa_fee),
        yearBuilt: num(fin?.year_built ?? rawData?.year_built),
        daysOnMarket: computeDaysOnMarket(property),
        arv: num(property?.estimated_value),
        taxAnnualAmount: num(property?.tax_annual_amount),
        assessedValue: num(property?.assessed_value),
    };

    const cfg = useMemo(
        () => (rules ? resolveRuleFrom(rules, { propertyType: propType, saleType, strategy }) : null),
        [rules, propType, saleType, strategy]
    );
    const cfgWithRate = useMemo(
        () => (cfg && liveRatePct ? { ...cfg, interestRate: liveRatePct / 100 } : cfg),
        [cfg, liveRatePct]
    );
    const realCosts: RealCosts | null = useMemo(
        () => cfgWithRate && inputs.price > 0
            ? resolveCosts(
                inputs.price,
                inputs.taxAnnualAmount,
                inputs.hoaMonthly,
                cfgWithRate,
                num(property?.insurance_state_avg),
                inputs.assessedValue,
            )
            : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cfgWithRate, inputs.price, inputs.taxAnnualAmount, inputs.hoaMonthly, inputs.assessedValue, property?.insurance_state_avg]
    );
    const evaluation = useMemo(
        () => (cfgWithRate ? evaluateRules(inputs, cfgWithRate, { propertyType: propType, saleType }) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cfgWithRate, listing_price, estimated_rent, inputs.sqft, inputs.hoaMonthly, inputs.yearBuilt, inputs.daysOnMarket, inputs.arv]
    );

    const compareHref = `/compare?ids=${encodeURIComponent(property?.id ?? '')}`;

    const strategyChips = (
        <div className="flex flex-wrap gap-2">
            {STRATEGIES.map((s) => (
                <button
                    key={s}
                    onClick={() => setStrategy(s)}
                    className={cn(
                        'rounded-full border px-3.5 py-1.5 font-mono text-[11px] font-medium transition-colors',
                        strategy === s
                            ? 'border-pass bg-pass/15 text-pass-hi'
                            : 'border-line bg-white/[0.03] text-haze hover:bg-white/[0.06]'
                    )}
                >
                    {STRATEGY_LABELS[s] ?? s}
                </button>
            ))}
        </div>
    );

    // Rules not loaded yet → skeleton.
    if (!evaluation) {
        return (
            <div id="tabpanel-scorecard" role="tabpanel" aria-labelledby="tab-scorecard" className="space-y-6">
                <div className="flex justify-between">{strategyChips}</div>
                <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />
                <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
            </div>
        );
    }

    // Strategy lacks the inputs to grade meaningfully (STR with no revenue
    // signal, flip with no ARV) → honest "insufficient data" instead of a hard F.
    if (!evaluation.gradable || !evaluation.grade) {
        return (
            <div id="tabpanel-scorecard" role="tabpanel" aria-labelledby="tab-scorecard" className="space-y-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">Underwrite as</p>
                    {strategyChips}
                </div>
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                        <Award className="h-8 w-8 text-gray-300" />
                        <p className="text-lg font-semibold text-gray-900">
                            Not enough data to grade {STRATEGY_LABELS[strategy] ?? strategy}
                        </p>
                        <p className="max-w-md text-sm text-gray-500">
                            {evaluation.gradableReason ?? 'Insufficient inputs for this strategy.'}
                        </p>
                        {evaluation.isProvisional && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-700">
                                provisional assumptions
                            </span>
                        )}
                    </CardContent>
                </Card>
            </div>
        );
    }

    const grade = {
        grade: evaluation.grade,
        score: evaluation.score ?? 0,
        headline: evaluation.headline ?? '',
        breakdown: evaluation.breakdown,
        pros: evaluation.pros,
        cons: evaluation.cons,
    };
    const featured = [...grade.breakdown]
        .filter((c) => c.available)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3);

    return (
        <div
            id="tabpanel-scorecard"
            role="tabpanel"
            aria-labelledby="tab-scorecard"
            className="space-y-8 animate-in fade-in duration-300"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">
                    Underwrite as
                </p>
                {strategyChips}
            </div>

            <Card className="overflow-hidden">
                <CardContent className="p-8 sm:p-10">
                    <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:text-left">
                        <div
                            className={cn(
                                'flex h-32 w-32 shrink-0 items-center justify-center rounded-full shadow-lg ring-8 ring-offset-2',
                                GRADE_RING[grade.grade]
                            )}
                            aria-label={`Investment grade ${grade.grade}`}
                        >
                            <span className="font-black tracking-tight text-7xl sm:text-7xl leading-none">
                                {grade.grade}
                            </span>
                        </div>
                        <div className="flex-1 space-y-3">
                            <div className="flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 sm:justify-start">
                                <Award className="h-4 w-4" />
                                Investment Grade
                            </div>
                            <div className="flex items-baseline justify-center gap-3 sm:justify-start">
                                <span className={cn('text-5xl font-black tracking-tight', GRADE_TEXT[grade.grade])}>
                                    {grade.score}
                                </span>
                                <span className="text-2xl font-semibold text-gray-400">/ 100</span>
                            </div>
                            <p className="text-lg text-gray-600">{grade.headline}</p>
                            {cfg && (
                                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-600">
                                        {STRATEGY_LABELS[cfg.strategy] ?? cfg.strategy}
                                        {cfg.targetRatio != null
                                            ? ` · ${(cfg.targetRatio * 100).toFixed(2)}% rule`
                                            : ''}
                                    </span>
                                    {cfg.isProvisional && (
                                        <span
                                            className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-700"
                                            title="This strategy uses provisional assumptions (no high-confidence signal yet)."
                                        >
                                            provisional assumptions
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="mt-3 w-full max-w-md">
                                <div
                                    className="h-2 w-full overflow-hidden rounded-full bg-gray-100"
                                    role="progressbar"
                                    aria-valuenow={grade.score}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label="Score out of 100"
                                >
                                    <div
                                        className={cn('h-full rounded-full transition-all', GRADE_BAR[grade.grade])}
                                        style={{ width: `${Math.max(2, grade.score)}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    {realCosts && (
                        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                            <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
                                Costs
                            </span>
                            <span
                                className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
                                    realCosts.provenance.tax.source === 'real_tax'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                )}
                                title={realCosts.provenance.tax.detail}
                            >
                                Tax: {realCosts.provenance.tax.source === 'real_tax' ? 'actual' : 'estimated'}
                            </span>
                            <span
                                className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
                                    realCosts.provenance.hoa.source === 'real_hoa'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-gray-100 text-gray-500'
                                )}
                                title={realCosts.provenance.hoa.detail}
                            >
                                HOA: {realCosts.provenance.hoa.source === 'real_hoa' ? 'actual' : 'none'}
                            </span>
                            <span
                                className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
                                    realCosts.provenance.insurance.source === 'state_insurance'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                )}
                                title={realCosts.provenance.insurance.detail}
                            >
                                Ins: {realCosts.provenance.insurance.source === 'state_insurance' ? 'state avg' : 'default'}
                            </span>
                            {liveRatePct && (
                                <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-700"
                                    title={`Live FRED 30yr mortgage rate: ${liveRatePct}%`}>
                                    Rate: {liveRatePct}%
                                </span>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {featured.length > 0 && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {featured.map((cat) => (
                        <Card key={cat.label}>
                            <CardContent className="p-5">
                                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    {cat.label}
                                </p>
                                <p className="mt-2 text-base font-semibold text-gray-900">{cat.summary}</p>
                                <div className="mt-3 flex items-center justify-between">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                                        <div
                                            className={cn('h-full', GRADE_BAR[grade.grade])}
                                            style={{ width: `${(cat.points / cat.weight) * 100}%` }}
                                        />
                                    </div>
                                    <span className="ml-3 text-xs font-mono text-gray-500">
                                        {cat.points}/{cat.weight}
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                    <CardContent className="p-6">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Strengths</h3>
                        {grade.pros.length > 0 ? (
                            <ul className="space-y-3">
                                {grade.pros.map((pro, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                            <Check className="h-3.5 w-3.5" />
                                        </span>
                                        <span className="text-sm font-medium text-emerald-900">{pro}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-gray-500">
                                No category earned full marks. See the breakdown below.
                            </p>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-6">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Watch out for</h3>
                        {grade.cons.length > 0 ? (
                            <ul className="space-y-3">
                                {grade.cons.map((con, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                                            <X className="h-3.5 w-3.5" />
                                        </span>
                                        <span className="text-sm font-medium text-rose-900">{con}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-gray-500">No major red flags detected.</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className="p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900">Full breakdown</h3>
                    <ul className="divide-y divide-gray-100">
                        {grade.breakdown.map((cat) => (
                            <li key={cat.label} className="flex items-center justify-between gap-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900">{cat.label}</p>
                                    <p className="truncate text-xs text-gray-500">
                                        {cat.available ? cat.summary : 'Insufficient data'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100 sm:w-32">
                                        <div
                                            className={cn(
                                                'h-full',
                                                cat.available ? GRADE_BAR[grade.grade] : 'bg-gray-300'
                                            )}
                                            style={{
                                                width: `${cat.available ? (cat.points / cat.weight) * 100 : 0}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="w-12 text-right font-mono text-xs text-gray-600">
                                        {cat.available ? `${cat.points}/${cat.weight}` : `–/${cat.weight}`}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-lg font-semibold text-gray-900">
                            {STRATEGY_LABELS[strategy] ?? strategy} rule checklist
                        </h3>
                        <span className="font-mono text-xs text-gray-500">
                            {evaluation.passedRules}/{evaluation.applicableRules} cleared
                        </span>
                    </div>
                    {evaluation.rules.length > 0 ? (
                        <ul className="divide-y divide-gray-100">
                            {evaluation.rules.map((r) => (
                                <li key={r.rule} className="flex items-center justify-between gap-4 py-3">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <span
                                            className={cn(
                                                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                                                !r.available
                                                    ? 'bg-gray-100 text-gray-400'
                                                    : r.passes
                                                      ? 'bg-emerald-100 text-emerald-700'
                                                      : 'bg-rose-100 text-rose-700'
                                            )}
                                        >
                                            {!r.available ? '–' : r.passes ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                                        </span>
                                        <span className="truncate text-sm font-medium text-gray-900">{r.label}</span>
                                    </div>
                                    <span className="shrink-0 font-mono text-xs text-gray-500">
                                        {r.available && r.value != null && r.threshold != null
                                            ? `${formatRuleValue(r)} ${r.comparator === 'gte' ? '≥' : '≤'} ${formatRuleThreshold(r)}`
                                            : 'no data'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-500">No rules evaluated for this strategy.</p>
                    )}
                    {evaluation.isProvisional && (
                        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            This strategy uses provisional assumptions — treat the result as directional.
                        </p>
                    )}
                </CardContent>
            </Card>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button
                    variant="default"
                    onClick={() => showToast('Watchlist coming soon — saved locally for now.')}
                >
                    <Bookmark className="h-4 w-4" />
                    Add to watchlist
                </Button>
                <Button variant="outline" asChild>
                    <Link href={compareHref}>
                        <GitCompare className="h-4 w-4" />
                        Compare
                    </Link>
                </Button>
                <Button
                    variant="outline"
                    onClick={() => showToast('PDF export is available from the top-right action bar.')}
                >
                    <FileDown className="h-4 w-4" />
                    Export PDF
                </Button>
            </div>
            {ToastView}
        </div>
    );
}
