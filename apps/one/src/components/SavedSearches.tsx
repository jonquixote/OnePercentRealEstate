'use client';

/**
 * Saved searches popover for the dashboard. Replaces the inline `Save Search`
 * window.prompt with a richer panel: list existing searches, restore one to
 * the URL filter state, save the current filters as a named search, delete
 * a search.
 *
 * Auth note: there is no real user identity yet. We mint a UUID on first
 * render and persist it in `localStorage` under `oper:user_id`, then pass
 * it via `?user_id=…` to the API. When Wave 8 lands real session auth, drop
 * the localStorage hook and pull `user_id` from the session — the API route
 * already prefers `x-user-id` header / authenticated session over the query
 * param, so the swap is one-sided.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save, Trash2, RotateCcw, X } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import {
  useDeleteSavedSearch,
  useSaveSearch,
  useSavedSearches,
  useToggleDigest,
  type SavedSearch,
} from '@oper/api-client';
import { Button } from '@/components/ui/button';
import {
  propertyFilterParsers,
  toFilterState,
} from '@/components/PropertyFilters';
import { useSessionUser } from '@/lib/useSessionUser';

const USER_ID_STORAGE_KEY = 'oper:user_id';

function generateUuid(): string {
  // Prefer the platform UUID when available (modern browsers + Node 19+).
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for older runtimes.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function useLocalUserId(): string | null {
  // Prefer the real account id when a session exists; fall back to the
  // anonymous localStorage UUID otherwise. This is what makes saved searches
  // claimed on login instantly visible to the same browser.
  const session = useSessionUser();
  const [anonId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
      if (existing) return existing;
      const fresh = generateUuid();
      window.localStorage.setItem(USER_ID_STORAGE_KEY, fresh);
      return fresh;
    } catch {
      // Private browsing / storage disabled — ephemeral id so the UI works.
      return generateUuid();
    }
  });
  return session?.id ?? anonId;
}

/** Best-effort count of "non-default" filters in a saved params blob. */
function countActiveFilters(params: Record<string, unknown>): number {
  const defaults: Record<string, unknown> = {
    minPrice: 0,
    maxPrice: 2000000,
    minBeds: 0,
    minBaths: 0,
    onlyOnePercentRule: false,
    minCapRate: 0,
    minCashOnCash: 0,
    propertyType: '',
    showSold: false,
    sortBy: 'newest',
  };
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (!(k in defaults)) {
      if (v != null && v !== '' && v !== false) n += 1;
      continue;
    }
    if (defaults[k] !== v) n += 1;
  }
  return n;
}

/** Convert a saved `params` blob back into the nuqs URL state shape. */
function paramsToQuerystate(
  params: Record<string, unknown>,
): Partial<Record<keyof typeof propertyFilterParsers, unknown>> {
  return {
    sold: Boolean(params.showSold),
    pmin: Number(params.minPrice ?? 0),
    pmax: Number(params.maxPrice ?? 2000000),
    beds: Number(params.minBeds ?? 0),
    baths: Number(params.minBaths ?? 0),
    op: Boolean(params.onlyOnePercentRule),
    cap: Number(params.minCapRate ?? 0),
    coc: Number(params.minCashOnCash ?? 0),
    type: typeof params.propertyType === 'string' ? params.propertyType : '',
    sale: typeof params.saleType === 'string' ? params.saleType : '',
    strat: typeof params.strategy === 'string' ? params.strategy : 'buy_hold',
  };
}

