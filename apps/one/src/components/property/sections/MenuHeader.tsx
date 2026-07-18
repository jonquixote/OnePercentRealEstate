'use client';

import Link from 'next/link';
import { ExternalLink, Share2 } from 'lucide-react';
import SaveButton from '@/components/SaveButton';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Props {
  id: string;
  address: string;
  price: number | null;
  propertyUrl?: string | null;
}

export default function MenuHeader({ id, address, price, propertyUrl }: Props) {
  const copyShare = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
  };

  return (
    <div className="sticky top-[57px] z-40 border-b border-line bg-ink/85 backdrop-blur supports-[backdrop-filter]:bg-ink/70">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3 lg:px-8">
        <div className="flex items-center gap-4 min-w-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{address}</p>
            <p className="font-mono text-lg tabular-nums text-foreground">
              {price ? usd0.format(price) : 'Price unavailable'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SaveButton listingId={id} />
          {propertyUrl && (
            <a
              href={propertyUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open source listing"
              aria-label="Open source listing in new tab"
              className="flex items-center justify-center rounded-full border border-line w-9 h-9 text-haze hover:text-foreground hover:border-foreground transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={copyShare}
            title="Copy share link"
            aria-label="Copy share link to clipboard"
            className="flex items-center justify-center rounded-full border border-line w-9 h-9 text-haze hover:text-foreground hover:border-foreground transition-colors"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
