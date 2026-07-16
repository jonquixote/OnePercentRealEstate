import Link from "next/link";
import type { Metadata } from "next";
import { indexMetroBySlug } from "@/lib/index-metros";
import { getRankedSnapshots } from "@/lib/index-data";

// Render on demand — index_snapshots is absent at build time (migrations run
// after deploy), so static prerender / ISR generation would crash the build.
export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://one.octavo.press";

export const metadata: Metadata = {
  title: "The 1% Rule Index — where rentals still cash-flow",
  description:
    "A monthly ranking of U.S. metros by the share of for-sale listings whose estimated rent clears the 1% rule.",
  openGraph: {
    title: "The 1% Rule Index",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
  alternates: {
    canonical: `${SITE}/the-1-percent-index`,
  },
};

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export default async function IndexPage() {
  const { rows } = await getRankedSnapshots();

  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <p className="prov">OCTAVO · MONTHLY INDEX</p>
      <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-[var(--text)] sm:text-5xl">
        The 1% Rule Index
      </h1>
      <p style={{ color: "var(--haze)" }} className="mt-3 text-lg">
        Where rentals still cash-flow. Ranked by the share of for-sale listings
        whose estimated monthly rent clears the 1% rule.
      </p>

      <ol
        className="mt-8 divide-y"
        style={{ borderColor: "var(--line)" }}
      >
        {rows.map((r) => {
          const zip = indexMetroBySlug(r.metroSlug)?.repZip ?? "";
          const up = (r.momentum ?? 0) >= 0;
          return (
            <li key={r.metroSlug} className="flex items-center gap-4 py-4">
              <span
                className="w-8 shrink-0 text-right text-sm font-semibold"
                style={{ color: "var(--mute)" }}
              >
                {r.rank}
              </span>
              <Link
                href={`/search?zip=${zip}`}
                className="flex-1 text-lg font-semibold hover:underline"
                style={{ color: "var(--text)" }}
              >
                {r.metroLabel}
              </Link>
              <span
                className="text-sm font-medium"
                style={{ color: up ? "var(--pass)" : "var(--brass)" }}
              >
                {up ? "▲" : "▼"} {pct.format(Math.abs(r.momentum ?? 0))}
              </span>
              <span className="figure figure--pass w-20 text-right text-xl font-bold">
                {pct.format(r.pctClearing)}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="prov mt-8">
        Method: for each metro we estimate rent for every active for-sale listing
        and count those whose rent meets or exceeds 1% of list price. Higher is
        better.{" "}
        <Link href="/search" className="underline" style={{ color: "var(--brass)" }}>
          Browse all markets →
        </Link>
      </p>
    </main>
  );
}
