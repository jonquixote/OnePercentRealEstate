/**
 * REDESIGN EXAMPLE — Property detail ("the dossier")
 * Self-contained, mock data, not wired.
 *
 * What changes vs today:
 *  - Tabs die. One scrolling dossier with a sticky FINANCIAL RAIL on the
 *    right — the Smart Estimate (v1 + band + provenance) is the hero and it
 *    WORKS (fed by listings columns + ml /predict, never the dead legacy
 *    calculate_smart_rent path).
 *  - Rent vs HUD FMR rendered as an engraved comparison (hud_safmr).
 *  - Seller intel (cuts, motivation, DOM) in brass — one block, one voice.
 *  - Schools + flood-risk + demographics = the "Locale" section (raw_data
 *    schools, census_tracts NRI, zcta_demographics).
 *  - Sold comps strip (Track B) with $/sqft P75 → the ARV line.
 */

const P = {
  addr: '2847 Ellsworth Ave, Cleveland OH 44113',
  price: 89_000, firstPrice: 104_900, cutPct: 0.152, dom: 64, motivated: 71,
  rent: 1_180, lo: 940, hi: 1_390, fmr: 1_120, ratio: 1.33, target: 1.0,
  taxAnnual: 1_642, taxSrc: 'county records', hoa: 0, insurance: 1_120, insSrc: 'OH avg',
  capRate: 7.9, cashflow: 312, coc: 11.2,
  tract: { flood: 'Relatively Low', income: 46_300, medRent: 1_050, homeValue: 98_400 },
  schools: ['Tremont Montessori (K-8) · 0.4mi', 'Lincoln-West HS · 1.1mi', 'St. Ignatius (private) · 1.6mi'],
  soldComps: [
    { addr: '2811 Ellsworth Ave', sold: 96_500, ppsf: 78, when: 'Mar 2026' },
    { addr: '1533 Holmden Ave', sold: 104_000, ppsf: 84, when: 'May 2026' },
    { addr: '2205 W 11th St', sold: 122_500, ppsf: 91, when: 'Jun 2026' },
  ],
  arv: 118_000, arvSrc: 'sold comps',
};

const money = (n: number) => `$${n.toLocaleString()}`;

