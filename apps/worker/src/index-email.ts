export interface IndexEmailRow {
  metroLabel: string;
  pctClearing: number;
  rank: number;
}

// Pure HTML builder for the monthly "State of the 1% Rule" email.
// Reuses the same HTML-escape discipline as digest.ts (escHtml is applied by caller
// for the rows; this function builds the table from already-escaped inputs).
export function indexEmailHtml(
  rows: IndexEmailRow[],
  asOf: string,
  unsubUrl: string,
  indexUrl: string,
): string {
  const items = rows
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td>${r.rank}</td><td>${r.metroLabel}</td><td style="text-align:right">${Math.round(
          r.pctClearing * 100,
        )}%</td></tr>`,
    )
    .join('');
  return `<h2>The 1% Rule Index — ${asOf}</h2>
    <p style="color:#374151">Where the 1% rule still clears, by metro. Updated monthly.</p>
    <table style="border-collapse:collapse;width:100%">${items}</table>
    <p><a href="${indexUrl}">See the full index →</a></p>
    <p style="color:#6b7280;font-size:12px"><a href="${unsubUrl}">Unsubscribe from the 1% Rule Index</a></p>`;
}
