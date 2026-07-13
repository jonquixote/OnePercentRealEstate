export interface NavLink {
  href: string;
  label: string;
  group?: 'primary' | 'tools' | 'strategy' | 'account';
}

/**
 * The four jobs (IA.md §1). Exactly these earn primary header space; the
 * active route gets a 2px --pass segment sitting on the header hairline.
 * `Portfolio` is renamed `Shelf` (route /portfolio 301s to /shelf).
 */
export const PRIMARY_LINKS: NavLink[] = [
  { href: '/search', label: 'Search', group: 'primary' },
  { href: '/market', label: 'Markets', group: 'primary' },
  { href: '/shelf', label: 'Shelf', group: 'primary' },
  { href: '/playbook', label: 'Playbook', group: 'primary' },
];

/**
 * Secondary surfaces — reachable from the footer and the mobile sheet, never
 * primary nav. Pricing is handled separately as the single brass affordance.
 */
export const TOOL_LINKS: NavLink[] = [
  { href: '/calculator', label: 'Calculator', group: 'tools' },
  { href: '/comps', label: 'Comps', group: 'tools' },
  { href: '/analytics', label: 'Analytics', group: 'tools' },
];

export const STRATEGY_LINKS: NavLink[] = [
  { href: '/playbook/buy-hold', label: 'Buy & Hold', group: 'strategy' },
  { href: '/playbook/brrr', label: 'BRRRR', group: 'strategy' },
  { href: '/playbook/flip', label: 'Buy & Flip', group: 'strategy' },
  { href: '/playbook/str', label: 'Short-Term', group: 'strategy' },
];

/** Footer · Product column (the four destinations + Pricing + Terminal). */
export const FOOTER_PRODUCT: NavLink[] = [
  { href: '/search', label: 'Search' },
  { href: '/market', label: 'Markets' },
  { href: '/shelf', label: 'Shelf' },
  { href: '/playbook', label: 'Playbook' },
  { href: '/pricing', label: 'Pricing' },
  { href: 'https://two.octavo.press', label: 'Terminal ↗' },
];

/**
 * Footer · Markets column — top metros for SEO internal linking. Static for
 * now; a live query by listing count is a later polish pass.
 */
export const FOOTER_MARKETS: Array<{ label: string; href: string }> = [
  { label: 'Los Angeles', href: '/market/90004' },
  { label: 'Houston', href: '/market/77002' },
  { label: 'Atlanta', href: '/market/30310' },
  { label: 'Tampa', href: '/market/33604' },
  { label: 'Columbus', href: '/market/43206' },
  { label: 'Memphis', href: '/market/38106' },
  { label: 'Cleveland', href: '/market/44102' },
  { label: 'San Antonio', href: '/market/78201' },
];

/** Footer · Method column — playbook chapters + model explainer. */
export const FOOTER_METHOD: NavLink[] = [
  { href: '/playbook', label: 'The 1% rule' },
  { href: '/playbook/buy-hold', label: 'Buy & Hold' },
  { href: '/playbook/brrr', label: 'BRRRR' },
  { href: '/playbook/calculator', label: 'Deal calculator' },
  { href: '/playbook/model', label: 'How the model works' },
];

/** Routes whose active state maps onto a primary destination. */
export function isActivePrimary(pathname: string, href: string): boolean {
  if (href === '/search') return pathname === '/search';
  if (href === '/market') return pathname === '/market' || pathname.startsWith('/market/');
  if (href === '/shelf') return pathname === '/shelf';
  if (href === '/playbook') return (
    pathname === '/playbook' ||
    pathname.startsWith('/playbook/') ||
    pathname.startsWith('/strategy/')
  );
  return pathname === href;
}
