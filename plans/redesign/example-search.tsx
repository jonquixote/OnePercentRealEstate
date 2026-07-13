/**
 * example-search.tsx — J2: the workbench. Split view with a disciplined
 * toolbar, hover-sync both directions, coach marks on first run, and the
 * mobile List|Map segmented pattern.
 *
 * Toolbar diet demonstrated: [Filters ·n] [chips…] |spacer| [count] [Sort]
 * [view] [⋯ overflow]. Eight controls become four groups; watch/copy/table
 * live in the overflow on narrow widths.
 */
'use client';

import { useState } from 'react';

const ROWS = [
  { id: '1', addr: '330 N Gower St', price: 1749000, rent: 4268, low: 3300, high: 5200, ratio: 0.24, dom: 41, cut: 0, beds: 3, baths: 2, sqft: 1392 },
  { id: '2', addr: '184 S Harvard Blvd', price: 1199000, rent: 4783, low: 3900, high: 5800, ratio: 0.40, dom: 12, cut: 4.2, beds: 3, baths: 2, sqft: 1790 },
  { id: '3', addr: '4943 Rosewood Ave', price: 699000, rent: 3192, low: 2600, high: 3900, ratio: 0.46, dom: 8, cut: 0, beds: 2, baths: 2, sqft: 1180 },
  { id: '4', addr: '2814 Dawson St, Memphis', price: 89000, rent: 1140, low: 950, high: 1350, ratio: 1.28, dom: 23, cut: 0, beds: 3, baths: 1, sqft: 1210 },
];

const money = (n: number) => `$${n.toLocaleString()}`;

