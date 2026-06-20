import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ArrowRight,
  ArrowUpRight,
  TrendingUp,
  MapPin,
  Sliders,
  Plus,
  Minus,
} from "lucide-react";

/**
 * OnePercent — re-envisioned home page (prototype)
 *
 * Thesis: the product underwrites listings against the 1% rule, so the hero
 * IS the underwriting. The signature element — "the line" — is the 1.00%
 * rent/price threshold, drawn literally. Deals that clear it glow; deals below
 * it sit in brass. The same line motif recurs as the market distribution and
 * as a per-deal gauge, so the brand's one memorable image teaches the metric
 * and sells the tool at the same time.
 *
 * Stack-faithful: keeps Geist Sans / Geist Mono and an emerald=pass palette so
 * this drops onto the real Next.js + Tailwind app. Data here is placeholder and
 * matches the real /api/stats and /api/featured shapes.
 */

/* ---------- design tokens ---------- */
const C = {
  ink: "#0B1220",
  ink2: "#111A2B",
  inkPanel: "#0E1626",
  paper: "#FAF9F6",
  paper2: "#F3F1EB",
  text: "#172033",
  muted: "#5C677A",
  mutedDk: "#8A93A6",
  line: "rgba(23,32,51,0.10)",
  lineDk: "rgba(255,255,255,0.09)",
  pass: "#0E9F6E",
  passHi: "#34E0A1",
  brass: "#A9761F",
  brassHi: "#D8A24A",
};

const SANS = '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';

/* ---------- seeded data (deterministic, right-skewed ratios) ---------- */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRatios(n, seed) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    // skewed toward ~0.55%, thin tail past 1.0%
    const base = (rnd() + rnd() + rnd()) / 3; // ~normal 0..1
    const skew = Math.pow(rnd(), 1.7); // pull low
    const r = 0.26 + base * 0.9 + skew * 0.55;
    out.push(Math.min(1.74, r));
  }
  return out;
}

const STATS = { total: 4612, clears: 312, medianPct: 0.62, markets: 50 };

const DEALS = [
  {
    id: "1",
    address: "4417 Wyandotte St",
    city: "Kansas City",
    state: "MO",
    price: 168000,
    rent: 1850,
    ratio: 1.1,
    cashflow: 430,
    beds: 3,
    baths: 2,
    sqft: 1240,
    hue: 158,
  },
  {
    id: "2",
    address: "2208 Hawthorne Ave",
    city: "Cleveland",
    state: "OH",
    price: 129900,
    rent: 1495,
    ratio: 1.15,
    cashflow: 392,
    beds: 3,
    baths: 1,
    sqft: 1180,
    hue: 196,
  },
  {
    id: "3",
    address: "812 E Indiana St",
    city: "Memphis",
    state: "TN",
    price: 147500,
    rent: 1725,
    ratio: 1.17,
    cashflow: 455,
    beds: 4,
    baths: 2,
    sqft: 1560,
    hue: 32,
  },
];

const FEED = [
  { addr: "915 Cherokee Dr", loc: "Indianapolis, IN", price: 142000, ratio: 1.21 },
  { addr: "330 Burns Ave", loc: "Dayton, OH", price: 118500, ratio: 1.14 },
  { addr: "77 Linwood St", loc: "Rochester, NY", price: 134900, ratio: 1.08 },
];

/* ---------- formatters ---------- */
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("en-US");

/* ---------- hooks ---------- */
function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return r;
}
function useInView(threshold = 0.3) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen];
}