export default function ExampleDetail() {
  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* ── Masthead ──────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-end justify-between gap-6 pb-8" style={{ borderBottom: '1px solid var(--line)' }}>
          <div>
            <p className="prov prov--brass mb-3 inline-block">−15.2% since list · 64 days on market · seller motivation 71</p>
            <h1 style={{ font: `400 var(--display-2)/1.15 var(--font-display)` }}>{P.addr}</h1>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--haze)' }}>
              3 bd · 1.5 ba · 1,240 sqft · built 1922 · Tremont
              <a className="ml-3" style={{ color: 'var(--info)' }}>source listing ↗</a>
            </p>
          </div>
          <div className="text-right">
            <p className="figure text-[34px]">{money(P.price)}</p>
            <p className="text-[12px] line-through" style={{ color: 'var(--mute)' }}>{money(P.firstPrice)} first listed</p>
          </div>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_360px]">

          {/* ── Left: the dossier ───────────────────────────────────────── */}
          <main className="space-y-14">

            {/* Gallery in mats */}
            <section className="grid grid-cols-3 gap-3">
              <div className="mat col-span-2 aspect-[16/10]"><div className="h-full rounded-[6px] bg-[var(--ink-2)]" /></div>
              <div className="grid gap-3">
                <div className="mat aspect-[16/10]"><div className="h-full rounded-[6px] bg-[var(--ink-2)]" /></div>
                <div className="mat aspect-[16/10]"><div className="h-full rounded-[6px] bg-[var(--ink-2)]" /></div>
              </div>
            </section>

            {/* Rent vs HUD FMR — engraved comparison, WORKING data */}
            <section>
              <h2 className="prov mb-5 inline-block">rent, three ways</h2>
              <div className="space-y-4">
                {[
                  { label: 'OnePercent model (v1)', v: P.rent, band: true, tone: 'pass' },
                  { label: 'HUD Fair Market Rent · 44113 · 3BR', v: P.fmr, tone: 'neutral' },
                  { label: 'Tremont median asking (comps)', v: 1_215, tone: 'neutral' },
                ].map((r) => (
                  <div key={r.label}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[14px]" style={{ color: 'var(--haze)' }}>{r.label}</span>
                      <span className={`figure text-[18px] ${r.tone === 'pass' ? 'figure--pass' : ''}`}>{money(r.v)}/mo</span>
                    </div>
                    {r.band && (
                      <div className="band mt-2">
                        <div className="band-fill" style={{ left: '12%', width: '62%' }} />
                        <div className="band-mark" style={{ left: '41%' }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[12px]" style={{ color: 'var(--mute)' }}>
                Band = the model's p10–p90. FMR from HUD SAFMR FY2026. Never a naked estimate.
              </p>
            </section>

            {/* Sold comps → ARV (Track B) */}
            <section>
              <h2 className="prov mb-5 inline-block">what actually sold nearby</h2>
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {P.soldComps.map((c) => (
                  <div key={c.addr} className="flex items-baseline justify-between py-3">
                    <span className="text-[14px]" style={{ color: 'var(--haze)' }}>{c.addr}</span>
                    <span className="text-[12px]" style={{ color: 'var(--mute)' }}>{c.when}</span>
                    <span className="figure text-[15px]">{money(c.sold)} <span style={{ color: 'var(--mute)' }}>· ${c.ppsf}/sqft</span></span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="text-[14px]" style={{ color: 'var(--haze)' }}>After-repair value</span>
                <span className="figure text-[18px]">{money(P.arv)}</span>
                <span className="prov prov--real">ARV from {P.arvSrc}</span>
              </div>
            </section>

            {/* Locale: schools · flood · demographics (Track B data) */}
            <section>
              <h2 className="prov mb-5 inline-block">the locale</h2>
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div>
                  <p className="mb-3 text-[13px] font-medium">Schools</p>
                  <ul className="space-y-2 text-[14px]" style={{ color: 'var(--haze)' }}>
                    {P.schools.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
                <div className="space-y-4 text-[14px]">
                  <div className="flex justify-between"><span style={{ color: 'var(--haze)' }}>Flood risk index</span><span>{P.tract.flood} <span className="prov ml-1">FEMA NRI</span></span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--haze)' }}>Median household income</span><span className="figure">{money(P.tract.income)}</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--haze)' }}>Median area rent</span><span className="figure">{money(P.tract.medRent)}/mo</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--haze)' }}>Median home value</span><span className="figure">{money(P.tract.homeValue)}</span></div>
                </div>
              </div>
            </section>
          </main>

          {/* ── Right: sticky financial rail — the working Smart Estimate ── */}
          <aside className="lg:sticky lg:top-8 h-fit rounded-[var(--r-panel)] p-6"
                 style={{ background: 'var(--ink-panel)', border: '1px solid var(--line)' }}>
            <p className="prov mb-4 inline-block">the verdict</p>

            <div className="flex items-baseline gap-3">
              <span className="figure text-[40px] figure--pass">{P.ratio.toFixed(2)}%</span>
              <span className="text-[13px]" style={{ color: 'var(--haze)' }}>vs {P.target.toFixed(1)}% target</span>
            </div>
            <div className="rule-line my-4" />

            <dl className="space-y-3 text-[14px]">
              {[
                ['Modeled rent', `${money(P.rent)}/mo`, 'model v1', 'real'],
                ['Property tax', `${money(P.taxAnnual)}/yr`, P.taxSrc, 'real'],
                ['Insurance', `${money(P.insurance)}/yr`, P.insSrc, 'est'],
                ['HOA', P.hoa ? `${money(P.hoa)}/mo` : 'None', 'listing', 'real'],
              ].map(([k, v, src, tone]) => (
                <div key={k as string} className="flex items-baseline justify-between gap-2">
                  <dt style={{ color: 'var(--haze)' }}>{k}</dt>
                  <dd className="flex items-center gap-2">
                    <span className="figure">{v}</span>
                    <span className={`prov ${tone === 'real' ? 'prov--real' : 'prov--est'}`}>{src}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="my-5" style={{ borderTop: '1px solid var(--line)' }} />

            <dl className="space-y-3 text-[14px]">
              <div className="flex justify-between"><dt style={{ color: 'var(--haze)' }}>Cap rate</dt><dd className="figure">{P.capRate}%</dd></div>
              <div className="flex justify-between"><dt style={{ color: 'var(--haze)' }}>Cash flow</dt><dd className="figure figure--pass">+{money(P.cashflow)}/mo</dd></div>
              <div className="flex justify-between"><dt style={{ color: 'var(--haze)' }}>Cash-on-cash</dt><dd className="figure">{P.coc}%</dd></div>
            </dl>

            <button className="mt-6 w-full rounded-full py-2.5 text-[14px] font-semibold transition-colors"
                    style={{ background: 'var(--pass)', color: '#fff' }}>
              Watch this property
            </button>
            <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--mute)' }}>
              financing: 20% down · 6.43% (FRED, live) · 30yr
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