export function SavedSearches() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const userId = useLocalUserId();

  const [qs, setQs] = useQueryStates(propertyFilterParsers, {
    history: 'replace',
    shallow: true,
    clearOnDefault: true,
  });
  const currentFilters = useMemo(() => toFilterState(qs), [qs]);

  const {
    data: searches = [],
    isLoading,
    isError,
  } = useSavedSearches(userId);
  const saveMutation = useSaveSearch();
  const deleteMutation = useDeleteSavedSearch();
  const toggleDigestMutation = useToggleDigest();
  const session = useSessionUser();
  const sessionEmail = session?.email ?? null;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !userId) return;
    try {
      await saveMutation.mutateAsync({
        user_id: userId,
        name: trimmed,
        params: {
          ...currentFilters,
        },
      });
      setName('');
    } catch (err) {
      // Surface error inline; toast lives at page level so keep this quiet.
      // eslint-disable-next-line no-console
      console.error('Failed to save search:', err);
    }
  }, [currentFilters, name, saveMutation, userId]);

  const handleRestore = useCallback(
    (search: SavedSearch) => {
      void setQs(
        paramsToQuerystate(search.params) as Parameters<typeof setQs>[0],
      );
      // D3: stamp last_viewed_at (clears the new-matches badge). Fire and
      // forget — badge freshness must never block restoring the filters.
      if (userId) {
        void fetch(`/api/saved-searches?id=${search.id}&user_id=${encodeURIComponent(userId)}`, { method: 'PATCH' }).catch(() => {});
      }
      setOpen(false);
    },
    [setQs, userId],
  );

  const handleDelete = useCallback(
    (search: SavedSearch) => {
      if (!userId) return;
      deleteMutation.mutate({ id: search.id, user_id: userId });
    },
    [deleteMutation, userId],
  );

  const triggerLabel = `Saved searches${
    searches.length > 0 ? ` (${searches.length})` : ''
  }`;

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Saved searches"
      >
        <Save className="h-4 w-4 mr-2" />
        {triggerLabel}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Saved searches"
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Saved searches
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close saved searches"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto px-2 py-2">
            {isLoading && (
              <p className="px-3 py-4 text-xs text-slate-500">Loading…</p>
            )}
            {isError && (
              <p className="px-3 py-4 text-xs text-rose-600">
                Failed to load saved searches.
              </p>
            )}
            {!isLoading && !isError && searches.length === 0 && (
              <p className="px-3 py-4 text-xs text-slate-500">
                No saved searches yet. Save the current filters below.
              </p>
            )}
            {!isLoading &&
              searches.map((search) => {
                const active = countActiveFilters(search.params);
                return (
                  <div
                    key={String(search.id)}
                    className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="flex items-center gap-2 truncate text-sm font-medium text-slate-900"
                        title={search.name}
                      >
                        {search.name}
                        {(search.new_matches ?? 0) > 0 && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none"
                            style={{ background: 'var(--pass)', color: 'var(--ink)' }}
                            title={`${search.new_matches} new since you last looked`}
                          >
                            {search.new_matches! > 99 ? '99+' : search.new_matches}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {active === 0
                          ? 'no filters applied'
                          : `${active} filter${active === 1 ? '' : 's'} applied`}
                      </p>
                      {sessionEmail && (
                        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                          <input
                            type="checkbox"
                            className="h-3 w-3 accent-blue-600"
                            checked={Boolean(search.email_digest)}
                            disabled={toggleDigestMutation.isPending}
                            onChange={(e) =>
                              toggleDigestMutation.mutate({
                                id: search.id,
                                user_id: userId ?? '',
                                email_digest: e.target.checked,
                                email: sessionEmail,
                              })
                            }
                            aria-label={`Email daily new matches for ${search.name}`}
                          />
                          Email me daily new matches
                        </label>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(search)}
                      className="rounded p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
                      title="Restore filters"
                      aria-label={`Restore filters from ${search.name}`}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(search)}
                      disabled={deleteMutation.isPending}
                      className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                      title="Delete saved search"
                      aria-label={`Delete saved search ${search.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
          </div>

          <div className="border-t border-slate-100 px-3 py-3">
            <p className="mb-2 text-[11px] text-slate-500">
              Save current filters
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSave();
                }}
                placeholder="Search name"
                className="h-8 flex-1 rounded-md border border-slate-200 px-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                aria-label="New saved search name"
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={
                  !name.trim() || !userId || saveMutation.isPending
                }
              >
                {saveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
            {saveMutation.isError && (
              <p className="mt-1 text-[11px] text-rose-600">
                Failed to save. Try again.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
