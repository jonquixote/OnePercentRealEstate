/**
 * example-home.tsx — J1: cold visitor → believer in 30 seconds.
 *
 * Structure (every number would be live in production):
 *   1. Thesis over the literal line + live stat tape
 *   2. A REAL listing worked through the 1% math (the product as the tour)
 *   3. Rent-heat mini-map teaser (the data moat, visible)
 *   4. Market dossier grid (SEO surfaces promoted, not orphaned)
 *   5. One CTA band
 *
 * Grammar enforced: serif speaks twice (hero, one section head); one
 * verdict accent per viewport; every model number carries its band+source.
 */
'use client';

const TAPE = [
  ['18,412', 'clear the line today'],
  ['1,781', 'price cuts live'],
  ['±$480', 'model error · holdout MAE'],
  ['6.43%', '30-yr fixed · FRED'],
];

const WORKED = {
  address: '4458 Maplewood Ave, Los Angeles 90004',
  price: 1075000,
  rent: 5310,
  low: 4260,
  high: 6640,
  ratio: 0.49,
};

const MARKETS = [
  { zip: '38106', city: 'Memphis', ratio: 1.31, rent: 1180, hpi5: 24 },
  { zip: '44102', city: 'Cleveland', ratio: 1.22, rent: 1050, hpi5: 31 },
  { zip: '43206', city: 'Columbus', ratio: 1.08, rent: 1390, hpi5: 38 },
  { zip: '78201', city: 'San Antonio', ratio: 0.94, rent: 1420, hpi5: 27 },
  { zip: '33604', city: 'Tampa', ratio: 0.89, rent: 1690, hpi5: 41 },
  { zip: '90004', city: 'Los Angeles', ratio: 0.49, rent: 4050, hpi5: 22 },
];

const money = (n: number) => `$${n.toLocaleString()}`;

