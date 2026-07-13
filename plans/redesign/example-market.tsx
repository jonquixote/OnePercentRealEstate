/**
 * example-market.tsx — J4: the ZIP dossier. Answers "should I even look
 * here?" then hands off to a pre-scoped search. SEO front door: every
 * number sourced, breadcrumbed, internally linked both directions
 * (property pages link here; this links to properties + adjacent ZIPs).
 */
'use client';

const M = {
  zip: '90004',
  name: 'Koreatown / Hancock Park',
  city: 'Los Angeles, CA',
  medPrice: 1250000,
  medRent: 4050,
  ratio: 0.39,
  clearCount: 0,
  listings: 214,
  hpi: [148, 156, 171, 189, 178, 182, 196, 214, 228, 236], // 10y index
  income: 68400,
  incomeGrowth5: 21,
  walk: 15.1,
  nriRating: 'Relatively High',
  unemployment: 4.9,
  adjacent: [['90005', '0.52%'], ['90020', '0.47%'], ['90029', '0.61%'], ['90038', '0.55%']],
  clears: [
    { addr: '2814 Dawson St', price: 89000, ratio: 1.28 },
    { addr: '118 E 49th Pl', price: 132000, ratio: 1.09 },
  ],
};

const money = (n: number) => `$${n.toLocaleString()}`;

function Spark({ data, w = 220, h = 48 }: { data: number[]; w?: number; h?: number }) {
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min)) * (h - 6) - 3}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--pass)" strokeWidth="1.5" />
    </svg>
  );
}

export default function ExampleMarket() {
  return (
    <main style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">

        <nav aria-label="Breadcrumb" className="text-[12px]" style={{ color: 'var(--mute)' }}>
          <a href="/" style={{ color: 'var(--haze)' }}>Home</a> · <a href="/market" style={{ color: 'var(--haze)' }}>Markets</a> · {M.zip}
        </nav>

        {/* hero: name + the one verdict figure */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 style={{ font: '400 var(--display-2)/1.1 var(--font-display)' }}>{M.name}</h1>
            <p className="mt-1 text-[14px]" style={{ color: 'var(--haze)' }}>{M.zip} · {M.city} · <span className="figure">{M.listings}</span> active listings</p>
          </div>
          <div className="text-right">
            <p className="figure text-[34px]" style={{ color: M.ratio >= 1 ? 'var(--pass)' : 'var(--haze)' }}>{M.ratio.toFixed(2)}%</p>
            <p className="prov" style={{ color: 'var(--mute)' }}>median rent ÷ median price</p>
          </div>
        </div>

        {/* stat strip: all sourced */}
        <div className="mt-8 grid gap-px overflow-hidden rounded-[var(--r-panel)] sm:grid-cols-2 lg:grid-cols-4" style={{ background: 'var(--line)', border: '1px solid var(--line)' }}>
          {[
            ['Median asking', money(M.medPrice), 'active listings'],
            ['Median model rent', `${money(M.medRent)}/mo`, 'model v1'],
            ['Median HH income', money(M.income), `ACS · +${M.incomeGrowth5}%/5y`],
            ['Unemployment', `${M.unemployment}%`, 'BLS LAUS · county'],
          ].map(([k, v, src]) => (
            <div key={k} className="p-5" style={{ background: 'var(--ink)' }}>
              <p className="text-[12px]" style={{ color: 'var(--haze)' }}>{k}</p>
              <p className="figure mt-1 text-[20px]">{v}</p>
              <p className="prov mt-1" style={{ color: 'var(--mute)' }}>{src}</p>
            </div>
          ))}
        </div>

        {/* trajectory + context: two columns */}
        <div className="mt-12 grid gap-12 lg:grid-cols-2">
          <section>
            <p className="prov mb-4" style={{ color: 'var(--mute)' }}>ten years of price</p>
            <Spark data={M.hpi} w={440} h={80} />
            <p className="mt-2 text-[13px]" style={{ color: 'var(--haze)' }}>
              House price index <b className="figure" style={{ color: 'var(--text)' }}>+{Math.round(((M.hpi[9] - M.hpi[4]) / M.hpi[4]) * 100)}%</b> over five years
              <span className="prov ml-1.5" style={{ color: 'var(--mute)' }}>FHFA ZIP HPI</span>
            </p>
            <div className="mt-8">
              <p className="prov mb-3" style={{ color: 'var(--mute)' }}>rent, block by block</p>
              <div className="mat">
                <div className="flex h-44 items-center justify-center rounded-[var(--r-mat)]" style={{ background: 'var(--ink-2)' }}>
                  <span className="prov" style={{ color: 'var(--mute)' }}>rent-heat mini-map · this ZIP</span>
                </div>
              </div>
            </div>
          </section>

          <section>
            <p className="prov mb-4" style={{ color: 'var(--mute)' }}>character & risk</p>
            <dl className="space-y-3 text-[14px]">
              {[
                ['Walkability', `${M.walk} / 20`, 'EPA Smart Location'],
                ['FEMA risk index', M.nriRating, 'NRI overall'],
                ['Flood exposure', '3.2% of listings in SFHA', 'FEMA NFHL'],
                ['Transit', '38 stops · 2 rail', 'GTFS'],
                ['Schools', '11 public within the ZIP', 'NCES'],
              ].map(([k, v, src]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
                  <dt style={{ color: 'var(--haze)' }}>{k}</dt>
                  <dd className="text-right"><span className="figure">{v}</span><span className="prov block" style={{ color: 'var(--mute)' }}>{src}</span></dd>
                </div>
              ))}
            </dl>

            {/* what clears here (or honesty when nothing does) */}
            <div className="mt-8">
              <p className="prov mb-3" style={{ color: 'var(--mute)' }}>clearing the line here</p>
              {M.clearCount === 0 ? (
                <p className="rounded-[var(--r-panel)] border p-4 text-[13px]" style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}>
                  Nothing in {M.zip} clears 1% today — typical for prime LA.
                  Investors here underwrite on appreciation, not cash flow.
                  <a href="/playbook/buy-hold" className="ml-1 font-medium hover:underline" style={{ color: 'var(--pass)' }}>The playbook explains when that works →</a>
                </p>
              ) : (
                <ul>{M.clears.map((c) => <li key={c.addr}>{c.addr}</li>)}</ul>
              )}
            </div>
          </section>
        </div>

        {/* handoff + adjacency loop */}
        <div className="mt-14 flex flex-wrap items-center justify-between gap-6 rounded-[var(--r-panel)] border p-6" style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}>
          <div>
            <p className="text-[15px] font-medium">Hunt in {M.zip}</p>
            <p className="mt-0.5 text-[13px]" style={{ color: 'var(--haze)' }}>Opens the workbench scoped to this ZIP, rent-heat on.</p>
          </div>
          <a href={`/search?q=${M.zip}&mv=-118.3150,34.0740,13.0`} className="rounded-full px-6 py-2.5 text-[14px] font-semibold" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>
            Search {M.zip} →
          </a>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 pb-16 text-[13px]">
          <span style={{ color: 'var(--mute)' }}>Adjacent:</span>
          {M.adjacent.map(([z, r]) => (
            <a key={z} href={`/market/${z}`} className="rounded-full border px-3.5 py-1.5 font-medium hover:border-line-hi" style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}>
              {z} <span className="figure" style={{ color: 'var(--text)' }}>{r}</span>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
