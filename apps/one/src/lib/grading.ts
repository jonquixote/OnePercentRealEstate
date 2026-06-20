/**
 * Investment-grade scorecard for rental properties.
 *
 * Produces a letter grade (A–F) and 0–100 score from a set of underwriting
 * inputs (1% rule, cap rate, cash-on-cash, cashflow, HOA, age, sqft, DOM).
 *
 * Cap rate and cash-on-cash MUST be provided as fractions (e.g. 0.082 for
 * 8.2%) — not percentages. Null inputs are skipped (not penalized) and the
 * letter grade is rescaled against the available max so partial data doesn't
 * drag a property down.
 */

import { scoreToGrade, headlineForGrade, type Grade } from '@oper/primitives';
export type { Grade };

export interface GradeInput {
    listing_price: number | null;
    estimated_rent: number | null;
    capRate: number;        // fraction (0.082 = 8.2%)
    cashOnCash: number;     // fraction
    isOnePercentRule: boolean;
    monthlyCashflow: number;
    /** Per-type / sale-type 1% threshold (fraction). Defaults to 0.01. */
    targetRatio?: number;
    daysOnMarket?: number | null;
    hoaFee?: number | null;       // monthly HOA dollars
    taxAnnual?: number | null;
    sqft?: number | null;
    yearBuilt?: number | null;
}

export interface GradeCategory {
    label: string;
    weight: number;   // max points possible for this category
    points: number;   // points actually awarded
    summary: string;  // short human description of the result (used for pros/cons)
    available: boolean; // whether this category had data to evaluate
}

export interface GradeResult {
    grade: Grade;
    score: number;          // 0–100, scaled against available categories
    rawPoints: number;       // points actually earned
    maxPoints: number;       // max points across categories that were evaluable
    pros: string[];
    cons: string[];
    breakdown: GradeCategory[];
    headline: string;        // short investor-facing description
}

// Category weights add up to 100.
const WEIGHTS = {
    onePercent: 25,
    capRate: 20,
    cashOnCash: 20,
    cashflow: 15,
    hoa: 5,
    age: 5,
    sqft: 5,
    dom: 5,
} as const;

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function fmtPct(fraction: number): string {
    return `${(fraction * 100).toFixed(1)}%`;
}

function fmtCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(n);
}

