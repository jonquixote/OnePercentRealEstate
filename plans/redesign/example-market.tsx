/**
 * REDESIGN EXAMPLE — Market page /market/[zipcode] ("the area statement")
 * Self-contained, mock data, not wired.
 *
 * What changes vs today:
 *  - Powered by the tables that actually have data now: hud_safmr (FMR by
 *    bedroom), zcta_demographics (ACS), listings aggregates, sold_listings,
 *    price-cut counts. market_benchmarks (1 dead row) is never read again.
 *  - "Rent vs HUD FMR" becomes the page's signature chart: engraved bars,
 *    model median vs FMR per bedroom count.
 *  - FRED trend strip at the bottom (the working /api/mortgage-rates).
 */

const M = {
  zip: '44113', place: 'Tremont · Cleveland, OH',
  listings: 214, clearing: 61, cuts: 18, medPrice: 97_500,
  acs: { income: 46_300, medRent: 1_050, homeValue: 98_400, population: 19_800, vacancy: 0.11, year: 2024 },
  fmrVsModel: [
    { br: 'Studio', fmr: 820, model: 780 },
    { br: '1 BR', fmr: 940, model: 985 },
    { br: '2 BR', fmr: 1_120, model: 1_190 },
    { br: '3 BR', fmr: 1_420, model: 1_460 },
    { br: '4 BR', fmr: 1_710, model: 1_640 },
  ],
  sold90d: { count: 42, medPpsf: 84 },
  flood: 'Relatively Low',
};

const money = (n: number) => `$${n.toLocaleString()}`;
const MAX = 1_800;

export default function ExampleMarket() {
  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div className="mx-auto max-w-5xl px-6 py-14">

        {/* ── Masthead ──────────────────────────────────────────────────── */}
        <header className="pb-10" style={{ borderBottom: '1px solid var(--line)' }}>
          <p className="prov mb-4 inline-block">market statement · {M.zip}</p>
          <h1 style={{ font: `400 var(--display-1)/1.05 var(--font-display)` }}>{M.place}</h1>
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
            <span><b className="figure" style={{ color: 'var(--text)' }}>{M.listings}</b> active listings</span>
            <span><b className="figure" style={{ color: 'var(--pass-hi)' }}>{M.clearing}</b> clear the line</span>
            <span><b className="figure" style={{ color: 'var(--brass-hi)' }}>{M.cuts}</b> price cuts</span>
            <span><b className="figure" style={{ color: 'var(--text)' }}>{money(M.medPrice)}</b> median ask</span>
          </div>
        </header>

        {/* ── Signature chart: model rent vs HUD FMR, per bedroom ───────── */}
        <section className="py-14" style={{ borderBottom: '1px solid var(--line)' }}>
          <h2 className="prov mb-8 inline-block">modeled rent vs HUD fair market rent</h2>
          <div className="space-y-6">
            {M.fmrVsModel.map((r) => (
              <div key={r.br} className="grid grid-cols-[64px_1fr] items-center gap-4">
                <span className="text-[13px]" style={{ color: 'var(--haze)' }}>{r.br}</span>
                <div className="relative h-8">
                  {/* FMR: hairline reference bar */}
                  <div className="absolute top-1 h-2 rounded-full"
                       style={{ width: `${(r.fmr / MAX) * 100}%`, background: 'var(--line-hi)' }} />
                  {/* Model: emerald engraved bar */}
                  <div className="absolute bottom-1 h-2 rounded-full"
                       style={{ width: `${(r.model / MAX) * 100}%`, background: 'var(--pass)' }} />
                  <span className="figure absolute -top-0.5 text-[11px]"
                        style={{ left: `calc(${(r.fmr / MAX) * 100}% + 8px)`, color: 'var(--mute)' }}>
                    FMR {money(r.fmr)}
                  </span>
                  <span className="figure absolute -bottom-0.5 text-[11px]"
                        style={{ left: `calc(${(r.model / MAX) * 100}% + 8px)`, color: 'var(--pass-hi)' }}>
                    {money(r.model)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[12px]" style={{ color: 'var(--mute)' }}>
            Model = OnePercent v1 median for this ZIP. FMR = HUD SAFMR FY2026. Where the emerald
            bar clears the reference, the market rents above the federal floor.
          </p>
        </section>

        {/* ── ACS strip: the census speaks quietly ───────────────────────── */}
        <section className="grid grid-cols-2 gap-y-8 py-14 md:grid-cols-4" style={{ borderBottom: '1px solid var(--line)' }}>
          {[
            ['Median household income', money(M.acs.income)],
            ['Median area rent', `${money(M.acs.medRent)}/mo`],
            ['Median home value', money(M.acs.homeValue)],
            ['Population', M.acs.population.toLocaleString()],
          ].map(([k, v]) => (
            <div key={k as string}>
              <p className="figure text-[24px]">{v}</p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>{k}</p>
            </div>
          ))}
          <p className="prov col-span-full">american community survey {M.acs.year} · vacancy {(M.acs.vacancy * 100).toFixed(0)}% · flood risk {M.flood} (FEMA NRI)</p>
        </section>

        {/* ── Sold market truth (Track B) ────────────────────────────────── */}
        <section className="flex flex-wrap items-baseline gap-x-12 gap-y-4 py-14">
          <div>
            <p className="figure text-[24px]">{M.sold90d.count}</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>closed sales · 90 days</p>
          </div>
          <div>
            <p className="figure text-[24px]">${M.sold90d.medPpsf}<span className="text-[14px]">/sqft</span></p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>median sold $/sqft</p>
          </div>
          <a className="ml-auto text-[13px]" style={{ color: 'var(--pass-hi)' }}>
            Browse the {M.listings} listings in {M.zip} →
          </a>
        </section>
      </div>
    </div>
  );
}