/* ---------- shared bits ---------- */
function Eyebrow({ children, color = C.muted, style }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* Mini per-deal gauge: the 1% line drawn small, a mark for this deal's ratio. */
function RatioGauge({ ratio, dark = false, w = 96 }) {
  const min = 0.4;
  const max = 1.4;
  const x = (v) => ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (w - 8) + 4;
  const clears = ratio >= 1;
  const track = dark ? "rgba(255,255,255,0.16)" : "rgba(23,32,51,0.14)";
  const mark = clears ? C.pass : C.brass;
  return (
    <svg width={w} height={26} viewBox={`0 0 ${w} 26`} aria-hidden>
      <line x1="4" y1="18" x2={w - 4} y2="18" stroke={track} strokeWidth="1.5" />
      {/* the 1% line */}
      <line x1={x(1)} y1="6" x2={x(1)} y2="22" stroke={dark ? "rgba(255,255,255,0.4)" : "rgba(23,32,51,0.34)"} strokeWidth="1.25" strokeDasharray="2 2" />
      {/* deal mark */}
      <circle cx={x(ratio)} cy="18" r="4.5" fill={mark} />
      {clears && <circle cx={x(ratio)} cy="18" r="8" fill="none" stroke={mark} strokeOpacity="0.35" strokeWidth="1.5" />}
    </svg>
  );
}

/* ---------- HERO: the live tape ---------- */
function Tape({ reduced }) {
  const ratios = useMemo(() => makeRatios(150, 7), []);
  const [lit, setLit] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setLit(true), 240);
    return () => clearTimeout(t);
  }, [reduced]);

  const W = 520;
  const H = 280;
  const padL = 16;
  const padR = 16;
  const min = 0.2;
  const max = 1.75;
  const xOf = (v) => padL + ((v - min) / (max - min)) * (W - padL - padR);
  const lineX = xOf(1);

  // place marks with deterministic vertical jitter
  const rnd = mulberry32(99);
  const marks = ratios.map((r) => ({ r, y: 28 + rnd() * (H - 70) }));

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 16,
        border: `1px solid ${C.lineDk}`,
        background: `linear-gradient(180deg, ${C.inkPanel} 0%, ${C.ink2} 100%)`,
        overflow: "hidden",
        boxShadow: "0 30px 80px -40px rgba(0,0,0,0.8)",
      }}
    >
      {/* radial pass glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -40,
          top: -30,
          width: 320,
          height: 320,
          background: `radial-gradient(circle, ${C.pass}22 0%, transparent 65%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "16px 18px 6px" }}>
        <Eyebrow color={C.mutedDk}>Live ratio tape</Eyebrow>
        <Eyebrow color={C.mutedDk}>rent ÷ price</Eyebrow>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Listings plotted by rent-to-price ratio against the 1% line">
        {/* the line */}
        <line x1={lineX} y1="18" x2={lineX} y2={H - 34} stroke={C.passHi} strokeOpacity="0.55" strokeWidth="1.25" strokeDasharray="3 3" />
        <text x={lineX} y="14" fill={C.passHi} fontFamily={MONO} fontSize="11" textAnchor="middle" letterSpacing="0.05em">
          1.00%
        </text>

        {/* axis ticks */}
        {[0.4, 0.7, 1.0, 1.3, 1.6].map((t) => (
          <g key={t}>
            <line x1={xOf(t)} y1={H - 30} x2={xOf(t)} y2={H - 26} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            <text x={xOf(t)} y={H - 14} fill={C.mutedDk} fontFamily={MONO} fontSize="10" textAnchor="middle">
              {t.toFixed(1)}%
            </text>
          </g>
        ))}

        {/* marks */}
        {marks.map((m, i) => {
          const clears = m.r >= 1;
          const cx = xOf(m.r);
          const settledX = cx;
          const startX = lineX; // settle outward from the line
          const x = lit ? settledX : startX;
          return (
            <circle
              key={i}
              cx={x}
              cy={m.y}
              r={clears ? 3.1 : 2.2}
              fill={clears ? C.passHi : "rgba(216,162,74,0.55)"}
              opacity={lit ? (clears ? 0.95 : 0.5) : 0}
              style={{
                transition: reduced ? "none" : `cx 700ms cubic-bezier(.2,.7,.2,1) ${(i % 30) * 12}ms, opacity 500ms ease ${(i % 30) * 12}ms`,
              }}
            />
          );
        })}
      </svg>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px 16px",
          borderTop: `1px solid ${C.lineDk}`,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 99, background: C.passHi, boxShadow: `0 0 10px ${C.passHi}` }} />
        <span style={{ fontFamily: MONO, fontSize: 13, color: "#E7EBF2", fontVariantNumeric: "tabular-nums" }}>
          {num.format(STATS.clears)}
        </span>
        <span style={{ fontFamily: SANS, fontSize: 13, color: C.mutedDk }}>
          of {num.format(STATS.total)} listings clear the line
        </span>
      </div>
    </div>
  );
}

