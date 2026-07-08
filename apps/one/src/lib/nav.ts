export interface NavLink {
  href: string;
  label: string;
  group?: 'primary' | 'tools' | 'strategy' | 'account';
}

export const PRIMARY_LINKS: NavLink[] = [
  { href: '/search', label: 'Search', group: 'primary' },
  { href: '/market', label: 'Markets', group: 'primary' },
  { href: '/analytics', label: 'Analytics', group: 'primary' },
  { href: '/pricing', label: 'Pricing', group: 'primary' },
];

export const TOOL_LINKS: NavLink[] = [
  { href: '/calculator', label: 'Calculator', group: 'tools' },
  { href: '/comps', label: 'Comps', group: 'tools' },
  { href: '/portfolio', label: 'Portfolio', group: 'tools' },
];

export const STRATEGY_LINKS: NavLink[] = [
  { href: '/playbook', label: 'The Playbook', group: 'strategy' },
  { href: '/strategy/buy-hold', label: 'Buy & Hold', group: 'strategy' },
  { href: '/strategy/brrrr', label: 'BRRRR', group: 'strategy' },
  { href: '/strategy/flip', label: 'Buy & Flip', group: 'strategy' },
  { href: '/strategy/str', label: 'Short-Term', group: 'strategy' },
];
