export const HPI_MAX_CAGR = 25;
export const HPI_MIN_SPAN_YEARS = 3;

export function computeHpiCagr(
  series: { year: number; hpi: number }[],
): { cagrPct: number; spanYears: number } | null {
  if (series.length < 2) return null;

  const sorted = [...series].sort((a, b) => a.year - b.year);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (first.hpi <= 0) return null;

  const spanYears = last.year - first.year;
  if (spanYears < HPI_MIN_SPAN_YEARS) return null;

  const cagrRatio = Math.pow(last.hpi / first.hpi, 1 / spanYears) - 1;
  const cagrPct = cagrRatio * 100;
  if (Math.abs(cagrPct) > HPI_MAX_CAGR) return null;

  return { cagrPct, spanYears };
}
