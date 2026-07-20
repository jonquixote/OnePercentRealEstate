'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { METROS } from '@/lib/metros';
import { DEFAULT_PREFS, type InvestorPrefs } from '@/lib/prefs-shared';

type SelectedArea = { label: string; zip: string; city?: string; state?: string };

function NumField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-haze mb-1 block">{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="w-full rounded-xl border border-line bg-ink-2 px-3 py-2 text-sm tabular-nums outline-none focus:border-pass/50"
      />
    </label>
  );
}

export function WizardSteps({
  prefs,
  save,
}: {
  prefs: InvestorPrefs;
  save: (p: InvestorPrefs) => Promise<boolean>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedAreas, setSelectedAreas] = useState<SelectedArea[]>(prefs.areas ?? []);
  const [alertOptIn, setAlertOptIn] = useState<boolean>(prefs.alertOptIn === true);
  const [ratePct, setRatePct] = useState<number>(prefs.financing?.ratePct ?? DEFAULT_PREFS.financing.ratePct);
  const [downPct, setDownPct] = useState<number>(prefs.financing?.downPct ?? DEFAULT_PREFS.financing.downPct);

  function toggleArea(m: (typeof METROS)[number]) {
    setSelectedAreas((cur) =>
      cur.some((a) => a.zip === m.zip)
        ? cur.filter((a) => a.zip !== m.zip)
        : [...cur, { label: m.label, zip: m.zip, city: m.city, state: m.state }],
    );
  }

  async function finish(onboardedPrefs: Partial<InvestorPrefs>) {
    try {
      const success = await save({
        ...prefs,
        financing: {
          ...(prefs.financing ?? DEFAULT_PREFS.financing),
          ratePct,
          downPct,
        },
        areas: selectedAreas,
        alertOptIn,
        ...onboardedPrefs,
        onboarded: true,
      });
      if (success) {
        router.push('/search');
      }
    } catch (err) {
      console.error('Failed to save preferences', err);
    }
  }

  if (step === 1) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-2">Where do you invest?</h1>
        <p className="text-haze mb-4 text-sm">Pick the metros you want instant deals in.</p>
        <div className="flex flex-wrap gap-2">
          {METROS.map((m) => {
            const active = selectedAreas.some((a) => a.zip === m.zip);
            return (
              <button
                key={m.zip}
                onClick={() => toggleArea(m)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active ? 'border-pass text-pass bg-pass/10' : 'border-line text-haze hover:text-foreground'
                }`}
              >
                {active ? '✓ ' : '+ '}
                {m.label}
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() => setStep(2)}
            className="rounded-full bg-pass px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Next
          </button>
          <button onClick={() => finish({})} className="text-xs text-haze hover:text-pass hover:underline">
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-2">Your financing</h1>
        <p className="text-haze mb-4 text-sm">Defaults are fine — change them anytime in prefs.</p>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Rate %" value={ratePct} step={0.1} onChange={setRatePct} />
          <NumField label="Down %" value={downPct} step={1} onChange={setDownPct} />
        </div>
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={() => setStep(3)}
            className="rounded-full bg-pass px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Next
          </button>
          <button onClick={() => finish({})} className="text-xs text-haze hover:text-pass hover:underline">
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Instant deal alerts</h1>
      <label className="mt-4 flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={alertOptIn} onChange={(e) => setAlertOptIn(e.target.checked)} className="h-4 w-4" />
        <span className="text-sm">Email me instant deals when a property clears the line in my areas.</span>
      </label>
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={() => finish({})}
          className="rounded-full bg-pass px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Finish
        </button>
        <button onClick={() => finish({})} className="text-xs text-haze hover:text-pass hover:underline">
          Skip for now
        </button>
      </div>
    </div>
  );
}
