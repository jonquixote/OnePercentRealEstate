"use client";

import * as React from "react";
import { GripVertical, X } from "lucide-react";
import { cn } from "@oper/primitives";
import { COLUMN_MAP, ALL_COLUMN_IDS } from "@/lib/columns";

interface ColumnPickerProps {
  open: boolean;
  onClose: () => void;
  /** Current ordered, visible column ids. */
  columnIds: string[];
  /** Emits the new ordered, visible column ids (persist upstream). */
  onChange: (ids: string[]) => void;
}

/**
 * Column picker (hotkey `c`). A modal listing every registry column with a
 * visibility checkbox and drag-to-reorder. The internal list is the visible
 * columns (in order) followed by the hidden ones; dragging reorders and
 * checkboxes toggle visibility. Any edit emits the checked ids in list order so
 * the page can persist them to the active screen's `columns` JSONB.
 */
export function ColumnPicker({ open, onClose, columnIds, onChange }: ColumnPickerProps) {
  // Full ordered working list: visible ids first (their order), then the rest.
  const [items, setItems] = React.useState<string[]>([]);
  const [visible, setVisible] = React.useState<Set<string>>(new Set());
  const dragId = React.useRef<string | null>(null);

  // Re-seed the working state whenever the picker opens or inputs change.
  React.useEffect(() => {
    if (!open) return;
    const known = columnIds.filter((id) => COLUMN_MAP[id]);
    const rest = ALL_COLUMN_IDS.filter((id) => !known.includes(id));
    setItems([...known, ...rest]);
    setVisible(new Set(known));
  }, [open, columnIds]);

  const emit = React.useCallback(
    (nextItems: string[], nextVisible: Set<string>) => {
      onChange(nextItems.filter((id) => nextVisible.has(id)));
    },
    [onChange],
  );

  // Mirror the working state into refs so persistence fires with the settled
  // values rather than the closure captured at drag/event start.
  const itemsRef = React.useRef(items);
  const visibleRef = React.useRef(visible);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  React.useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // Persist ONLY on a discrete commit (drag end / modal close) — never for
  // every intermediate pointer move, and never inside a setState updater
  // (which StrictMode double-fires). Local state still updates instantly so
  // the UI stays responsive.
  const commit = React.useCallback(() => {
    emit(itemsRef.current, visibleRef.current);
  }, [emit]);

  const toggle = React.useCallback((id: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reorder = React.useCallback((from: string, to: string) => {
    if (from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(from);
      const toIdx = next.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
  }, []);

  // Persist the layout and close. Every close path (backdrop, X, Esc) routes
  // through here so toggles made without a drag are still saved.
  const handleClose = React.useCallback(() => {
    commit();
    onClose();
  }, [commit, onClose]);

  // Escape to close.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24"
      onClick={handleClose}
    >
      <div
        className="w-80 rounded-sm border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-zinc-400">
            Columns
          </span>
          <button
            type="button"
            aria-label="Close column picker"
            onClick={handleClose}
            className="text-zinc-500 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ul className="max-h-[60vh] overflow-auto py-1">
          {items.map((id) => {
            const col = COLUMN_MAP[id];
            if (!col) return null;
            const checked = visible.has(id);
            return (
              <li
                key={id}
                draggable
                onDragStart={() => {
                  dragId.current = id;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId.current && dragId.current !== id) reorder(dragId.current, id);
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  commit();
                }}
                className={cn(
                  "flex cursor-grab items-center gap-2 px-3 py-1.5 font-mono text-[12px] hover:bg-zinc-900/60",
                  !checked && "opacity-50",
                )}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                <label className="flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(id)}
                    className="accent-primary"
                  />
                  <span className="text-zinc-200">{col.label}</span>
                </label>
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">
                  {col.id}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-zinc-800/60 px-3 py-1.5 font-mono text-[9px] uppercase tracking-widest text-zinc-600">
          Drag to reorder · Esc to close
        </div>
      </div>
    </div>
  );
}
