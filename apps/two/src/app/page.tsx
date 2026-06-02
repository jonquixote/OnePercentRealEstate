import { Button } from "@oper/primitives";

export default function HomePage() {
  return (
    <main className="min-h-screen p-8 font-mono">
      <header className="mb-12 border-b border-zinc-800 pb-4">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          two.octavo.press
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-100">
          Pro Terminal
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          placeholder — wave 6 lights this up
        </p>
      </header>

      <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-md border border-zinc-800 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Listings
          </p>
          <p className="mt-1 text-2xl tabular-nums text-zinc-100">
            1,243,891
          </p>
        </div>
        <div className="rounded-md border border-zinc-800 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            1% Rule pass
          </p>
          <p className="mt-1 text-2xl tabular-nums text-emerald-400">
            7.4%
          </p>
        </div>
        <div className="rounded-md border border-zinc-800 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Median cap rate
          </p>
          <p className="mt-1 text-2xl tabular-nums text-zinc-100">
            6.81%
          </p>
        </div>
      </section>

      <footer className="mt-12 flex items-center gap-3 text-sm text-zinc-500">
        <Button variant="outline" size="sm">
          Shared Button from @oper/primitives
        </Button>
        <span>monorepo wired ✓</span>
      </footer>
    </main>
  );
}
