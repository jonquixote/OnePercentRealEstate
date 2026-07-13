/**
 * example-property-detail.tsx — J3: the dossier, verdict first.
 *
 * The first viewport answers "does it clear?" completely: the gauge (the
 * line, drawn), the rent band with provenance, cash flow at default
 * financing. Everything after is evidence, ordered by how often an
 * investor actually needs it. The sticky rail keeps verdict + actions
 * present for the whole read; on mobile it becomes a bottom bar.
 */
'use client';

const P = {
  addr: '184 S Harvard Blvd',
  cityline: 'Koreatown · Los Angeles 90004',
  price: 1199000,
  rent: 4783, low: 3900, high: 5800,
  ratio: 0.40, target: 1.0,
  capRate: 2.39, coc: -3.1,
  beds: 3, baths: 2, sqft: 1790, year: 1921,
  dom: 12, cut: 4.2,
  flood: null as string | null,
  walk: 14.2, // EPA 1-20
  crime: 'FBI-reported · coverage varies',
  schools3: ['Hobart Blvd Elementary · 0.3mi', 'John Burroughs MS · 0.8mi', 'LA High · 1.1mi'],
};

const money = (n: number) => `$${n.toLocaleString()}`;

export default function ExamplePropertyDetail() {
  const pct = Math.min((P.ratio / P.target) * 100, 100);
  return (
    <main style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-8 lg:grid-cols-[1fr_320px] lg:px-8">

        {/* ════ Main column ════ */}
        <article>
          {/* breadcrumb + address */}
          <nav aria-label="Breadcrumb" className="text-[12px]" style={{ color: 'var(--mute)' }}>
            <a href="/" style={{ color: 'var(--haze)' }}>Home</a> · <a href="/market/90004" style={{ color: 'var(--haze)' }}>Los Angeles 90004</a> · {P.addr}
          </nav>
          <h1 className="mt-3" style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>{P.addr}</h1>
          <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>
            {P.cityline} · {P.beds} bd · {P.baths} ba · <span className="figure">{P.sqft.toLocaleString()}</span> sqft · built {P.year}
          </p>

          {/* photo strip */}
          <div className="mt-6 grid grid-cols-4 gap-2">
            <div className="mat col-span-3"><div className="flex aspect-[16/10] items-center justify-center rounded-[6px] text-[12px]" style={{ background: 'var(--ink-2)', color: 'var(--mute)' }}>hero photo</div></div>
            <div className="grid gap-2">
              {[1, 2].map((i) => <div key={i} className="mat"><div className="flex aspect-[16/10] items-center justify-center rounded-[6px] text-[10px]" style={{ background: 'var(--ink-2)', color: 'var(--mute)' }}>+{i}</div></div>)}
            </div>
          </div>

          {/* ── THE VERDICT — first section, full width ── */}
          <section className="mt-10">
            <p className="prov mb-5" style={{ color: 'var(--mute)' }}>the verdict</p>

            {/* the line, drawn: ratio gauge */}
            <div className="relative h-10" aria-label={`Rent-to-price ${P.ratio.toFixed(2)}% of a ${P.target.toFixed(2)}% target`}>
              <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'var(--line-hi)' }} />
              <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ width: `${pct}%`, background: P.ratio >= P.target ? 'var(--pass)' : 'var(--brass)' }} />
              <span className="figure absolute -top-1 text-[22px]" style={{ left: `${pct}%`, transform: 'translateX(-50%)', color: P.ratio >= P.target ? 'var(--pass)' : 'var(--brass)' }}>
                {P.ratio.toFixed(2)}%
              </span>
              <span className="prov absolute right-0 top-1/2 mt-2" style={{ color: 'var(--mute)' }}>needs {P.target.toFixed(2)}%</span>
            </div>

            <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--r-panel)] sm:grid-cols-3" style={{ background: 'var(--line)', border: '1px solid var(--line)' }}>
              {/* rent with band — never naked */}
              <div className="p-5" style={{ background: 'var(--ink)' }}>
                <p className="text-[12px]" style={{ color: 'var(--haze)' }}>Model rent</p>
                <p className="figure mt-1 text-[24px]">{money(P.rent)}<span className="text-[13px]" style={{ color: 'var(--mute)' }}>/mo</span></p>
                <div className="band mt-2.5"><div className="band-fill" style={{ left: '18%', width: '58%' }} /><div className="band-mark" style={{ left: '46%' }} /></div>
                <p className="prov mt-1.5" style={{ color: 'var(--mute)' }}>{money(P.low)}–{money(P.high)} · model v1 · ±$480 MAE</p>
              </div>
              <div className="p-5" style={{ background: 'var(--ink)' }}>
                <p className="text-[12px]" style={{ color: 'var(--haze)' }}>Cap rate · 50% rule</p>
                <p className="figure mt-1 text-[24px]">{P.capRate.toFixed(2)}%</p>
                <p className="prov mt-1.5" style={{ color: 'var(--mute)' }}>NOI {money(Math.round(P.rent * 6))}/yr ÷ price</p>
              </div>
              <div className="p-5" style={{ background: 'var(--ink)' }}>
                <p className="text-[12px]" style={{ color: 'var(--haze)' }}>Cash-on-cash · 20% down</p>
                <p className="figure mt-1 text-[24px]" style={{ color: P.coc < 0 ? 'var(--loss)' : undefined }}>{P.coc.toFixed(1)}%</p>
                <p className="prov mt-1.5" style={{ color: 'var(--mute)' }}>6.5% / 30yr · 23% invested</p>
              </div>
            </div>
            <a href="/playbook/calculator" className="mt-3 inline-block text-[13px] font-medium hover:underline" style={{ color: 'var(--haze)' }}>
              Run your own numbers →
            </a>
          </section>

          {/* ── The neighborhood truth ── */}
          <section className="mt-14">
            <p className="prov mb-5" style={{ color: 'var(--mute)' }}>the locale</p>
            <div className="mat">
              <div className="relative flex h-64 items-center justify-center rounded-[var(--r-mat)]" style={{ background: 'var(--ink-2)' }}>
                <span className="prov" style={{ color: 'var(--mute)' }}>mini-map · rent $/sqft shading · subject pin · click to explore</span>
                <span className="absolute rounded-full border-2 p-1" style={{ borderColor: '#faf7f2', background: '#b0532f', top: '46%', left: '52%' }} />
              </div>
            </div>
            <div className="mt-6 grid gap-8 text-[14px] sm:grid-cols-2">
              <dl className="space-y-3">
                {[
                  ['Flood zone', P.flood ?? 'Outside mapped SFHA', 'FEMA NFHL'],
                  ['Walkability', `${P.walk} / 20`, 'EPA Smart Location'],
                  ['Violent crime', '412 /100k', P.crime],
                ].map(([k, v, src]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                    <dt style={{ color: 'var(--haze)' }}>{k}</dt>
                    <dd className="text-right"><span className="figure">{v}</span><span className="prov block" style={{ color: 'var(--mute)' }}>{src}</span></dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="mb-2.5 text-[13px] font-medium">Schools nearby</p>
                <ul className="space-y-2" style={{ color: 'var(--haze)' }}>
                  {P.schools3.map((s) => <li key={s}>{s}</li>)}
                </ul>
                <p className="prov mt-2" style={{ color: 'var(--mute)' }}>NCES locations · ratings when available</p>
              </div>
            </div>
          </section>

          {/* ── Evidence: comps / history / facts (collapsed rhythm) ── */}
          {['what actually rents nearby', 'what actually sold nearby', 'price history', 'the paperwork facts'].map((h) => (
            <section key={h} className="mt-14">
              <p className="prov mb-5" style={{ color: 'var(--mute)' }}>{h}</p>
              <div className="rounded-[var(--r-panel)] border p-8 text-center text-[12px]" style={{ borderColor: 'var(--line)', color: 'var(--mute)' }}>
                existing section component
              </div>
            </section>
          ))}
        </article>

        {/* ════ Sticky rail (desktop) ════ */}
        <aside className="hidden lg:block">
          <div className="sticky top-[88px] rounded-[var(--r-panel)] border p-5" style={{ borderColor: 'var(--line)', background: 'var(--ink-panel)' }}>
            <p className="figure text-[26px]">{money(P.price)}</p>
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--brass)' }}>−{P.cut}% cut · {P.dom} days on market</p>

            <div className="my-4 h-px" style={{ background: 'var(--line)' }} />

            <p className="text-[12px]" style={{ color: 'var(--haze)' }}>Rent ÷ price</p>
            <p className="figure text-[20px]" style={{ color: 'var(--brass)' }}>{P.ratio.toFixed(2)}% <span className="prov" style={{ color: 'var(--mute)' }}>of {P.target.toFixed(2)}%</span></p>

            <div className="mt-4 grid gap-2">
              <button className="rounded-full py-2.5 text-[14px] font-semibold" style={{ background: 'var(--text)', color: 'var(--ink)' }}>♡ Watch this deal</button>
              <button className="rounded-full border py-2.5 text-[14px] font-medium" style={{ borderColor: 'var(--line)' }}>+ Compare</button>
            </div>
            <p className="prov mt-3 text-center" style={{ color: 'var(--mute)' }}>watching emails you on price cuts</p>
          </div>
        </aside>
      </div>

      {/* ════ Mobile bottom bar (replaces rail < lg) ════ */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t px-4 py-3 backdrop-blur lg:hidden" style={{ background: 'rgba(250,247,242,.95)', borderColor: 'var(--line-hi)' }}>
        <div className="min-w-0">
          <p className="figure text-[17px] leading-tight">{money(P.price)}</p>
          <p className="figure text-[12px]" style={{ color: 'var(--brass)' }}>{P.ratio.toFixed(2)}% · rent {money(P.rent)}</p>
        </div>
        <button className="ml-auto shrink-0 rounded-full px-5 py-2.5 text-[14px] font-semibold" style={{ background: 'var(--text)', color: 'var(--ink)' }}>♡ Watch</button>
      </div>
    </main>
  );
}
