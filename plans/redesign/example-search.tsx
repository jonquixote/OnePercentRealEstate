/**
 * REDESIGN EXAMPLE — Search / browse ("the gallery and the map")
 * Self-contained, mock data, not wired.
 *
 * What changes vs today:
 *  - Filter chrome collapses into ONE pill toolbar (filters + watch + sort);
 *    active filters render as removable engraved chips, not a wall of
 *    controls.
 *  - Cards: photography-first in mats, ONE loud metric (ratio vs target),
 *    banded rent, brass cut chip when present. "Calculating…" spinner dies —
 *    non-rentables say what they are ("Land — not rentable"), pending rows
 *    say "estimate queued".
 *  - Map: split view w/ the CLICK FIXES designed in (22px invisible hit
 *    targets, brass = cut listings, selected halo, popover card with a
 *    real link to the dossier).
 */

const ROWS = [
  { id: 1, addr: '2847 Ellsworth Ave, Cleveland OH', price: 89_000, rent: 1_180, lo: 940, hi: 1_390, ratio: 1.33, target: 1.0, cut: 0.15, dom: 64, kind: 'ok' },
  { id: 2, addr: '414 Crescent Ct, Birmingham AL', price: 112_500, rent: 1_295, lo: 1_060, hi: 1_540, ratio: 1.15, target: 1.0, cut: null, dom: 21, kind: 'ok' },
  { id: 3, addr: 'Lot 14, County Rd 220, Ozark AR', price: 22_000, rent: null, lo: null, hi: null, ratio: null, target: null, cut: null, dom: 112, kind: 'land' },
  { id: 4, addr: '9 Palmetto Row, Augusta GA', price: 99_000, rent: null, lo: null, hi: null, ratio: null, target: 1.0, cut: 0.18, dom: 9, kind: 'pending' },
];

const money = (n: number) => `$${n.toLocaleString()}`;

export default function ExampleSearch() {
  return (
    <div style={{ background: 'var(--ink)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>

      {/* ── One pill toolbar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b px-6 py-3 backdrop-blur"
           style={{ background: 'rgba(11,13,16,.92)', borderColor: 'var(--line)' }}>
        <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto">
          <button className="rounded-full border px-4 py-1.5 text-[13px] font-medium"
                  style={{ borderColor: 'var(--line-hi)' }}>Filters</button>

          {/* Active filters as engraved, removable chips */}
          {['≤ $150k', '3+ bd', 'Clears the line', 'Price reduced'].map((c, i) => (
            <span key={c} className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px]"
                  style={{ background: i === 3 ? 'var(--brass-dim)' : 'var(--pass-dim)', color: i === 3 ? 'var(--brass-hi)' : 'var(--pass-hi)' }}>
              {c} <span style={{ color: 'var(--mute)' }}>×</span>
            </span>
          ))}

          <div className="ml-auto flex items-center gap-3">
            <select className="rounded-full border bg-transparent px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--line)' }}>
              <option>Rule · best</option><option>Biggest cut</option><option>Newest</option>
            </select>
            <button className="whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold"
                    style={{ background: 'var(--pass)', color: '#fff' }}>
              ⌂ Watch this search
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-2">

        {/* ── Gallery cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          {ROWS.map((p) => (
            <article key={p.id} className="group cursor-pointer">
              <div className="mat relative aspect-[4/3] transition-colors group-hover:border-[var(--line-hi)]">
                <div className="h-full w-full rounded-[6px] bg-[var(--ink-2)]" />
                {p.cut != null && (
                  <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold"
                        style={{ background: 'var(--brass)', color: '#0b0d10' }}>
                    −{Math.round(p.cut * 100)}%
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                {/* THE metric — honest in all three states */}
                {p.kind === 'ok' && p.ratio != null ? (
                  <span className={`figure text-[22px] ${p.ratio >= (p.target ?? 1) ? 'figure--pass' : ''}`}
                        style={p.ratio < (p.target ?? 1) ? { color: 'var(--haze)' } : undefined}>
                    {p.ratio.toFixed(2)}%
                  </span>
                ) : p.kind === 'land' ? (
                  <span className="prov">land · not rentable</span>
                ) : (
                  <span className="prov">estimate queued</span>
                )}
                <span className="figure text-[16px]">{money(p.price)}</span>
              </div>

              {p.rent != null && (
                <>
                  <div className="band mt-2.5">
                    <div className="band-fill" style={{ left: '15%', width: '58%' }} />
                    <div className="band-mark" style={{ left: '42%' }} />
                  </div>
                  <p className="mt-1.5 text-[12px]" style={{ color: 'var(--mute)' }}>
                    rent {money(p.rent)}/mo · range {money(p.lo!)}–{money(p.hi!)}
                  </p>
                </>
              )}

              <p className="mt-2 truncate text-[13px]" style={{ color: 'var(--haze)' }}>
                {p.addr} <span style={{ color: 'var(--mute)' }}>· {p.dom} DOM</span>
              </p>
            </article>
          ))}
        </div>

        {/* ── Map panel (design intent, annotated) ──────────────────────── */}
        <div className="relative hidden overflow-hidden rounded-[var(--r-panel)] border lg:block"
             style={{ borderColor: 'var(--line)', background: 'var(--ink-2)', minHeight: 560 }}>
          {/* Design notes rendered as legend for review: */}
          <div className="absolute left-4 top-4 space-y-2 rounded-[10px] p-4 text-[12px]"
               style={{ background: 'rgba(11,13,16,.9)', border: '1px solid var(--line)' }}>
            <p className="prov mb-2">map design intent</p>
            <p><span style={{ color: 'var(--pass-hi)' }}>●</span> listing (emerald, 6–11px + <b>22px invisible hit-target</b>)</p>
            <p><span style={{ color: 'var(--brass-hi)' }}>●</span> price-cut listing (brass — motivated pops on the map)</p>
            <p><span style={{ color: 'var(--text)' }}>◉</span> selected — 2px warm-white halo</p>
            <p style={{ color: 'var(--haze)' }}>basemap labels +2 lightness steps vs today (readable dark)</p>
            <p style={{ color: 'var(--haze)' }}>click → anchored mini-dossier card w/ photo, ratio, band, “open →”</p>
            <p style={{ color: 'var(--haze)' }}>cluster→point handoff verified at every zoom (no dead 12–14 gap)</p>
          </div>

          {/* Anchored mini-dossier (what a point click opens) */}
          <div className="absolute bottom-6 right-6 w-72 rounded-[12px] p-4"
               style={{ background: 'var(--ink-panel)', border: '1px solid var(--line-hi)', boxShadow: 'var(--shadow-pop)' }}>
            <div className="mat mb-3 aspect-[16/9]"><div className="h-full rounded-[6px] bg-[var(--ink-2)]" /></div>
            <div className="flex items-baseline justify-between">
              <span className="figure text-[18px] figure--pass">1.33%</span>
              <span className="figure text-[14px]">{money(89_000)}</span>
            </div>
            <div className="band mt-2"><div className="band-fill" style={{ left: '15%', width: '58%' }} /><div className="band-mark" style={{ left: '42%' }} /></div>
            <p className="mt-2 truncate text-[12px]" style={{ color: 'var(--haze)' }}>2847 Ellsworth Ave, Cleveland OH</p>
            <a className="mt-3 block text-center text-[13px] font-semibold" style={{ color: 'var(--pass-hi)' }}>Open the dossier →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
