'use client';

// ⌘K command palette (D2). Zero new dependencies: a focused listbox over
// three sources — location search (the GlobalSearch suggest API), nav
// commands, and map actions dispatched over a window CustomEvent that the
// map subscribes to. Full keyboard: arrows, enter, esc, focus trap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHotkey } from '@oper/primitives/hotkeys';

interface Item {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Suggestion {
  label?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  id?: string | number;
  type?: string;
}

export function dispatchMapAction(action: string, value?: string) {
  window.dispatchEvent(new CustomEvent('oper:map', { detail: { action, value } }));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useHotkey('cmd+k', () => setOpen((o) => !o));

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setSuggestions([]);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Location suggestions from the existing search API.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(q)}&limit=6`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          setSuggestions(Array.isArray(json) ? json : (json.suggestions ?? json.items ?? []));
        }
      } catch {
        setSuggestions([]);
      }
    }, 180);
  }, [q, open]);

  const close = useCallback(() => setOpen(false), []);

  const commands: Item[] = [
    { id: 'nav-search', label: 'Go to Search & Map', hint: 'nav', run: () => router.push('/search') },
    { id: 'nav-compare', label: 'Open Compare', hint: 'nav', run: () => router.push('/compare') },
    { id: 'nav-home', label: 'Go to Dashboard', hint: 'nav', run: () => router.push('/') },
    { id: 'map-rent-heat', label: 'Toggle rent $/sqft layer', hint: 'map', run: () => dispatchMapAction('toggle-layer', 'rent-heat') },
    { id: 'map-tracts', label: 'Toggle tract context layer', hint: 'map', run: () => dispatchMapAction('toggle-layer', 'tracts') },
    { id: 'map-satellite', label: 'Satellite view', hint: 'map', run: () => dispatchMapAction('basemap', 'satellite') },
    { id: 'map-vector', label: 'Map view', hint: 'map', run: () => dispatchMapAction('basemap', 'positron') },
  ];

  const ql = q.trim().toLowerCase();
  const filteredCommands = ql
    ? commands.filter((c) => c.label.toLowerCase().includes(ql))
    : commands;

  const suggestionItems: Item[] = suggestions.slice(0, 6).map((s, i) => {
    const label = s.label ?? s.address ?? [s.city, s.state, s.zip].filter(Boolean).join(', ');
    return {
      id: `sugg-${i}`,
      label: label || 'result',
      hint: s.type ?? 'place',
      run: () => {
        if (s.id != null && (s.type === 'property' || s.address)) router.push(`/property/${s.id}`);
        else if (s.zip || /^\d{5}$/.test(label)) router.push(`/search?q=${encodeURIComponent(s.zip ?? label)}`);
        else router.push(`/search?q=${encodeURIComponent(label)}`);
      },
    };
  });

  const items = [...suggestionItems, ...filteredCommands];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) {
        item.run();
        close();
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      style={{ background: 'rgba(42,37,32,.35)' }}
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl"
        style={{ background: 'var(--ink-panel)', borderColor: 'var(--line-hi)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search address, city, ZIP — or type a command…"
          className="w-full border-b bg-transparent px-5 py-4 text-[15px] outline-none"
          style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
        />
        <ul id="cmdk-list" role="listbox" className="max-h-[40vh] overflow-y-auto py-2">
          {items.length === 0 && (
            <li className="px-5 py-3 text-[13px]" style={{ color: 'var(--mute)' }}>
              Nothing matches — try an address, city, or ZIP.
            </li>
          )}
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`cmdk-${item.id}`}
              role="option"
              aria-selected={i === active}
              className="flex cursor-pointer items-center justify-between px-5 py-2.5 text-[14px]"
              style={i === active ? { background: 'var(--pass-dim)', color: 'var(--pass-hi)' } : { color: 'var(--text)' }}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                item.run();
                close();
              }}
            >
              <span className="truncate">{item.label}</span>
              {item.hint && (
                <span className="prov ml-3 shrink-0" style={{ color: 'var(--mute)' }}>
                  {item.hint}
                </span>
              )}
            </li>
          ))}
        </ul>
        <div
          className="flex items-center gap-3 border-t px-5 py-2 text-[11px]"
          style={{ borderColor: 'var(--line)', color: 'var(--mute)' }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