export function gradeProperty(input: GradeInput): GradeResult {
    const categories: GradeCategory[] = [];

    // --- 1% Rule (25 pts) ---
    {
        const ratio = input.listing_price && input.listing_price > 0 && input.estimated_rent
            ? input.estimated_rent / input.listing_price
            : null;
        const target = input.targetRatio ?? 0.01;
        let pts = 0;
        let summary = 'Rent-to-price ratio unknown';
        let available = true;
        if (ratio === null) {
            available = false;
        } else if (input.isOnePercentRule || ratio >= target) {
            pts = WEIGHTS.onePercent;
            summary = `Passes the 1% rule (${fmtPct(ratio)})`;
        } else if (ratio >= target * 0.85) {
            pts = 12;
            summary = `Near the 1% rule (${fmtPct(ratio)})`;
        } else {
            pts = 0;
            summary = `Fails the 1% rule (${fmtPct(ratio)})`;
        }
        categories.push({ label: '1% Rule', weight: WEIGHTS.onePercent, points: pts, summary, available });
    }

    // --- Cap rate (20 pts) — linear 0%..10% ---
    {
        const cap = input.capRate;
        let pts = 0;
        let summary = 'Cap rate unavailable';
        let available = true;
        if (!Number.isFinite(cap) || cap === 0) {
            available = false;
        } else {
            const t = clamp(cap / 0.10, 0, 1);
            pts = Math.round(t * WEIGHTS.capRate);
            summary = `Cap rate ${fmtPct(cap)}`;
        }
        categories.push({ label: 'Cap Rate', weight: WEIGHTS.capRate, points: pts, summary, available });
    }

    // --- Cash-on-cash (20 pts) — linear 0%..15% ---
    {
        const coc = input.cashOnCash;
        let pts = 0;
        let summary = 'Cash-on-cash unavailable';
        let available = true;
        if (!Number.isFinite(coc) || coc === 0) {
            available = false;
        } else {
            const t = clamp(coc / 0.15, 0, 1);
            pts = Math.round(t * WEIGHTS.cashOnCash);
            summary = `Cash-on-cash ${fmtPct(coc)}`;
        }
        categories.push({ label: 'Cash-on-Cash', weight: WEIGHTS.cashOnCash, points: pts, summary, available });
    }

    // --- Monthly cashflow (15 pts) ---
    {
        const cf = input.monthlyCashflow;
        let pts = 0;
        let summary = 'Cashflow unknown';
        let available = true;
        if (!Number.isFinite(cf)) {
            available = false;
        } else if (cf >= 200) {
            pts = WEIGHTS.cashflow;
            summary = `Strong positive cashflow (${fmtCurrency(cf)}/mo)`;
        } else if (cf > 0) {
            // partial credit for thin positive
            pts = 10;
            summary = `Thin positive cashflow (${fmtCurrency(cf)}/mo)`;
        } else if (cf === 0) {
            pts = 4; // small partial for breakeven
            summary = 'Breakeven cashflow';
        } else {
            pts = 0;
            summary = `Negative cashflow (${fmtCurrency(cf)}/mo)`;
        }
        categories.push({ label: 'Cashflow', weight: WEIGHTS.cashflow, points: pts, summary, available });
    }

    // --- HOA reasonableness (5 pts) ---
    {
        const hoa = input.hoaFee;
        const rent = input.estimated_rent;
        let pts: number = WEIGHTS.hoa;
        let summary = 'No HOA dues';
        let available = true;
        if (hoa === null || hoa === undefined) {
            // Treat missing HOA as no HOA — full points.
            pts = WEIGHTS.hoa;
            summary = 'No HOA dues';
        } else if (hoa === 0) {
            pts = WEIGHTS.hoa;
            summary = 'No HOA dues';
        } else if (!rent || rent <= 0) {
            available = false;
            pts = 0;
            summary = 'HOA impact unknown (no rent)';
        } else {
            const ratio = hoa / rent;
            if (ratio < 0.10) {
                pts = WEIGHTS.hoa;
                summary = `Reasonable HOA (${fmtCurrency(hoa)}/mo, ${fmtPct(ratio)} of rent)`;
            } else if (ratio <= 0.20) {
                pts = 2;
                summary = `Elevated HOA (${fmtCurrency(hoa)}/mo, ${fmtPct(ratio)} of rent)`;
            } else {
                pts = 0;
                summary = `High HOA drag (${fmtCurrency(hoa)}/mo, ${fmtPct(ratio)} of rent)`;
            }
        }
        categories.push({ label: 'HOA', weight: WEIGHTS.hoa, points: pts, summary, available });
    }

    // --- Age (5 pts) ---
    {
        const yb = input.yearBuilt;
        let pts = 0;
        let summary = 'Year built unknown';
        let available = true;
        if (!yb || yb <= 0) {
            available = false;
        } else {
            const age = new Date().getFullYear() - yb;
            if (age <= 30) {
                pts = WEIGHTS.age;
                summary = `Newer construction (built ${yb})`;
            } else if (age <= 60) {
                pts = 3;
                summary = `Mid-age home (built ${yb})`;
            } else {
                pts = 1;
                summary = `Older home (built ${yb})`;
            }
        }
        categories.push({ label: 'Age', weight: WEIGHTS.age, points: pts, summary, available });
    }

    // --- Sqft sanity (5 pts) ---
    {
        const sqft = input.sqft;
        let pts = 0;
        let summary = 'Square footage unknown';
        let available = true;
        if (!sqft || sqft <= 0) {
            available = false;
        } else if (sqft >= 800) {
            pts = WEIGHTS.sqft;
            summary = `Healthy size (${sqft.toLocaleString()} sqft)`;
        } else {
            pts = 2;
            summary = `Small footprint (${sqft.toLocaleString()} sqft)`;
        }
        categories.push({ label: 'Size', weight: WEIGHTS.sqft, points: pts, summary, available });
    }

    // --- Days on market (5 pts) ---
    {
        const dom = input.daysOnMarket;
        let pts = 0;
        let summary = 'Days on market unknown';
        let available = true;
        if (dom === null || dom === undefined || dom < 0) {
            available = false;
        } else if (dom < 14) {
            pts = WEIGHTS.dom;
            summary = `Fresh listing (${dom} days on market)`;
        } else if (dom <= 60) {
            pts = 3;
            summary = `Standard market time (${dom} days on market)`;
        } else {
            pts = 0;
            summary = `Stale listing (${dom} days on market)`;
        }
        categories.push({ label: 'Days on Market', weight: WEIGHTS.dom, points: pts, summary, available });
    }

    const evaluable = categories.filter((c) => c.available);
    const rawPoints = evaluable.reduce((acc, c) => acc + c.points, 0);
    const maxPoints = evaluable.reduce((acc, c) => acc + c.weight, 0);
    const score = maxPoints > 0 ? Math.round((rawPoints / maxPoints) * 100) : 0;
    const grade = scoreToGrade(score);

    const pros: string[] = [];
    const cons: string[] = [];
    for (const c of categories) {
        if (!c.available) continue;
        if (c.points >= c.weight) {
            pros.push(c.summary);
        } else if (c.points === 0) {
            cons.push(c.summary);
        }
    }

    return {
        grade,
        score,
        rawPoints,
        maxPoints,
        pros,
        cons,
        breakdown: categories,
        headline: headlineForGrade(grade),
    };
}
