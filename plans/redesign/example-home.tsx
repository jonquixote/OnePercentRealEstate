/**
 * REDESIGN EXAMPLE — Home ("the line, set like a frontispiece")
 * Self-contained, mock data, not wired. Review artifact for the Cycle-3
 * frontend overhaul. Tokens: plans/redesign/tokens.css.
 *
 * What changes vs today:
 *  - Editorial serif hero over a quiet ink field; the Rule Line is the only
 *    glowing element on the page.
 *  - The ticker becomes a single engraved strip (no boxes).
 *  - Featured deals: large photography in mats, ONE metric spoken loudly
 *    (the ratio vs its target), everything else whispered.
 *  - Reduced rail keeps brass as its single accent.
 *  - Every model number carries band + provenance (no naked estimates).
 */

const FEATURED = [
  { id: 1, addr: '2847 Ellsworth Ave, Cleveland OH', price: 89_000, rent: 1_180, lo: 940, hi: 1_390, target: 1.0, img: 'photo-1.jpg', tax: 'real' },
  { id: 2, addr: '414 Crescent Ct, Birmingham AL', price: 112_500, rent: 1_295, lo: 1_060, hi: 1_540, target: 1.0, img: 'photo-2.jpg', tax: 'real' },
  { id: 3, addr: '77 Bayou Vista Dr, Houston TX', price: 165_000, rent: 1_710, lo: 1_390, hi: 2_050, target: 1.0, img: 'photo-3.jpg', tax: 'est' },
];

const CUTS = [
  { id: 4, addr: '10489 Heber Springs Rd, Concord AR', price: 15_000, cut: 0.57 },
  { id: 5, addr: '221 Garfield St, Dayton OH', price: 54_900, cut: 0.31 },
  { id: 6, addr: '9 Palmetto Row, Augusta GA', price: 99_000, cut: 0.18 },
];

const money = (n: number) => `$${n.toLocaleString()}`;

export default function ExampleHome() {
  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>

      {/* ── Hero: frontispiece ─────────────────────────────────────────── */}
      <header className="mx-auto max-w-6xl px-6 pt-24 pb-16">
        <p className="prov mb-6 inline-block">946,000 listings · rescored nightly</p>
        <h1 style={{ font: `300 var(--display-1)/1.04 var(--font-display)` }}>
          Every property in America,<br />
          <em style={{ fontStyle: 'italic', color: 'var(--pass-hi)' }}>measured against the line.</em>
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed" style={{ color: 'var(--haze)' }}>
          The 1% rule, computed honestly: modeled rent with confidence bands,
          county tax records where they exist, and a per-property target that
          knows a duplex from a condo.
        </p>

        {/* THE line — the page's single glowing element */}
        <div className="rule-line mt-14" />

        {/* Engraved ticker strip (no boxes) */}
        <div className="mt-5 flex flex-wrap gap-x-10 gap-y-2 text-[13px]" style={{ color: 'var(--haze)' }}>
          <span><b className="figure" style={{ color: 'var(--text)' }}>18,412</b> clear the line today</span>
          <span><b className="figure" style={{ color: 'var(--text)' }}>1,781</b> price cuts live</span>
          <span><b className="figure" style={{ color: 'var(--text)' }}>$484</b> model error (MAE, holdout)</span>
          <span><b className="figure" style={{ color: 'var(--text)' }}>6.43%</b> 30-yr rate · FRED</span>
        </div>
      </header>

      {/* ── Featured: photography in mats, one loud metric ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="flex items-baseline justify-between">
          <h2 style={{ font: `400 var(--display-2)/1.1 var(--font-display)` }}>Clears the line</h2>
          <a className="text-[13px]" style={{ color: 'var(--haze)' }}>Browse all →</a>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-3">
          {FEATURED.map((p) => {
            const ratio = (p.rent / p.price) * 100;
            return (
              <article key={p.id} className="group cursor-pointer">
                <div className="mat aspect-[4/3] transition-colors group-hover:border-[var(--line-hi)]">
                  <div className="h-full w-full rounded-[6px] bg-[var(--ink-2)]" aria-label={p.img} />
                </div>

                {/* The one loud metric: ratio vs the line */}
                <div className="mt-5 flex items-baseline justify-between">
                  <span className="figure text-[28px] figure--pass">{ratio.toFixed(2)}%</span>
                  <span className="text-[12px]" style={{ color: 'var(--mute)' }}>target {p.target.toFixed(1)}%</span>
                </div>

                {/* Whispered facts */}
                <p className="mt-1 text-[15px]">{money(p.price)} · rent {money(p.rent)}<span style={{ color: 'var(--mute)' }}>/mo</span></p>

                {/* Band + provenance — no naked estimates */}
                <div className="band mt-3" aria-label={`Rent range ${money(p.lo)}–${money(p.hi)}`}>
                  <div className="band-fill" style={{ left: '18%', width: '58%' }} />
                  <div className="band-mark" style={{ left: '44%' }} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`prov ${p.tax === 'real' ? 'prov--real' : 'prov--est'}`}>
                    tax {p.tax === 'real' ? 'county records' : 'estimated'}
                  </span>
                  <span className="prov">model v1</span>
                </div>

                <p className="mt-3 truncate text-[13px]" style={{ color: 'var(--haze)' }}>{p.addr}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Reduced rail: brass speaks, nothing else does ───────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="flex items-baseline justify-between">
          <div>
            <p className="prov prov--brass mb-3 inline-block">motivated sellers</p>
            <h2 style={{ font: `400 var(--display-2)/1.1 var(--font-display)` }}>The deepest cuts</h2>
          </div>
          <a className="text-[13px]" style={{ color: 'var(--haze)' }}>All reductions →</a>
        </div>

        <div className="mt-8 divide-y" style={{ borderColor: 'var(--line)' }}>
          {CUTS.map((c) => (
            <div key={c.id} className="flex items-baseline justify-between py-4 transition-colors hover:bg-[var(--ink-2)]"
                 style={{ borderColor: 'var(--line)' }}>
              <span className="figure text-[20px]" style={{ color: 'var(--brass-hi)' }}>
                −{Math.round(c.cut * 100)}%
              </span>
              <span className="mx-6 flex-1 truncate text-[14px]" style={{ color: 'var(--haze)' }}>{c.addr}</span>
              <span className="figure text-[15px]">{money(c.price)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
