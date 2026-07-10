'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Heart, ExternalLink, Share2 } from 'lucide-react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

interface Props {
  id: string;
  address: string;
  price: number | null;
  propertyUrl?: string | null;
}

export default function MenuHeader({ id, address, price, propertyUrl }: Props) {
  const [watched, setWatched] = useState(false);
  const [savingWatch, setSavingWatch] = useState(false);

  useEffect(() => {
    fetch('/api/watchlists')
      .then(r => r.ok ? r.json() : [])
      .then((list) => {
        if (Array.isArray(list) && list.some((w: { name: string }) => w.name === `Property: ${address}`)) setWatched(true);
      })
      .catch(() => {});
  }, [address]);

  const toggleWatch = async () => {
    setSavingWatch(true);
    try {
      if (watched) {
        await fetch('/api/watchlists', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Property: ${address}` }),
        });
        setWatched(false);
      } else {
        await fetch('/api/watchlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Property: ${address}`, type: 'listing', refId: id }),
        });
        setWatched(true);
      }
    } catch { /* silent */ }
    setSavingWatch(false);
  };

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
        <div className="flex items-center gap-3">
          <button
            onClick={toggleWatch}
            disabled={savingWatch}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              watched
                ? 'border-pass text-pass bg-pass/10'
                : 'border-line text-haze hover:text-foreground hover:border-foreground'
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${watched ? 'fill-pass' : ''}`} />
            {watched ? 'Watched' : 'Watch'}
          </button>
          {propertyUrl && (
            <a
              href={propertyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-haze hover:text-foreground hover:border-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Source
            </a>
          )}
          <button
            onClick={copyShare}
            className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-haze hover:text-foreground hover:border-foreground transition-colors"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
