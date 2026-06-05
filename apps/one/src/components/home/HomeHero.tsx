'use client';

import Link from 'next/link';
import { ArrowDown, Sparkles } from 'lucide-react';

interface HomeHeroProps {
  onCtaClick?: () => void;
}

/**
 * Landing-style hero for the consumer homepage.
 *
 * Premium-Zillow direction: photo-forward isn't possible without a
 * paid editorial budget, so we lean on typography, generous space, and
 * one signature financial sentence as the visual hook.
 */
export function HomeHero({ onCtaClick }: HomeHeroProps) {
  return (
    <section
      aria-labelledby="hero-headline"
      className="relative isolate overflow-hidden border-b border-slate-200/70 bg-gradient-to-br from-white via-white to-emerald-50/40"
    >
      {/* Subtle dot grid for texture. SVG inline so no extra request. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
        style={{
          backgroundImage:
            'radial-gradient(rgb(15 23 42) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="mx-auto max-w-7xl px-6 pt-16 pb-12 sm:pt-20 sm:pb-16 lg:px-8 lg:pt-24 lg:pb-20">
        <div className="mx-auto max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900">
            <Sparkles className="h-3.5 w-3.5" />
            Live MLS data · 50 markets · 4,600+ listings
          </div>

          <h1
            id="hero-headline"
            className="mt-6 text-balance text-4xl font-medium tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
          >
            Find the cashflow.
            <br className="hidden sm:inline" />{' '}
            <span className="text-emerald-700">Skip the spreadsheet.</span>
          </h1>

          <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Every listing scored on the 1% rule, cap rate, and monthly cashflow
            before you click. Triangulated rent from HUD SAFMR, scraped comps,
            and ML — so the number you see is the number that matters.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={onCtaClick}
              className="group inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10 transition hover:bg-slate-800 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              Browse opportunities
              <ArrowDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
            </button>

            <Link
              href="/analytics"
              className="text-sm font-semibold leading-6 text-slate-700 hover:text-slate-900"
            >
              See market analytics <span aria-hidden>→</span>
            </Link>
          </div>

          {/* Three vertical 'how it works' beats — keeps the hero tall on
              desktop without filling it with stock imagery. */}
          <dl className="mt-14 grid max-w-3xl grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
            {[
              {
                k: '1',
                t: 'Score',
                d: 'Triangulated rent · ML + HUD + scraped comps',
              },
              {
                k: '2',
                t: 'Filter',
                d: '1% rule · cap rate · cashflow · property type',
              },
              {
                k: '3',
                t: 'Compare',
                d: 'Side-by-side analysis up to 3 deals',
              },
            ].map((step) => (
              <div key={step.k} className="border-l-2 border-emerald-600/30 pl-4">
                <dt className="font-mono text-[11px] uppercase tracking-widest text-emerald-700">
                  Step {step.k}
                </dt>
                <dd className="mt-1 text-base font-semibold text-slate-900">
                  {step.t}
                </dd>
                <dd className="mt-1 text-sm leading-6 text-slate-600">
                  {step.d}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