function Hero({ reduced }) {
  return (
    <section style={{ background: C.ink, color: "#fff", position: "relative", overflow: "hidden" }}>
      {/* faint grid */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.05,
          backgroundImage: "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(120% 100% at 30% 0%, black, transparent 75%)",
          WebkitMaskImage: "radial-gradient(120% 100% at 30% 0%, black, transparent 75%)",
        }}
      />
      <div className="mx-auto max-w-7xl px-6 lg:px-8" style={{ position: "relative" }}>
        <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 48, paddingTop: 72, paddingBottom: 72, alignItems: "center" }}>
          {/* left */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 99,
                border: `1px solid ${C.lineDk}`,
                background: "rgba(255,255,255,0.03)",
                padding: "5px 12px",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 99, background: C.passHi, boxShadow: `0 0 8px ${C.passHi}` }} />
              <Eyebrow color="#C7CEDC">Live MLS · {STATS.markets} markets · {num.format(STATS.total)} listings</Eyebrow>
            </div>

            <h1
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1.02,
                marginTop: 22,
                fontSize: "clamp(40px, 6vw, 68px)",
              }}
            >
              Underwrite less.
              <br />
              Buy what{" "}
              <span style={{ color: C.passHi }}>clears</span>.
            </h1>

            <p
              style={{
                fontFamily: SANS,
                marginTop: 20,
                maxWidth: 460,
                color: "#AEB6C6",
                fontSize: 17,
                lineHeight: 1.6,
              }}
            >
              Every U.S. listing scored on the 1% rule, cap rate, and monthly
              cashflow before you open it. The rent number is triangulated, not
              guessed — so the deal you see is the deal you can run.
            </p>

            {/* command search = primary action */}
            <SearchBar />

            <div style={{ display: "flex", gap: 22, marginTop: 18, flexWrap: "wrap" }}>
              <a href="#tool" style={miniLink}>
                Browse the map <ArrowRight size={15} />
              </a>
              <a href="#pulse" style={{ ...miniLink, color: "#AEB6C6" }}>
                See the market distribution
              </a>
            </div>
          </div>

          {/* right: the tape */}
          <div>
            <Tape reduced={reduced} />
          </div>
        </div>
      </div>

      {/* ticker */}
      <div style={{ borderTop: `1px solid ${C.lineDk}`, background: "rgba(255,255,255,0.015)" }}>
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 0 }}>
            {[
              ["Active listings", num.format(STATS.total), "#fff"],
              ["Clear the 1% line", num.format(STATS.clears), C.passHi],
              ["Median rent ÷ price", STATS.medianPct.toFixed(2) + "%", "#fff"],
              ["Markets covered", num.format(STATS.markets), "#fff"],
            ].map(([label, value, color], i) => (
              <div
                key={label}
                style={{
                  padding: "18px 4px",
                  borderLeft: i === 0 ? "none" : `1px solid ${C.lineDk}`,
                  paddingLeft: i === 0 ? 0 : 20,
                }}
              >
                <Eyebrow color={C.mutedDk}>{label}</Eyebrow>
                <div
                  style={{
                    fontFamily: MONO,
                    fontWeight: 600,
                    fontSize: 26,
                    marginTop: 6,
                    color,
                    fontVariantNumeric: "tabular-nums slashed-zero",
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const miniLink = {
  fontFamily: SANS,
  fontSize: 14,
  fontWeight: 600,
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  textDecoration: "none",
};

function SearchBar() {
  const [focus, setFocus] = useState(false);
  const [val, setVal] = useState("");
  return (
    <div
      style={{
        marginTop: 28,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        borderRadius: 12,
        padding: 6,
        maxWidth: 460,
        boxShadow: focus ? `0 0 0 3px ${C.pass}55` : "0 12px 30px -16px rgba(0,0,0,0.6)",
        transition: "box-shadow 160ms ease",
      }}
    >
      <Search size={18} color={C.muted} style={{ marginLeft: 8 }} />
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder="Search a city, ZIP, or address"
        aria-label="Search a city, ZIP, or address"
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          fontFamily: SANS,
          fontSize: 15,
          color: C.text,
          background: "transparent",
          padding: "8px 4px",
        }}
      />
      <button
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: C.ink,
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "10px 16px",
          fontFamily: SANS,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Score it
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

/* ---------- MARKET PULSE: the distribution ---------- */
function Pulse({ reduced }) {
  const [ref, seen] = useInView(0.35);
  const pop = useMemo(() => makeRatios(640, 21), []);
  const min = 0.2;
  const max = 1.75;
  const step = 0.1;
  const bins = [];
  for (let lo = min; lo < max; lo += step) bins.push({ lo, hi: lo + step, count: 0 });
  pop.forEach((r) => {
    const idx = Math.min(bins.length - 1, Math.floor((r - min) / step));
    if (idx >= 0) bins[idx].count++;
  });
  const peak = Math.max(...bins.map((b) => b.count));
  const [hover, setHover] = useState(null);
  const grow = seen || reduced;

  return (
    <section id="pulse" style={{ background: C.paper, borderTop: `1px solid ${C.line}` }}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8" style={{ paddingTop: 72, paddingBottom: 72 }} ref={ref}>
        <div className="grid grid-cols-1 lg:grid-cols-12" style={{ gap: 40, alignItems: "end" }}>
          <div className="lg:col-span-4">
            <Eyebrow color={C.brass}>Market pulse</Eyebrow>
            <h2
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                fontSize: "clamp(26px,3vw,36px)",
                color: C.text,
                marginTop: 10,
                lineHeight: 1.1,
              }}
            >
              Almost nothing clears.
              <br />
              That’s the edge.
            </h2>
            <p style={{ fontFamily: SANS, color: C.muted, fontSize: 15.5, lineHeight: 1.6, marginTop: 16, maxWidth: 380 }}>
              Most listings sit near {STATS.medianPct.toFixed(2)}% rent-to-price.
              The {num.format(STATS.clears)} that cross 1.00% are the only ones
              worth your time — and we surface them first.
            </p>
            <div style={{ display: "flex", gap: 20, marginTop: 22 }}>
              <Legend swatch={C.pass} label="Clears 1%" />
              <Legend swatch={C.brass} label="Below 1%" />
            </div>
          </div>

          {/* histogram */}
          <div className="lg:col-span-8" style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 230 }}>
              {bins.map((b, i) => {
                const clears = b.lo >= 1;
                const h = (b.count / peak) * 100;
                const isHover = hover === i;
                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", position: "relative", cursor: "default" }}
                  >
                    {isHover && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "100%",
                          left: "50%",
                          transform: "translateX(-50%)",
                          marginBottom: 8,
                          background: C.ink,
                          color: "#fff",
                          fontFamily: MONO,
                          fontSize: 11,
                          padding: "5px 8px",
                          borderRadius: 6,
                          whiteSpace: "nowrap",
                          zIndex: 5,
                        }}
                      >
                        {b.lo.toFixed(1)}–{b.hi.toFixed(1)}% · {b.count}
                      </div>
                    )}
                    <div
                      style={{
                        height: grow ? `${h}%` : "0%",
                        background: clears ? C.pass : "rgba(169,118,31,0.55)",
                        opacity: isHover ? 1 : clears ? 0.95 : 0.8,
                        borderRadius: "3px 3px 0 0",
                        transition: reduced ? "none" : `height 800ms cubic-bezier(.2,.7,.2,1) ${i * 18}ms`,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* baseline + the 1% line label */}
            <div style={{ height: 1, background: C.line, marginTop: 0 }} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <Eyebrow color={C.mutedDk}>0.2%</Eyebrow>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.pass, letterSpacing: "0.05em" }}>↑ 1.00% line</span>
              <Eyebrow color={C.mutedDk}>1.7%</Eyebrow>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
function Legend({ swatch, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: swatch }} />
      <span style={{ fontFamily: SANS, fontSize: 13, color: C.muted }}>{label}</span>
    </div>
  );
}

