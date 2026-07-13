import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb trail with BreadcrumbList JSON-LD. Last item (no href) is the
 * current page and carries aria-current="page" (IA.md §2, plan N3).
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://one.octavo.press';
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.label,
      ...(it.href ? { item: new URL(it.href, baseUrl).href } : {}),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <span key={`${it.label}-${i}`} className="flex items-center gap-1.5">
              {it.href ? (
                <Link
                  href={it.href}
                  className={last ? 'text-foreground' : 'hover:underline text-haze'}
                  aria-current={last ? 'page' : undefined}
                >
                  {it.label}
                </Link>
              ) : (
                <span className="text-foreground" aria-current="page">{it.label}</span>
              )}
              {!last && <span aria-hidden className="text-mute">·</span>}
            </span>
          );
        })}
      </nav>
    </>
  );
}
