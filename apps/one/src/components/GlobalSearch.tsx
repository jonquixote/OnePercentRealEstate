'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Building2, Hash } from 'lucide-react';

interface Suggestion {
  label: string;
  type: 'city' | 'state' | 'zip' | 'neighborhood';
  context?: string;
}

interface Props {
  variant?: 'header' | 'hero';
  placeholder?: string;
  className?: string;
}

const TYPE_ICON: Record<Suggestion['type'], typeof MapPin> = {
  city: Building2,
  state: MapPin,
  zip: Hash,
  neighborhood: MapPin,
};

export default function GlobalSearch({ variant = 'header', placeholder, className = '' }: Props) {
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(query)}&limit=8`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(q), 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, fetchSuggestions]);

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const navigateTo = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setShowSuggestions(false);
    if (/^\d{5}$/.test(trimmed)) {
      router.push(`/market/${trimmed}`);
    } else {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      navigateTo(suggestions[activeIndex].label);
    } else {
      navigateTo(q);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  if (variant === 'hero') {
    return (
      <div ref={containerRef} className={`w-full max-w-2xl relative ${className}`}>
        <label className="block text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Search by city, state, or ZIP
        </label>
        <form onSubmit={onSubmit}>
          <div className="flex items-center gap-2 rounded-full border border-line bg-card px-5 py-3.5 shadow-sm focus-within:border-pass focus-within:ring-2 focus-within:ring-pass/20 transition">
            <Search className="h-5 w-5 text-haze" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setActiveIndex(-1); setShowSuggestions(true); }}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={onKeyDown}
              placeholder={placeholder ?? 'e.g. 90210 or Austin, TX'}
              className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-haze outline-none"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-autocomplete="list"
            />
            <button
              type="submit"
              className="rounded-full bg-pass text-white px-5 py-2 text-sm font-semibold hover:bg-pass-hi transition-colors"
            >
              Search
            </button>
          </div>
        </form>
        {showSuggestions && suggestions.length > 0 && (
          <ul
            role="listbox"
          className="absolute z-[60] mt-2 w-full rounded-xl border border-line bg-card shadow-lg overflow-hidden"
          >
            {suggestions.map((s, i) => {
              const Icon = TYPE_ICON[s.type];
              return (
                <li
                  key={`${s.label}-${s.type}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`flex items-center gap-3 px-4 py-2.5 text-[13px] cursor-pointer transition-colors ${
                    i === activeIndex ? 'bg-pass-dim text-pass-hi' : 'hover:bg-ink-2'
                  }`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => navigateTo(s.label)}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  <span className="font-medium">{s.label}</span>
                  {s.context && (
                    <span className="ml-auto text-[11px]" style={{ color: 'var(--mute)' }}>{s.context}</span>
                  )}
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--mute)' }}>{s.type}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-full border border-line bg-card/80 px-4 py-2.5 focus-within:border-pass focus-within:ring-2 focus-within:ring-pass/20 transition">
        <Search className="h-4 w-4 text-haze shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActiveIndex(-1); setShowSuggestions(true); }}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'City or ZIP'}
          className="w-36 bg-transparent text-sm text-foreground placeholder:text-haze outline-none lg:w-52"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-pass px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-pass-hi transition-colors"
        >
          Search
        </button>
      </form>
      {showSuggestions && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-[60] mt-2 w-full rounded-xl border border-line bg-card shadow-lg overflow-hidden"
        >
          {suggestions.map((s, i) => {
            const Icon = TYPE_ICON[s.type];
            return (
              <li
                key={`${s.label}-${s.type}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`flex items-center gap-3 px-4 py-2.5 text-[13px] cursor-pointer transition-colors ${
                  i === activeIndex ? 'bg-pass-dim text-pass-hi' : 'hover:bg-ink-2'
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => navigateTo(s.label)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                <span className="font-medium">{s.label}</span>
                {s.context && (
                  <span className="ml-auto text-[11px]" style={{ color: 'var(--mute)' }}>{s.context}</span>
                )}
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--mute)' }}>{s.type}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
