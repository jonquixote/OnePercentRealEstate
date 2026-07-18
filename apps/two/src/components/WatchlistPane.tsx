'use client';

import * as React from 'react';
import { X, ListFilter } from 'lucide-react';

interface Watchlist {
  id: number;
  name: string;
  query_json: Record<string, unknown>;
}

// Columns that take a quoted string value in query-lang (everything else is
// numeric and rendered bare). Mirrors the worker's validateWatchlistColumn.
const STRING_COLUMNS = new Set([
  'state',
  'city',
  'zip_code',
  'sale_type',
  'property_type',
]);

function fmtValue(col: string, v: unknown): string {
  if (typeof v === 'string') {
    return STRING_COLUMNS.has(col) ? `'${v.replace(/'/g, "''")}'` : v;
  }
  return String(v);
}

/**
 * Serialize a watchlist's `query_json` criteria into the query-lang expression
 * the FilterExpression bar consumes (`two:filter-change`).
 *
 * GAP: query_json is a structured criteria map (scalar = equality, array = IN,
 * {min,max} = range), whereas the bar expects the flat query-lang text that
 * `compileWatchlistQuery` in the worker produces server-side. This is a
 * best-effort client serialization of the same shape; the worker remains the
 * authoritative compiler for matching. Round-tripping complex/nested criteria
 * exactly is out of scope — only scalar / IN / range are handled.
 */
function queryJsonToExpression(q: Record<string, unknown>): string {
  const clauses: string[] = [];
  for (const [key, value] of Object.entries(q ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      clauses.push(`${key} in (${value.map((v) => fmtValue(key, v)).join(', ')})`);
    } else if (typeof value === 'object') {
      const r = value as Record<string, unknown>;
      if (r.min !== undefined) clauses.push(`${key} >= ${fmtValue(key, r.min)}`);
      if (r.max !== undefined) clauses.push(`${key} <= ${fmtValue(key, r.max)}`);
    } else {
      clauses.push(STRING_COLUMNS.has(key) ? `${key} = ${fmtValue(key, value)}` : `${key} = ${fmtValue(key, value)}`);
    }
  }
  return clauses.join(' AND ');
}

interface WatchlistPaneProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Collapsible side pane listing the user's watchlists (served by apps/one at
 * /api/watchlists; two's nginx proxies that path). Clicking a watchlist loads
 * its criteria into the FilterExpression bar by dispatching `two:filter-change`
 * — the same channel the bar emits on edit (TerminalClient already listens).
 */
export function WatchlistPane({ open, onClose }: WatchlistPaneProps) {
  const [lists, setLists] = React.useState<Watchlist[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/watchlists', { cache: 'no-store' });
        if (!res.ok) {
          setErr(res.status === 401 ? 'Log in to see watchlists' : 'Failed to load watchlists');
          return;
        }
        const data = await res.json();
        if (alive) setLists(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setErr('Failed to load watchlists');
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const apply = (wl: Watchlist) => {
    const expr = queryJsonToExpression(wl.query_json ?? {});
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('two:filter-change', { detail: { expression: expr } }));
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-800/60 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
          Watchlists
        </span>
        <button
          type="button"
          aria-label="Close watchlist pane"
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {err ? (
          <p className="px-3 py-4 font-mono text-[11px] text-zinc-500">{err}</p>
        ) : lists.length === 0 ? (
          <p className="px-3 py-4 font-mono text-[11px] leading-relaxed text-zinc-600">
            No watchlists yet. Create saved searches in OnePercent to filter this terminal.
          </p>
        ) : (
          lists.map((wl) => (
            <button
              key={wl.id}
              type="button"
              onClick={() => apply(wl)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[12px] text-zinc-300 transition-colors hover:bg-zinc-900/60"
            >
              <ListFilter className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              <span className="truncate">{wl.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
