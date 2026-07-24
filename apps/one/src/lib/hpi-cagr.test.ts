import { describe, it, expect } from 'vitest';
import {
  computeHpiCagr,
  HPI_MAX_CAGR,
  HPI_MIN_SPAN_YEARS,
} from './hpi-cagr';

describe('computeHpiCagr', () => {
  it('computes CAGR for a clean 10-yr level series (100 → 180)', () => {
    const series = Array.from({ length: 11 }, (_, i) => ({
      year: 2015 + i,
      hpi: 100 * Math.pow(1.8, i / 10),
    }));
    const result = computeHpiCagr(series);
    expect(result).not.toBeNull();
    expect(result!.cagrPct).toBeCloseTo(6.054, 2);
    expect(result!.spanYears).toBe(10);
  });

  it('returns null when annualized CAGR exceeds HPI_MAX_CAGR (sparse outlier 100 → 496 in 1 yr)', () => {
    const series = [
      { year: 2024, hpi: 100 },
      { year: 2025, hpi: 496 },
    ];
    const result = computeHpiCagr(series);
    expect(HPI_MAX_CAGR).toBe(25);
    expect(result).toBeNull();
  });

  it('returns null for fewer than 2 points or non-positive starting HPI', () => {
    expect(computeHpiCagr([])).toBeNull();
    expect(computeHpiCagr([{ year: 2024, hpi: 100 }])).toBeNull();
    expect(
      computeHpiCagr([
        { year: 2020, hpi: 0 },
        { year: 2025, hpi: 150 },
      ]),
    ).toBeNull();
    expect(
      computeHpiCagr([
        { year: 2020, hpi: -10 },
        { year: 2025, hpi: 150 },
      ]),
    ).toBeNull();
  });

  it('returns null when the span is shorter than HPI_MIN_SPAN_YEARS', () => {
    expect(HPI_MIN_SPAN_YEARS).toBe(3);
    const series = [
      { year: 2023, hpi: 100 },
      { year: 2025, hpi: 120 },
    ];
    expect(computeHpiCagr(series)).toBeNull();
  });

  it('returns null when |cagr| exceeds HPI_MAX_CAGR (severe deflation guard)', () => {
    const series = [
      { year: 2015, hpi: 1000 },
      { year: 2025, hpi: 50 },
    ];
    const result = computeHpiCagr(series);
    expect(result).toBeNull();
  });
  it('returns null for negative/zero/NaN terminal HPI (not just first)', () => {
    const valid = [
      { year: 2020, hpi: 100 },
      { year: 2025, hpi: 120 },
    ];
    expect(computeHpiCagr(valid)).not.toBeNull();
    expect(computeHpiCagr([...valid, { year: 2026, hpi: -5 }])).toBeNull();
    expect(computeHpiCagr([...valid, { year: 2026, hpi: 0 }])).toBeNull();
    expect(computeHpiCagr([...valid, { year: 2026, hpi: Number.NaN }])).toBeNull();
  });

  it('orders input by year ascending internally before computing', () => {
    const series = [
      { year: 2025, hpi: 180 },
      { year: 2020, hpi: 100 },
      { year: 2023, hpi: 140 },
    ];
    const result = computeHpiCagr(series);
    expect(result).not.toBeNull();
    expect(result!.cagrPct).toBeCloseTo(12.45, 1);
    expect(result!.spanYears).toBe(5);
  });

  it('returns spanYears alongside cagrPct so the UI can label it truthfully', () => {
    const series = [
      { year: 2014, hpi: 100 },
      { year: 2024, hpi: 215 },
    ];
    const result = computeHpiCagr(series);
    expect(result).toEqual(
      expect.objectContaining({ cagrPct: expect.any(Number), spanYears: 10 }),
    );
    expect(result!.spanYears).toBe(10);
  });
});
