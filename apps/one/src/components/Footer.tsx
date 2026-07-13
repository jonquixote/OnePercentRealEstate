import Link from 'next/link';
import {
  FOOTER_PRODUCT,
  FOOTER_MARKETS,
  FOOTER_METHOD,
  type NavLink,
} from '@/lib/nav';

function FooterLink({ link }: { link: NavLink }) {
  const external = link.href.startsWith('http');
  const cls = 'hover:underline text-haze';
  if (external) {
    return (
      <li>
        <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>
          {link.label}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link href={link.href} className={cls}>
        {link.label}
      </Link>
    </li>
  );
}

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-14 sm:grid-cols-3 lg:px-8">
        <div>
          <p className="prov mb-4 text-mute">product</p>
          <ul className="space-y-2.5 text-[13px]">
            {FOOTER_PRODUCT.map((l) => (
              <FooterLink key={l.href} link={l} />
            ))}
          </ul>
        </div>
        <div>
          <p className="prov mb-4 text-mute">markets</p>
          <ul className="space-y-2.5 text-[13px]">
            {FOOTER_MARKETS.map((m) => (
              <li key={m.href}>
                <Link href={m.href} className="hover:underline text-haze">
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="prov mb-4 text-mute">method</p>
          <ul className="space-y-2.5 text-[13px]">
            {FOOTER_METHOD.map((l) => (
              <FooterLink key={l.href} link={l} />
            ))}
          </ul>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-line px-6 py-5 text-[11px] text-mute lg:px-8">
        <span>© 2026 OnePercent · Estimates carry bands, never promises.</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-px w-6 bg-pass" />
          the line
        </span>
      </div>
    </footer>
  );
}