/* ---------- CLEARS THE LINE: featured deals ---------- */
function DealCard({ d }) {
  const [hover, setHover] = useState(false);
  return (
    <a
      href={`/property/${d.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        textDecoration: "none",
        borderRadius: 16,
        border: `1px solid ${C.line}`,
        background: "#fff",
        overflow: "hidden",
        transition: "transform 200ms ease, box-shadow 200ms ease",
        transform: hover ? "translateY(-3px)" : "none",
        boxShadow: hover ? "0 26px 50px -28px rgba(11,18,32,0.45)" : "0 1px 0 rgba(23,32,51,0.04)",
      }}
    >
      {/* duotone architectural panel stands in for primary_photo */}
      <div
        style={{
          position: "relative",
          height: 168,
          background: `linear-gradient(135deg, hsl(${d.hue} 38% 26%), hsl(${d.hue} 30% 14%))`,
        }}
      >
        <svg viewBox="0 0 400 168" width="100%" height="168" preserveAspectRatio="none" aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
          <g stroke="rgba(255,255,255,0.18)" strokeWidth="1" fill="none">
            <path d="M0 120 L120 70 L240 110 L400 60" />
            <path d="M40 168 L40 96 L96 70 L150 98 L150 168" />
            <path d="M210 168 L210 104 L270 78 L330 106 L330 168" />
          </g>
        </svg>
        <span
          style={{
            position: "absolute",
            left: 14,
            top: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: C.pass,
            color: "#fff",
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 9px",
            borderRadius: 99,
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 6px 16px -6px rgba(14,159,110,0.7)",
          }}
        >
          clears · {d.ratio.toFixed(2)}%
        </span>
      </div>

      <div style={{ padding: 16 }}>
        <Eyebrow color={C.mutedDk}>{d.city}, {d.state}</Eyebrow>
        <div style={{ fontFamily: SANS, fontWeight: 600, color: C.text, fontSize: 15.5, marginTop: 5 }}>{d.address}</div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 21, color: C.text, fontVariantNumeric: "tabular-nums" }}>
            {usd0.format(d.price)}
          </span>
          <span style={{ fontFamily: SANS, fontSize: 12.5, color: C.muted }}>
            {d.beds} bd · {d.baths} ba · {num.format(d.sqft)} sf
          </span>
        </div>

        <div style={{ height: 1, background: C.line, margin: "14px 0" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <Eyebrow color={C.mutedDk}>Cashflow</Eyebrow>
            <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 15, color: C.pass, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
              +{usd0.format(d.cashflow)}/mo
            </div>
          </div>
          <RatioGauge ratio={d.ratio} />
        </div>
      </div>
    </a>
  );
}

function Featured() {
  return (
    <section style={{ background: C.paper, borderTop: `1px solid ${C.line}` }}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8" style={{ paddingTop: 64, paddingBottom: 64 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <Eyebrow color={C.pass}>Clears the line</Eyebrow>
            <h2 style={{ fontFamily: SANS, fontWeight: 600, letterSpacing: "-0.02em", fontSize: "clamp(26px,3vw,34px)", color: C.text, marginTop: 10 }}>
              Deals worth running this week
            </h2>
          </div>
          <a href="#tool" style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: C.text, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            All {num.format(STATS.clears)} <ArrowRight size={15} />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 22, marginTop: 32 }}>
          {DEALS.map((d) => (
            <DealCard key={d.id} d={d} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- THE TOOL: scored map + ranked feed (schematic) ---------- */
function ToolTease() {
  const rnd = mulberry32(5);
  const pins = Array.from({ length: 13 }).map((_, i) => ({
    x: 8 + rnd() * 84,
    y: 12 + rnd() * 74,
    clears: rnd() > 0.62,
    r: 4 + rnd() * 4,
  }));
  return (
    <section id="tool" style={{ background: C.ink, color: "#fff", borderTop: `1px solid ${C.lineDk}` }}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8" style={{ paddingTop: 64, paddingBottom: 72 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <Eyebrow color={C.mutedDk}>The tool</Eyebrow>
            <h2 style={{ fontFamily: SANS, fontWeight: 600, letterSpacing: "-0.02em", fontSize: "clamp(26px,3vw,34px)", marginTop: 10 }}>
              Every deal on the map, ranked by what it returns
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["1% rule", "Cap rate", "Cashflow", "Type"].map((f) => (
              <span key={f} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${C.lineDk}`, borderRadius: 8, padding: "7px 11px", fontFamily: SANS, fontSize: 13, color: "#C7CEDC" }}>
                <Sliders size={13} /> {f}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12" style={{ gap: 20, marginTop: 28 }}>
          {/* map */}
          <div className="lg:col-span-7" style={{ position: "relative", borderRadius: 16, border: `1px solid ${C.lineDk}`, overflow: "hidden", minHeight: 360, background: C.ink2 }}>
            <svg viewBox="0 0 400 280" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-label="Schematic scored map" style={{ display: "block", minHeight: 360 }}>
              {/* abstract street grid */}
              <g stroke="rgba(255,255,255,0.06)" strokeWidth="1">
                {Array.from({ length: 9 }).map((_, i) => (
                  <line key={"h" + i} x1="0" y1={i * 32} x2="400" y2={i * 32} />
                ))}
                {Array.from({ length: 13 }).map((_, i) => (
                  <line key={"v" + i} x1={i * 32} y1="0" x2={i * 32} y2="280" />
                ))}
              </g>
              <g stroke="rgba(255,255,255,0.1)" strokeWidth="2" fill="none">
                <path d="M0 150 C 120 120, 200 200, 400 140" />
                <path d="M150 0 C 170 120, 110 180, 160 280" />
              </g>
              {/* pins */}
              {pins.map((p, i) => {
                const cx = (p.x / 100) * 400;
                const cy = (p.y / 100) * 280;
                const col = p.clears ? C.passHi : C.brassHi;
                return (
                  <g key={i}>
                    {p.clears && <circle cx={cx} cy={cy} r={p.r * 2.4} fill={col} opacity="0.12" />}
                    <circle cx={cx} cy={cy} r={p.r} fill={col} opacity={p.clears ? 0.95 : 0.6} />
                  </g>
                );
              })}
            </svg>
            <div style={{ position: "absolute", left: 14, top: 14, display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(11,18,32,0.7)", border: `1px solid ${C.lineDk}`, borderRadius: 8, padding: "7px 11px", backdropFilter: "blur(6px)" }}>
              <MapPin size={14} color={C.passHi} />
              <span style={{ fontFamily: MONO, fontSize: 12, color: "#E7EBF2" }}>{num.format(STATS.clears)} clearing nearby</span>
            </div>
          </div>

          {/* ranked feed */}
          <div className="lg:col-span-5" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {FEED.map((r, i) => (
              <a
                key={i}
                href="#"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  textDecoration: "none",
                  border: `1px solid ${C.lineDk}`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div>
                  <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 14.5, color: "#fff" }}>{r.addr}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11.5, color: C.mutedDk, marginTop: 3, letterSpacing: "0.04em" }}>{r.loc}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <RatioGauge ratio={r.ratio} dark w={80} />
                  <span style={{ fontFamily: MONO, fontSize: 14, color: "#fff", fontVariantNumeric: "tabular-nums", minWidth: 74, textAlign: "right" }}>
                    {usd0.format(r.price)}
                  </span>
                </div>
              </a>
            ))}
            <a
              href="#"
              style={{
                marginTop: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: C.pass,
                color: "#fff",
                borderRadius: 12,
                padding: "14px 16px",
                fontFamily: SANS,
                fontWeight: 600,
                fontSize: 15,
                textDecoration: "none",
              }}
            >
              Open the full map <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- chrome ---------- */
