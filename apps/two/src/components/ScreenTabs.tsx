"use client";

import * as React from "react";
import { useHotkey, cn } from "@oper/primitives";
import { useSessionUser } from "@/lib/useSessionUser";
import {
  BUILTIN_SCREENS,
  type ScreenLike,
  type ScreenSort,
  type UserScreen,
} from "@/lib/screens";

interface ScreenTabsProps {
  /** Live query-lang expression currently driving the grid. */
  expression: string;
  /** Live sort of the grid. */
  sort: ScreenSort | null;
  /** Apply a screen's expression + sort + columns to the page. */
  onApply: (s: {
    id: string;
    kind: "builtin" | "user";
    expression: string;
    sort: ScreenSort | null;
    columns: string[];
  }) => void;
}

function sameSort(a: ScreenSort | null, b: ScreenSort | null): boolean {
  if (a === null || b === null) return a === b;
  return a.col === b.col && a.dir === b.dir;
}

export function ScreenTabs({ expression, sort, onApply }: ScreenTabsProps) {
  const session = useSessionUser();
  const isPro = session?.tier === "pro";

  const [userScreens, setUserScreens] = React.useState<UserScreen[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [toast, setToast] = React.useState<string | null>(null);

  const tabs: ScreenLike[] = React.useMemo(
    () => [
      ...BUILTIN_SCREENS.map((b) => ({ kind: "builtin" as const, ...b })),
      ...userScreens.map((u) => ({ kind: "user" as const, ...u })),
    ],
    [userScreens],
  );

  const loadScreens = React.useCallback(async () => {
    try {
      const res = await fetch("/api/screens", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as UserScreen[];
      setUserScreens(Array.isArray(data) ? data : []);
    } catch {
      /* non-fatal: built-ins still render */
    }
  }, []);

  React.useEffect(() => {
    void loadScreens();
  }, [loadScreens]);

  const flash = React.useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const pick = React.useCallback(
    (tab: ScreenLike) => {
      setActiveId(String(tab.id));
      onApply({
        id: String(tab.id),
        kind: tab.kind,
        expression: tab.expression,
        sort: tab.sort,
        columns: Array.isArray(tab.columns) ? tab.columns : [],
      });
    },
    [onApply],
  );

  const applyByIndex = React.useCallback(
    (n: number) => {
      const tab = tabs[n - 1];
      if (tab) pick(tab);
    },
    [tabs, pick],
  );

  const active = React.useMemo(
    () => tabs.find((t) => t.id === activeId) ?? null,
    [tabs, activeId],
  );

  const dirty = React.useMemo(() => {
    if (!active || active.kind !== "user") return false;
    if (active.expression.trim() !== expression.trim()) return true;
    return !sameSort(active.sort, sort);
  }, [active, expression, sort]);

  const save = React.useCallback(async () => {
    if (!isPro) {
      flash("Pro required to save screens");
      return;
    }
    try {
      if (active && active.kind === "user") {
        const res = await fetch(`/api/screens?id=${active.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expression: expression.trim(),
            sort,
            columns: active.columns,
          }),
        });
        if (!res.ok) {
          flash("Save failed");
          return;
        }
        await loadScreens();
        flash("Saved");
      } else {
        const name =
          active && active.kind === "builtin"
            ? `${active.name} copy`
            : "New screen";
        const res = await fetch("/api/screens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            expression: expression.trim(),
            sort,
            columns: [],
          }),
        });
        if (!res.ok) {
          flash("Save failed");
          return;
        }
        const created = (await res.json()) as UserScreen;
        await loadScreens();
        setActiveId(String(created.id));
        flash("Screen created");
      }
    } catch {
      flash("Save failed");
    }
  }, [active, expression, sort, isPro, flash, loadScreens]);

  const newScreen = React.useCallback(async () => {
    if (!isPro) {
      flash("Pro required to create screens");
      return;
    }
    try {
      const res = await fetch("/api/screens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "New screen",
          expression: expression.trim(),
          sort,
          columns: [],
        }),
      });
      if (!res.ok) {
        flash("Create failed");
        return;
      }
      const created = (await res.json()) as UserScreen;
      await loadScreens();
      setActiveId(String(created.id));
      flash("Screen created");
    } catch {
      flash("Create failed");
    }
  }, [expression, sort, isPro, flash, loadScreens]);

  const remove = React.useCallback(
    async (id: number) => {
      if (!isPro) {
        flash("Pro required to delete screens");
        return;
      }
      try {
        const res = await fetch(`/api/screens?id=${id}`, { method: "DELETE" });
        if (!res.ok) {
          flash("Delete failed");
          return;
        }
        if (activeId === String(id)) setActiveId(null);
        await loadScreens();
        flash("Deleted");
      } catch {
        flash("Delete failed");
      }
    },
    [isPro, activeId, flash, loadScreens],
  );

  const commitRename = React.useCallback(
    async (tab: ScreenLike) => {
      if (tab.kind !== "user") {
        setEditingId(null);
        return;
      }
      const name = renameValue.trim();
      setEditingId(null);
      if (!name || name === tab.name) return;
      try {
        await fetch(`/api/screens?id=${tab.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await loadScreens();
      } catch {
        flash("Rename failed");
      }
    },
    [renameValue, loadScreens, flash],
  );

  // ---- Hotkeys --------------------------------------------------------------
  useHotkey("cmd+s", () => void save(), {
    description: "Save current state into active screen",
    group: "Screens",
    preventDefault: true,
  });
  useHotkey("cmd+shift+n", () => void newScreen(), {
    description: "New screen",
    group: "Screens",
    preventDefault: true,
  });

  return (
    <div className="border-b border-zinc-800/60 bg-zinc-950">
      <div className="flex items-stretch overflow-x-auto font-mono text-[11px]">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeId;
          const showDirty = isActive && dirty;
          return (
            <div
              key={tab.id}
              className={cn(
                "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-zinc-800/60 px-2.5 py-1.5",
                isActive
                  ? "bg-zinc-900 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200",
              )}
              onClick={() => pick(tab)}
              onDoubleClick={() => {
                if (tab.kind === "user") {
                  setEditingId(String(tab.id));
                  setRenameValue(tab.name);
                }
              }}
              title={tab.kind === "builtin" ? `${tab.name} (built-in, read-only)` : tab.name}
            >
              <span className="text-zinc-600">{idx < 9 ? idx + 1 : ""}</span>
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => void commitRename(tab)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(tab);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-28 bg-zinc-800 px-1 text-zinc-100 outline-none"
                />
              ) : (
                <span className="max-w-[140px] truncate">{tab.name}</span>
              )}
              {showDirty ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-400"
                  title="Unsaved changes"
                />
              ) : null}
              {tab.kind === "builtin" ? (
                <span className="text-[9px] uppercase tracking-wider text-zinc-600">
                  ro
                </span>
              ) : null}
              {tab.kind === "user" && isPro ? (
                <button
                  type="button"
                  aria-label={`Delete ${tab.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(tab.id);
                  }}
                  className="ml-0.5 hidden text-zinc-600 hover:text-rose-400 group-hover:inline"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}

        {isPro ? (
          <button
            type="button"
            onClick={() => void newScreen()}
            className="shrink-0 px-2.5 py-1.5 text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-200"
            title="New screen (⌘⇧N)"
          >
            + screen
          </button>
        ) : null}
      </div>

      {!isPro ? (
        <div className="border-t border-zinc-800/60 bg-zinc-900/40 px-3 py-1 font-mono text-[10px] text-zinc-400">
          Free tier — built-in screens are read-only.{" "}
          <span className="text-amber-400">Upgrade to Pro</span> to save custom
          scans.
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-sm bg-zinc-800 px-4 py-2 font-mono text-[12px] text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
        <NumberHotkey key={n} n={n} enabled={n <= tabs.length} onPick={applyByIndex} />
      ))}
    </div>
  );
}

function NumberHotkey({
  n,
  enabled,
  onPick,
}: {
  n: number;
  enabled: boolean;
  onPick: (n: number) => void;
}) {
  useHotkey(String(n), () => onPick(n), {
    description: `Switch to screen ${n}`,
    group: "Screens",
    enabled,
  });
  return null;
}
