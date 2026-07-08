'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

interface Props {
  variant?: 'header' | 'hero';
  placeholder?: string;
  className?: string;
}

export default function GlobalSearch({ variant = 'header', placeholder, className = '' }: Props) {
  const [q, setQ] = useState('');
  const router = useRouter();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = q.trim();
    if (!value) return;
    if (/^\d{5}$/.test(value)) {
      router.push(`/market/${value}`);
    } else {
      router.push(`/search?q=${encodeURIComponent(value)}`);
    }
  };

  if (variant === 'hero') {
    return (
      <form onSubmit={onSubmit} className={`w-full max-w-2xl ${className}`}>
        <label className="block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Search by city or ZIP
        </label>
        <div className="flex items-center gap-2 rounded-full border border-line bg-card px-5 py-3.5 shadow-sm focus-within:border-pass focus-within:ring-2 focus-within:ring-pass/20 transition">
          <Search className="h-5 w-5 text-haze" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder ?? 'e.g. 90210  or  Austin, TX'}
            className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-haze outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-pass text-white px-5 py-2 text-sm font-semibold hover:bg-pass-hi transition-colors"
          >
            Search
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`flex items-center gap-2 rounded-full border border-line bg-card/80 px-3 py-1.5 focus-within:border-pass transition ${className}`}>
      <Search className="h-4 w-4 text-haze" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? 'City or ZIP'}
        className="w-40 bg-transparent text-sm text-foreground placeholder:text-haze outline-none lg:w-56"
      />
    </form>
  );
}