function Header() {
  return (
    <header style={{ background: C.ink, borderBottom: `1px solid ${C.lineDk}`, position: "sticky", top: 0, zIndex: 50 }}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: C.pass, color: "#fff", fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>1%</span>
          <span style={{ fontFamily: SANS, fontWeight: 600, color: "#fff", fontSize: 16, letterSpacing: "-0.01em" }}>OnePercent</span>
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: 28 }} className="hidden md:flex">
          {["Search", "Markets", "Analytics"].map((l) => (
            <a key={l} href="#" style={{ fontFamily: SANS, fontSize: 14, fontWeight: 500, color: "#C7CEDC", textDecoration: "none" }}>
              {l}
            </a>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href="#" style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, color: "#fff", textDecoration: "none" }} className="hidden sm:block">
            Sign in
          </a>
          <a
            href="#"
            style={{
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              color: C.ink,
              background: "#fff",
              borderRadius: 8,
              padding: "8px 14px",
              textDecoration: "none",
            }}
          >
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer style={{ background: C.ink, color: C.mutedDk, borderTop: `1px solid ${C.lineDk}` }}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8" style={{ paddingTop: 28, paddingBottom: 28 }}>
        <p style={{ fontFamily: SANS, fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>
          Rent estimates triangulated from{" "}
          <span style={{ fontFamily: MONO, color: "#C7CEDC" }}>HUD SAFMR</span>,{" "}
          <span style={{ fontFamily: MONO, color: "#C7CEDC" }}>scraped comps</span>, and{" "}
          <span style={{ fontFamily: MONO, color: "#C7CEDC" }}>ML</span>. Listing data via partner MLS feeds, refreshed every 30 minutes.
        </p>
      </div>
    </footer>
  );
}

/* ---------- page ---------- */
export default function OnePercentHome() {
  const reduced = useReducedMotion();
  return (
    <div style={{ background: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body { margin: 0; }
        a:focus-visible, input:focus-visible, button:focus-visible {
          outline: 2px solid ${C.passHi};
          outline-offset: 2px;
          border-radius: 6px;
        }
        ::selection { background: ${C.pass}; color: #fff; }
      `}</style>
      <Header />
      <Hero reduced={reduced} />
      <Pulse reduced={reduced} />
      <Featured />
      <ToolTease />
      <Footer />
    </div>
  );
}