export default function ExampleSearch() {
  const [hovered, setHovered] = useState<string | null>('2');
  const [coach, setCoach] = useState(1); // 0=dismissed, 1..3 = step
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list');

  return (
    <main className="flex min-h-screen flex-col" style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>

      {/* ── Toolbar (the diet) ─────────────────────────────────────── */}
      <div className="sticky top-0 z-30 backdrop-blur" style={{ background: 'rgba(250,247,242,.95)', borderBottom: '1px solid var(--line)' }}>
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5 lg:px-6">
          <button className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium" style={{ borderColor: 'var(--line)' }}>
            Filters <span className="rounded-full px-1.5 text-[10px] font-bold" style={{ background: 'var(--pass-dim)', color: 'var(--pass)' }}>3</span>
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            {['≤ $1.2M', '3+ bd', 'Clears the line'].map((chip) => (
              <button key={chip} className="rounded-full px-3 py-1.5 text-[12px] font-medium" style={{ background: 'var(--pass-dim)', color: 'var(--pass)' }}>
                {chip} <span className="opacity-60">×</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[12px] sm:inline" style={{ color: 'var(--mute)' }}>
              <b className="figure" style={{ color: 'var(--text)' }}>1,214</b> results
            </span>
            <select className="rounded-full border bg-transparent px-3 py-1.5 text-[12px] font-medium" style={{ borderColor: 'var(--line)' }}>
              <option>Rule · best</option>
              <option>Newest</option>
            </select>
            <button className="hidden rounded-full border px-3 py-1.5 text-[12px] lg:inline" style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}>Table</button>
            <button className="rounded-full border px-2.5 py-1.5 text-[14px] leading-none" style={{ borderColor: 'var(--line)', color: 'var(--haze)' }} title="Watch · Copy link · Hide map">⋯</button>
          </div>
        </div>
      </div>

      {/* ── Split view (desktop) ───────────────────────────────────── */}
      <div className="mx-auto grid w-full max-w-[1600px] flex-1 gap-6 px-4 py-5 lg:grid-cols-[minmax(400px,34%)_1fr] lg:px-6">

        {/* list — hidden on mobile when map tab active */}
        <div className={mobileTab === 'map' ? 'hidden lg:block' : ''}>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {ROWS.map((r) => {
              const clears = r.ratio >= 1;
              const hot = hovered === r.id;
              return (
                <a
                  key={r.id}
                  href={`/property/${r.id}`}
                  onMouseEnter={() => setHovered(r.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="group block"
                >
                  <div
                    className="mat relative aspect-[4/3] transition-all"
                    style={hot ? { borderColor: 'var(--pass-hi)', boxShadow: '0 0 0 1px var(--pass-hi)' } : undefined}
                  >
                    <div className="flex h-full items-center justify-center rounded-[6px] text-[11px]" style={{ background: 'var(--ink-2)', color: 'var(--mute)' }}>photo</div>
                    {r.cut > 0 && (
                      <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
                        −{r.cut}%
                      </span>
                    )}
                    <button
                      className="absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-semibold opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
                      style={{ background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)' }}
                      onClick={(e) => e.preventDefault()}
                    >
                      + Compare
                    </button>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="figure text-[21px]" style={{ color: clears ? 'var(--pass-hi)' : 'var(--haze)' }}>
                      {r.ratio.toFixed(2)}%
                    </span>
                    <span className="figure text-[15px]">{money(r.price)}</span>
                  </div>
                  {/* band: never a naked estimate */}
                  <div className="band mt-2">
                    <div className="band-fill" style={{ left: `${(r.low / r.high) * 60}%`, width: '38%' }} />
                    <div className="band-mark" style={{ left: '48%' }} />
                  </div>
                  <p className="mt-1.5 text-[12px]" style={{ color: 'var(--mute)' }}>
                    rent {money(r.rent)}/mo · {money(r.low)}–{money(r.high)}
                  </p>
                  <p className="mt-1 truncate text-[13px]" style={{ color: 'var(--haze)' }}>
                    {r.addr} <span style={{ color: 'var(--mute)' }}>· {r.dom} DOM</span>
                  </p>
                </a>
              );
            })}
          </div>
        </div>

        {/* map pane */}
        <div className={`relative overflow-hidden rounded-2xl border lg:sticky lg:top-[120px] lg:h-[calc(100vh-140px)] ${mobileTab === 'list' ? 'hidden lg:block' : 'h-[70vh]'}`} style={{ borderColor: 'var(--line)', background: 'var(--ink-2)' }}>
          {/* control row */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur" style={{ background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)' }}>
              <input type="checkbox" defaultChecked className="h-3 w-3 accent-[var(--pass)]" /> Search as I move
            </label>
            <button className="rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur" style={{ background: 'rgba(250,247,242,.92)', borderColor: 'var(--line)' }}>✏ Draw area</button>
          </div>
          {/* layers + basemap bottom-right */}
          <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
            <div className="flex overflow-hidden rounded-full border text-[12px] font-medium backdrop-blur" style={{ borderColor: 'var(--line)', background: 'rgba(250,247,242,.92)' }}>
              <span className="px-3 py-1.5" style={{ background: 'var(--pass)', color: 'var(--ink)' }}>Map</span>
              <span className="px-3 py-1.5" style={{ color: 'var(--haze)' }}>Satellite</span>
            </div>
            <button className="rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur" style={{ background: 'var(--pass)', borderColor: 'var(--pass)', color: 'var(--ink)' }}>
              ▤ Layers · 1
            </button>
          </div>
          {/* stage: pins + a hovered pill */}
          <div className="flex h-full min-h-[420px] items-center justify-center">
            <div className="relative h-64 w-full max-w-md">
              {[['20%', '30%', '$1.7M', false], ['48%', '52%', '$1.2M', true], ['70%', '24%', '$699K', false], ['62%', '70%', '$89K', false]].map(([l, t, label, hot], i) => (
                <span
                  key={i}
                  className="absolute rounded px-2 py-0.5 font-mono text-[11px] font-semibold"
                  style={{
                    left: l as string, top: t as string,
                    background: hot ? 'var(--text)' : 'var(--pass)',
                    color: 'var(--ink)',
                    outline: hot ? '2px solid var(--text)' : undefined,
                    outlineOffset: 2,
                  }}
                >
                  {label as string}
                </span>
              ))}
              <span className="prov absolute bottom-0 left-1/2 -translate-x-1/2" style={{ color: 'var(--mute)' }}>
                pins ⇄ cards share hover state
              </span>
            </div>
          </div>

          {/* coach mark (step 2 of 3 shown) */}
          {coach === 1 && (
            <div className="absolute bottom-16 right-4 z-20 w-60 rounded-xl border p-3 shadow-lg" style={{ background: 'var(--ink-panel)', borderColor: 'var(--line-hi)' }}>
              <p className="text-[13px] font-medium">See why an area prices the way it does</p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--haze)' }}>
                Layers → Rent $/sqft shades every block by observed rent.
              </p>
              <div className="mt-2.5 flex items-center justify-between">
                <span className="prov" style={{ color: 'var(--mute)' }}>2 of 3</span>
                <div className="flex gap-3 text-[12px] font-medium">
                  <button style={{ color: 'var(--mute)' }} onClick={() => setCoach(0)}>Skip</button>
                  <button style={{ color: 'var(--pass)' }} onClick={() => setCoach(0)}>Next</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile List|Map segmented (thumb zone) ─────────────────── */}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center lg:hidden">
        <div className="pointer-events-auto flex overflow-hidden rounded-full border shadow-lg" style={{ borderColor: 'var(--line-hi)', background: 'var(--ink-panel)' }}>
          {(['list', 'map'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setMobileTab(t)}
              className="px-6 py-2.5 text-[13px] font-semibold capitalize"
              style={mobileTab === t ? { background: 'var(--text)', color: 'var(--ink)' } : { color: 'var(--haze)' }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