export default function ExampleHome() {
  return (
    <main style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>

      {/* ── 1 · Thesis ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-12 lg:px-8">
        <h1 style={{ font: '400 var(--display-1)/1.05 var(--font-display)', letterSpacing: '-0.02em' }}>
          Rent has to clear the&nbsp;line.
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-relaxed" style={{ color: 'var(--haze)' }}>
          One million listings, each held against the oldest test in rental
          investing — monthly rent ≥ 1% of price — with a rent model that
          knows the difference between two sides of the same street.
        </p>

        {/* the literal line, with the day's distribution crossing it */}
        <div className="relative mt-12 h-16" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'var(--line-hi)' }} />
          <div className="absolute inset-x-0 top-1/2 h-px w-[38%]" style={{ background: 'var(--pass)' }} />
          {[8, 14, 22, 27, 33, 36, 44, 52, 58, 63, 71, 76, 84, 91].map((x, i) => (
            <span
              key={x}
              className="absolute h-2 w-2 rounded-full"
              style={{
                left: `${x}%`,
                top: i % 3 === 0 ? 'calc(50% - 14px)' : 'calc(50% + 8px)',
                background: x < 38 ? 'var(--pass)' : 'var(--line-hi)',
                opacity: x < 38 ? 0.9 : 0.6,
              }}
            />
          ))}
          <span className="prov absolute left-[38%] -top-1 -translate-x-1/2" style={{ color: 'var(--pass)' }}>1.00%</span>
        </div>

        {/* live tape */}
        <div className="mt-10 flex flex-wrap gap-x-10 gap-y-3 text-[13px]" style={{ color: 'var(--haze)' }}>
          {TAPE.map(([n, label]) => (
            <span key={label}>
              <b className="figure text-[15px]" style={{ color: 'var(--text)' }}>{n}</b> {label}
            </span>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-4">
          <a href="/search" className="rounded-full px-6 py-3 text-[15px] font-semibold" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>
            Open the workbench →
          </a>
          <a href="/playbook" className="text-[14px] font-medium hover:underline" style={{ color: 'var(--haze)' }}>
            How the rule works
          </a>
        </div>
      </section>

      {/* ── 2 · One real deal, worked ──────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-8" style={{ borderTop: '1px solid var(--line)' }}>
        <p className="prov mb-6" style={{ color: 'var(--mute)' }}>a live listing, held to the test</p>
        <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
          {/* left: the property */}
          <div>
            <div className="mat">
              <div className="flex aspect-[4/3] items-center justify-center rounded-[var(--r-mat)] text-[12px]" style={{ background: 'var(--ink-2)', color: 'var(--mute)' }}>
                photo · {WORKED.address}
              </div>
            </div>
            <p className="mt-3 text-[14px]" style={{ color: 'var(--haze)' }}>{WORKED.address}</p>
            <p className="figure mt-1 text-[20px]">{money(WORKED.price)}</p>
          </div>

          {/* right: the arithmetic, line by line */}
          <div className="flex flex-col justify-center">
            <dl>
              {[
                ['Model rent', `${money(WORKED.rent)}/mo`, `range ${money(WORKED.low)}–${money(WORKED.high)} · model v1`],
                ['Asking price', money(WORKED.price), 'listed 12 days ago'],
                ['Rent ÷ price', `${WORKED.ratio.toFixed(2)}%`, 'needs 1.00%'],
              ].map(([k, v, note]) => (
                <div key={k} className="flex items-baseline justify-between py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                  <dt className="text-[14px]" style={{ color: 'var(--haze)' }}>{k}</dt>
                  <dd className="text-right">
                    <span className="figure text-[18px]">{v}</span>
                    <span className="prov block" style={{ color: 'var(--mute)' }}>{note}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[15px]" style={{ color: 'var(--brass)' }}>
              <b className="figure">0.49%</b> — this one doesn't clear. The workbench
              shows you the 18,412 that do.
            </p>
          </div>
        </div>
      </section>

      {/* ── 3 · The map teaser ─────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-8" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="grid items-center gap-10 lg:grid-cols-[2fr_3fr]">
          <div>
            <h2 style={{ font: '400 var(--display-2)/1.15 var(--font-display)' }}>
              Rent, block by block.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed" style={{ color: 'var(--haze)' }}>
              98,000 hexes of observed rent per square foot, refreshed
              nightly. The model prices Hancock Park and Koreatown
              differently — because they are.
            </p>
            <a href="/search?mv=-118.3150,34.0740,12.5" className="mt-5 inline-block text-[14px] font-semibold hover:underline" style={{ color: 'var(--pass)' }}>
              Explore the surface →
            </a>
          </div>
          {/* production: lazy @oper/map MiniMap, rent-heat on, LA */}
          <div className="mat">
            <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[var(--r-mat)]" style={{ background: 'var(--ink-2)' }}>
              {[['12%', '20%', 'var(--pass-dim)'], ['30%', '35%', 'rgba(201,163,92,.2)'], ['55%', '15%', 'rgba(176,83,47,.18)'], ['70%', '48%', 'var(--pass-dim)'], ['38%', '62%', 'rgba(201,163,92,.25)']].map(([l, t, c], i) => (
                <span key={i} aria-hidden className="absolute h-24 w-24" style={{ left: l, top: t, background: c, clipPath: 'polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%)' }} />
              ))}
              <span className="prov z-10" style={{ color: 'var(--mute)' }}>live rent-heat mini-map</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4 · Markets grid ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16 lg:px-8" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="mb-8 flex items-baseline justify-between">
          <p className="prov" style={{ color: 'var(--mute)' }}>where the line clears</p>
          <a href="/market" className="text-[13px] font-medium hover:underline" style={{ color: 'var(--haze)' }}>All markets →</a>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r-panel)] sm:grid-cols-3" style={{ background: 'var(--line)', border: '1px solid var(--line)' }}>
          {MARKETS.map((m) => {
            const clears = m.ratio >= 1;
            return (
              <a key={m.zip} href={`/market/${m.zip}`} className="group p-5 transition-colors" style={{ background: 'var(--ink)' }}>
                <p className="text-[14px] font-medium">{m.city} <span style={{ color: 'var(--mute)' }}>{m.zip}</span></p>
                <p className="figure mt-2 text-[22px]" style={{ color: clears ? 'var(--pass)' : 'var(--haze)' }}>
                  {m.ratio.toFixed(2)}%
                </p>
                <p className="prov mt-1" style={{ color: 'var(--mute)' }}>
                  median rent ${m.rent} · HPI +{m.hpi5}%/5y
                </p>
              </a>
            );
          })}
        </div>
      </section>

      {/* ── 5 · CTA band ───────────────────────────────────────────── */}
      <section className="px-6 py-20 text-center" style={{ borderTop: '1px solid var(--line)', background: 'var(--ink-2)' }}>
        <p className="mx-auto max-w-md text-[17px]" style={{ color: 'var(--haze)' }}>
          The math is public. The discipline is the product.
        </p>
        <a href="/search" className="mt-6 inline-block rounded-full px-7 py-3 text-[15px] font-semibold" style={{ background: 'var(--text)', color: 'var(--ink)' }}>
          Start searching — free
        </a>
      </section>
    </main>
  );
}
