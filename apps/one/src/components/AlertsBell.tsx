'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { usePrefs } from '@/lib/prefs';

interface AlertRow {
  id: number;
  listing_id: number;
  source: 'area' | 'watchlist';
  source_label: string;
  ratio: string | number | null;
  price: string | number | null;
  created_at: string;
  read_at: string | null;
  address: string | null;
  primary_photo: string | null;
  property_url: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtRatio(r: string | number | null): string {
  if (r == null) return '—';
  const n = typeof r === 'number' ? r : Number(r);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function propertyHref(row: AlertRow): string {
  // Deal pages live at /property/[listing_id]; property_url is the offsite source.
  return `/property/${row.listing_id}`;
}

export default function AlertsBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { prefs } = usePrefs();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data.alerts ?? []);
      setUnread(Number(data.unread ?? 0));
    } catch {
      /* polling is best-effort */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = useCallback(async (ids: number[]) => {
    setUnread((u) => Math.max(0, u - ids.length));
    setAlerts((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, read_at: new Date().toISOString() } : a)));
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      /* optimistic; server is source of truth on next poll */
    }
  }, []);

  const onRowClick = (row: AlertRow) => {
    setOpen(false);
    if (!row.read_at) void markRead([row.id]);
  };

  const onMarkAll = async () => {
    const ids = alerts.filter((a) => !a.read_at).map((a) => a.id);
    if (ids.length === 0) return;
    await markRead(ids);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Deal alerts${unread > 0 ? `, ${unread} unread` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-haze transition-colors hover:bg-ink-2 hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brass px-1 text-[10px] font-bold leading-none text-ink"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Deal alerts"
          className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-card/95 shadow-[var(--shadow-pop)] backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Deal alerts</span>
            <button
              type="button"
              onClick={onMarkAll}
              disabled={unread === 0}
              className="flex items-center gap-1 text-[12px] font-medium text-brass-hi transition-colors hover:text-brass disabled:cursor-default disabled:text-mute"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] leading-relaxed text-mute">
                {!prefs.onboarded ? (
                  <>
                    Alerts land here when a deal clears the line in your areas.{' '}
                    <Link href="/welcome" className="font-semibold text-pass transition-colors hover:text-pass-hi">
                      Pick your areas →
                    </Link>
                  </>
                ) : (
                  'Alerts land here when a deal clears the line in your areas.'
                )}
              </p>
            ) : (
              alerts.map((row) => {
                const label = row.address || [row.city, row.state].filter(Boolean).join(', ') || 'Untitled property';
                return (
                  <Link
                    key={row.id}
                    href={propertyHref(row)}
                    onClick={() => onRowClick(row)}
                    className={`flex items-start gap-3 border-b border-line/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-ink-2 ${
                      row.read_at ? 'opacity-60' : ''
                    }`}
                  >
                    <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-brass" aria-hidden={!!row.read_at} style={{ visibility: row.read_at ? 'hidden' : 'visible' }} />
                    <span className="flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
                        <span className="flex-shrink-0 text-[11px] text-mute">{timeAgo(row.created_at)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[12px] text-haze">
                        <span className="figure figure--pass">{fmtRatio(row.ratio)}</span>
                        <span aria-hidden className="text-mute">·</span>
                        <span className="truncate">{row.source_label}</span>
                      </span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
