"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  type Layout,
} from "react-resizable-panels";
import { HelpCircle } from "lucide-react";
import {
  HotkeyHelp,
  ThemeToggle,
  useHotkey,
} from "@oper/primitives";
import { SelectionProvider } from "@/lib/selection";
import { useSessionUser } from "@/lib/useSessionUser";
import { FilterRail } from "@/components/FilterRail";
import { PropertyInspector } from "@/components/PropertyInspector";
import { FilterExpression } from "@/components/FilterExpression";

/**
 * Three-pane terminal shell. The route group `(terminal)` owns the chrome
 * — top bar, left filter rail, center pane (the route's children), right
 * inspector. The page beneath drives the data, but selection state lives
 * here so the inspector can sit in the right pane without prop drilling.
 */
export default function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  const [filterValue, setFilterValue] = React.useState("");
  const pathname = usePathname();
  const portfolioActive = pathname?.startsWith("/portfolio") ?? false;
  const session = useSessionUser();
  const isPro = session?.tier === "pro";

  // Lightweight layout persistence. v4 of react-resizable-panels dropped the
  // single-prop `autoSaveId`; the recommended replacement (`useDefaultLayout`)
  // touches `localStorage` during render which breaks SSR. Re-implementing
  // the save/restore loop with a useEffect avoids the hydration mismatch and
  // keeps the API surface small. Falls back gracefully if storage throws.
  const STORAGE_KEY = "two:panes:v1";
  const [defaultLayout, setDefaultLayout] = React.useState<Layout | undefined>(
    undefined,
  );
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Layout;
      if (parsed && typeof parsed === "object") setDefaultLayout(parsed);
    } catch {
      /* ignore — quota / opaque origin / disabled storage */
    }
  }, []);
  const onLayoutChanged = React.useCallback((layout: Layout) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, []);

  // `?` (shift+/) opens keyboard help. Single source of truth for the modal
  // visibility lives here; the toolbar button just toggles the same state.
  useHotkey(
    "?",
    () => setHelpOpen((v) => !v),
    { description: "Show keyboard shortcuts", group: "Help" },
  );

  return (
    <SelectionProvider>
      <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950 px-3">
          <div className="flex items-baseline gap-2 font-mono">
            <span className="text-base font-semibold uppercase tracking-widest text-zinc-100">
              octavo
            </span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">
              · terminal
            </span>
          </div>

          <nav className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-widest">
            <Link
              href="/portfolio"
              aria-current={portfolioActive ? "page" : undefined}
              className={
                portfolioActive
                  ? "rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary"
                  : "rounded-sm border border-transparent px-2 py-0.5 text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
              }
            >
              Portfolio
            </Link>
          </nav>

          <div className="mx-auto w-full max-w-xl">
            {isPro ? (
              <FilterExpression
                value={filterValue}
                onChange={setFilterValue}
                onValidChange={(expr) => {
                  // Notify the page beneath; it owns the data fetch.
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("two:filter-change", { detail: expr }),
                    );
                  }
                }}
              />
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-amber-700/60 bg-amber-500/15 px-3 py-1.5 font-mono text-[12px] text-amber-200">
                <span className="truncate">
                  Custom filters are a Pro feature
                </span>
                <Link
                  href="/pricing"
                  className="shrink-0 underline underline-offset-2 hover:text-amber-50"
                >
                  See pricing →
                </Link>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Page-driven status text lands here via portal */}
            <div
              id="topbar-status"
              className="font-mono text-[11px] text-zinc-500"
            />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="Keyboard shortcuts"
              className="flex h-7 w-7 items-center justify-center rounded-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              title="Keyboard shortcuts (?)"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Main panel group */}
        <div className="flex min-h-0 flex-1">
          <PanelGroup
            id="two:panes:v1"
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
            className="flex-1"
          >
            <Panel
              id="filters"
              defaultSize={18}
              minSize={railCollapsed ? 3 : 14}
              maxSize={railCollapsed ? 6 : 28}
            >
              <FilterRail
                collapsed={railCollapsed}
                onToggle={() => setRailCollapsed((v) => !v)}
              />
            </Panel>

            <PanelResizeHandle
              className="w-px cursor-col-resize bg-zinc-800/60 transition-colors hover:bg-primary"
              aria-label="Resize filter rail"
            />

            <Panel id="main" defaultSize={58} minSize={40}>
              {children}
            </Panel>

            <PanelResizeHandle
              className="w-px cursor-col-resize bg-zinc-800/60 transition-colors hover:bg-primary"
              aria-label="Resize inspector"
            />

            <Panel id="inspector" defaultSize={24} minSize={18} maxSize={32}>
              <PropertyInspector />
            </Panel>
          </PanelGroup>
        </div>

        <HotkeyHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </SelectionProvider>
  );
}
