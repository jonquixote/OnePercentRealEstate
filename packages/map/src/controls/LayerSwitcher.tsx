'use client';

// Collapsed FAB → panel of overlay toggles with legend + opacity sliders.
// Availability-gated entries render disabled with a "data loading" hint.
import { useState } from 'react';
import type { LayerToggle } from '../layers/registry';

export interface LayerSwitcherProps {
  toggles: LayerToggle[];
  /** Optional extra content (e.g. tract metric mode select) per layer id. */
  extras?: Record<string, React.ReactNode>;
}

export function LayerSwitcher({ toggles, extras }: LayerSwitcherProps) {
  const [open, setOpen] = useState(false);
  const activeCount = toggles.filter((t) => t.on && t.available).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium backdrop-blur transition-colors hover:opacity-90"
        style={{
          background: open || activeCount > 0 ? 'var(--pass)' : 'rgba(250,247,242,.92)',
          borderColor: open || activeCount > 0 ? 'var(--pass)' : 'var(--line)',
          color: open || activeCount > 0 ? 'var(--ink)' : 'var(--text)',
        }}
        aria-expanded={open}
      >
        ▤ Layers{activeCount > 0 ? ` · ${activeCount}` : ''}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-2 w-64 rounded-xl border p-3 shadow-lg backdrop-blur"
          style={{ background: 'rgba(250,247,242,.97)', borderColor: 'var(--line)' }}
          role="group"
          aria-label="Map layers"
        >
          {toggles.map((t) => (
            <div key={t.def.id} className="border-b py-2 last:border-b-0" style={{ borderColor: 'var(--line)' }}>
              <label
                className="flex cursor-pointer items-center justify-between gap-2 text-[13px] font-medium"
                style={{ color: t.available === false ? 'var(--mute)' : 'var(--text)' }}
                title={t.available === false ? 'Data not loaded yet — coming soon' : undefined}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.on && t.available === true}
                    disabled={t.available !== true}
                    onChange={(e) => t.set(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--pass)]"
                  />
                  {t.def.label}
                </span>
                {t.available === false && <span className="text-[10px] uppercase tracking-wide">soon</span>}
                {t.available === null && <span className="text-[10px]">…</span>}
              </label>

              {t.on && t.available === true && (
                <div className="mt-1.5 pl-5">
                  {/* legend */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {t.def.legend.map((l) => (
                      <span key={l.label} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--haze)' }}>
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
                        {l.label}
                      </span>
                    ))}
                  </div>
                  {/* opacity */}
                  {t.def.setOpacity && (
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={t.opacity}
                      onChange={(e) => t.setOpacity(Number(e.target.value))}
                      className="mt-1.5 w-full accent-[var(--pass)]"
                      aria-label={`${t.def.label} opacity`}
                    />
                  )}
                  {extras?.[t.def.id]}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
