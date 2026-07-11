'use client';

// Bottom compare tray (D1): appears when >=1 property selected, links to
// /compare. Motion respects prefers-reduced-motion via CSS.
import Link from 'next/link';
import { useCompare } from './useCompare';

export function CompareTray() {
  const { ids, remove, clear, limit, isPro } = useCompare();
  if (ids.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur motion-safe:animate-[oper-tray-in_.25s_ease-out]"
      style={{ background: 'rgba(250,247,242,.96)', borderColor: 'var(--line-hi)' }}
      role="region"
      aria-label="Compare tray"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3 lg:px-8">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          Compare · {ids.length}/{limit}{!isPro ? ' (free)' : ''}
        </span>
        <div className="flex items-center gap-2 overflow-x-auto">
          {ids.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px]"
              style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
            >
              #{id}
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`Remove ${id} from comparison`}
                className="opacity-60 transition-opacity hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={clear}
            className="rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors hover:border-line-hi"
            style={{ borderColor: 'var(--line)', color: 'var(--haze)' }}
          >
            Clear
          </button>
          <Link
            href={`/compare?ids=${ids.join(',')}`}
            className="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--pass)', color: 'var(--ink)' }}
            aria-disabled={ids.length < 2}
            onClick={(e) => { if (ids.length < 2) e.preventDefault(); }}
            title={ids.length < 2 ? 'Pick at least two properties' : undefined}
          >
            Compare →
          </Link>
        </div>
      </div>
    </div>
  );
}
