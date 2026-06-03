"use client";

import * as React from "react";
import { Button } from "./button";
import { cn } from "./cn";

/**
 * Hotkeys primitive: a small, dependency-free keyboard shortcut registry plus
 * React API. Designed for two.octavo.press (pro terminal) but usable by any
 * app in the monorepo.
 *
 * Features:
 *  - `useHotkey(combo, handler, options?)` — register a shortcut.
 *  - `<HotkeyScope>` — scaffolding for scoping (v1: just a tabindex wrapper).
 *  - `<HotkeyHelp open onClose>` — overlay that lists every mounted shortcut.
 *  - `useHotkeyRegistry()` — read the current registry (sorted for display).
 *
 * Combo syntax:
 *  - Single key: `"j"`, `"/"`, `"?"`
 *  - Modifier combos: `"shift+?"`, `"cmd+k"` (cmd → meta on mac, ctrl elsewhere),
 *    `"alt+ArrowDown"`. Modifier match is exact: `Shift+Enter` does NOT fire
 *    a plain `Enter` handler.
 *  - Two-key chord: `"g p"` — press `g`, then `p` within 1500ms. Any other
 *    keypress between aborts the chord.
 *
 * Input handling:
 *  - When the active element is `<input>`, `<textarea>`, or `[contenteditable]`,
 *    single-key hotkeys are skipped (so `j` in a search box doesn't trigger
 *    table navigation). Combos with `cmd`/`ctrl` still fire (so `cmd+k`
 *    works inside inputs).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HotkeyOptions {
  /** If false, skip registration entirely. Default true. */
  enabled?: boolean;
  /** Call e.preventDefault() when the hotkey fires. Default true. */
  preventDefault?: boolean;
  /** Where to attach the listener. Default 'window'. */
  target?: "window" | "document";
  /**
   * When true (default), skip the hotkey if focus is inside an input,
   * textarea, or contenteditable element. Combos with cmd/ctrl ignore
   * this setting.
   */
  ignoreInputs?: boolean;
  /** Description shown in <HotkeyHelp>. */
  description?: string;
  /** Optional group label in <HotkeyHelp> (e.g. "Navigation", "Actions"). */
  group?: string;
}

interface RegistryEntry {
  id: string;
  combo: string;
  description?: string;
  group?: string;
  enabled: boolean;
}

interface ParsedCombo {
  /** Sequence of key chords (length 1 for single, 2 for "g p"). */
  steps: ParsedStep[];
  /** True if the combo uses the cross-platform `cmd` token. */
  hasCmd: boolean;
}

interface ParsedStep {
  key: string; // lowercased target key (e.g. "k", "?", "arrowdown")
  shift: boolean;
  alt: boolean;
  /** "any" means accept either ctrl or meta (cmd). */
  ctrlOrMeta: boolean | "any";
  /** Exact modifier required: ctrl. Ignored if ctrlOrMeta is set. */
  ctrl: boolean;
  /** Exact modifier required: meta. Ignored if ctrlOrMeta is set. */
  meta: boolean;
}

// ---------------------------------------------------------------------------
// Combo parsing
// ---------------------------------------------------------------------------

function parseStep(token: string): ParsedStep {
  const parts = token.split("+").map((p) => p.trim()).filter(Boolean);
  const step: ParsedStep = {
    key: "",
    shift: false,
    alt: false,
    ctrlOrMeta: false,
    ctrl: false,
    meta: false,
  };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === "shift") step.shift = true;
    else if (p === "alt" || p === "option" || p === "opt") step.alt = true;
    else if (p === "cmd" || p === "command" || p === "mod") step.ctrlOrMeta = "any";
    else if (p === "ctrl" || p === "control") step.ctrl = true;
    else if (p === "meta" || p === "super" || p === "win") step.meta = true;
    else step.key = p;
  }
  // If both ctrl and meta were specified explicitly, treat as exact match
  // (rare). If `cmd` was used alongside explicit ctrl/meta, `cmd` wins as
  // "any" — the cross-platform intent.
  return step;
}

function parseCombo(combo: string): ParsedCombo {
  // Two-key chord: space-separated (e.g. "g p"). Modifiers in a step use "+".
  const stepTokens = combo.trim().split(/\s+/).filter(Boolean);
  const steps = stepTokens.map(parseStep);
  const hasCmd = /(^|\+)(cmd|command|mod)(\+|$)/i.test(combo);
  return { steps, hasCmd };
}

// ---------------------------------------------------------------------------
// Event matching
// ---------------------------------------------------------------------------

function normalizeEventKey(e: KeyboardEvent): string {
  // e.key gives the produced character. Lowercased for matching. Special keys
  // like "ArrowDown", "Enter", "Escape", " " (space) stay as-is.
  const k = e.key;
  if (k === " ") return "space";
  return k.toLowerCase();
}

function matchesStep(step: ParsedStep, e: KeyboardEvent): boolean {
  if (step.key && step.key !== normalizeEventKey(e)) return false;

  // Shift / alt always exact match.
  if (step.shift !== e.shiftKey) {
    // Exception: when the target key requires shift to produce (e.g. "?" needs
    // shift+/ on US layouts), the user expressing combo "?" should match a
    // press where shift is held. We allow this when:
    //   - step.shift is false AND the key character is one of the
    //     "shifted" punctuation marks. In that case, accept shift held.
    if (!step.shift && isShiftedPunctuation(step.key)) {
      // ok — fall through
    } else {
      return false;
    }
  }
  if (step.alt !== e.altKey) return false;

  if (step.ctrlOrMeta === "any") {
    // cmd token: require either ctrl OR meta to be held, not both other mods.
    if (!(e.ctrlKey || e.metaKey)) return false;
  } else {
    if (step.ctrl !== e.ctrlKey) return false;
    if (step.meta !== e.metaKey) return false;
  }
  return true;
}

const SHIFTED_PUNCTUATION = new Set([
  "?",
  "!",
  "@",
  "#",
  "$",
  "%",
  "^",
  "&",
  "*",
  "(",
  ")",
  "_",
  "+",
  "{",
  "}",
  "|",
  ":",
  '"',
  "<",
  ">",
  "~",
]);

function isShiftedPunctuation(key: string): boolean {
  return SHIFTED_PUNCTUATION.has(key);
}

function isModifierKey(e: KeyboardEvent): boolean {
  const k = e.key;
  return (
    k === "Shift" ||
    k === "Control" ||
    k === "Alt" ||
    k === "Meta" ||
    k === "OS"
  );
}

function stepHasAnyModifier(step: ParsedStep): boolean {
  return (
    step.shift ||
    step.alt ||
    step.ctrl ||
    step.meta ||
    step.ctrlOrMeta === "any"
  );
}

function eventHasAnyModifier(e: KeyboardEvent, ignoreShift: boolean): boolean {
  return (
    (!ignoreShift && e.shiftKey) || e.altKey || e.ctrlKey || e.metaKey
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Registry (module scope) + tiny pub/sub for <HotkeyHelp>
// ---------------------------------------------------------------------------

const registry = new Map<string, RegistryEntry>();
const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function getRegistrySnapshot(): RegistryEntry[] {
  return Array.from(registry.values());
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `hk_${idCounter}`;
}

// ---------------------------------------------------------------------------
// Scope context
// ---------------------------------------------------------------------------

interface ScopeContextValue {
  element: HTMLElement | null;
}

const ScopeContext = React.createContext<ScopeContextValue | null>(null);

/**
 * HotkeyScope — v1 scaffolding. Renders a `<div tabIndex={-1}>` and provides
 * its element via context. When a hotkey is mounted inside a scope, it only
 * fires if the event target is contained by (or equal to) the scope element
 * — or if the scope element has focus / contains the active element.
 *
 * Useful for modal sub-scopes where you want `Esc` to close the modal only,
 * not propagate to outer scopes. For v1 we treat this as scaffolding: it's
 * functional but minimal. The API is stable; the implementation can grow.
 */
export function HotkeyScope({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  // Force re-render once mounted so descendants pick up the element.
  React.useEffect(() => {
    force();
  }, []);

  const value = React.useMemo<ScopeContextValue>(
    () => ({ element: ref.current }),
    // We intentionally re-read ref.current on each render after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ref.current],
  );

  return (
    <ScopeContext.Provider value={value}>
      <div ref={ref} tabIndex={-1} className={className} {...rest}>
        {children}
      </div>
    </ScopeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// useHotkey
// ---------------------------------------------------------------------------

const CHORD_TIMEOUT_MS = 1500;

export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const {
    enabled = true,
    preventDefault = true,
    target = "window",
    ignoreInputs = true,
    description,
    group,
  } = options;

  const handlerRef = React.useRef(handler);
  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const scope = React.useContext(ScopeContext);

  // Register in the help registry.
  const idRef = React.useRef<string | null>(null);
  if (idRef.current === null) idRef.current = nextId();

  React.useEffect(() => {
    if (!enabled) return;
    const id = idRef.current!;
    registry.set(id, {
      id,
      combo,
      description,
      group,
      enabled,
    });
    emit();
    return () => {
      registry.delete(id);
      emit();
    };
  }, [combo, description, group, enabled]);

  React.useEffect(() => {
    if (!enabled) return;

    const parsed = parseCombo(combo);
    if (parsed.steps.length === 0) return;

    let chordPending: ParsedStep | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    const clearChord = () => {
      chordPending = null;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Always ignore pure modifier keys (they shouldn't reset chord state
      // and shouldn't match anything).
      if (isModifierKey(e)) return;

      // Scope containment check (if a scope is active in this consumer).
      if (scope?.element) {
        const active =
          (e.target instanceof Node ? e.target : null) ??
          document.activeElement;
        if (!active || !scope.element.contains(active as Node)) {
          return;
        }
      }

      // Input element guard. Combos with cmd/ctrl bypass this so cmd+k works
      // inside a search box.
      const stepForGuardCheck = chordPending ? parsed.steps[1] : parsed.steps[0];
      const usesCmdOrCtrl =
        stepForGuardCheck.ctrlOrMeta === "any" ||
        stepForGuardCheck.ctrl ||
        stepForGuardCheck.meta;
      if (ignoreInputs && !usesCmdOrCtrl && isEditableTarget(e.target)) {
        return;
      }

      if (parsed.steps.length === 1) {
        const step = parsed.steps[0];

        // Single-key combos shouldn't trigger when a modifier is held that
        // the combo doesn't ask for. Exception: shift may be held for
        // shifted punctuation keys like "?".
        if (!stepHasAnyModifier(step)) {
          const shiftOkay = isShiftedPunctuation(step.key);
          if (eventHasAnyModifier(e, /* ignoreShift */ shiftOkay)) {
            return;
          }
        }

        if (matchesStep(step, e)) {
          if (preventDefault) e.preventDefault();
          handlerRef.current(e);
        }
        return;
      }

      // Two-step chord.
      if (!chordPending) {
        const first = parsed.steps[0];
        if (!stepHasAnyModifier(first)) {
          const shiftOkay = isShiftedPunctuation(first.key);
          if (eventHasAnyModifier(e, shiftOkay)) {
            // Don't reset; some other combo may be in progress. Just skip.
            return;
          }
        }
        if (matchesStep(first, e)) {
          chordPending = parsed.steps[1];
          chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS);
          // First step of a chord doesn't fire the handler and shouldn't
          // preventDefault (a bare "g" could still be a search trigger
          // elsewhere). We let it bubble.
        }
        return;
      }

      // Chord pending: second key must match, otherwise abort chord.
      const second = chordPending;
      if (!stepHasAnyModifier(second)) {
        const shiftOkay = isShiftedPunctuation(second.key);
        if (eventHasAnyModifier(e, shiftOkay)) {
          clearChord();
          return;
        }
      }
      if (matchesStep(second, e)) {
        if (preventDefault) e.preventDefault();
        const fn = handlerRef.current;
        clearChord();
        fn(e);
      } else {
        clearChord();
      }
    };

    const node: Window | Document =
      target === "document" ? document : window;
    node.addEventListener("keydown", onKeyDown as EventListener);
    return () => {
      node.removeEventListener("keydown", onKeyDown as EventListener);
      clearChord();
    };
  }, [combo, enabled, preventDefault, target, ignoreInputs, scope]);
}

// ---------------------------------------------------------------------------
// useHotkeyRegistry
// ---------------------------------------------------------------------------

/**
 * Subscribe to the live hotkey registry. Returns a stable, sorted array
 * grouped by `group`. Entries without a group fall into an "Other" bucket.
 */
export function useHotkeyRegistry(): {
  all: RegistryEntry[];
  groups: { name: string; entries: RegistryEntry[] }[];
} {
  const entries = React.useSyncExternalStore(
    subscribe,
    getRegistrySnapshot,
    getRegistrySnapshot,
  );

  return React.useMemo(() => {
    const enabledOnly = entries.filter((e) => e.enabled);

    const byGroup = new Map<string, RegistryEntry[]>();
    for (const e of enabledOnly) {
      const g = e.group ?? "Other";
      let arr = byGroup.get(g);
      if (!arr) {
        arr = [];
        byGroup.set(g, arr);
      }
      arr.push(e);
    }

    // Sort entries within each group by combo.
    for (const arr of byGroup.values()) {
      arr.sort((a, b) => a.combo.localeCompare(b.combo));
    }

    // Sort groups: "Other" last; otherwise alpha.
    const groups = Array.from(byGroup.entries())
      .sort(([a], [b]) => {
        if (a === "Other") return 1;
        if (b === "Other") return -1;
        return a.localeCompare(b);
      })
      .map(([name, entries]) => ({ name, entries }));

    return {
      all: enabledOnly.slice().sort((a, b) => a.combo.localeCompare(b.combo)),
      groups,
    };
  }, [entries]);
}

// ---------------------------------------------------------------------------
// HotkeyHelp overlay
// ---------------------------------------------------------------------------

export interface HotkeyHelpProps {
  open: boolean;
  onClose: () => void;
  /** Optional override title. */
  title?: string;
  className?: string;
}

export function HotkeyHelp({
  open,
  onClose,
  title = "Keyboard shortcuts",
  className,
}: HotkeyHelpProps) {
  const { groups } = useHotkeyRegistry();

  // Esc closes. We attach this directly (not via useHotkey) so it works
  // even if the consumer didn't register Escape themselves.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4",
        className,
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-background text-foreground border-border max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg border shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </Button>
        </div>
        <div className="p-4">
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No shortcuts registered.
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.name}>
                  <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                    {g.name}
                  </h3>
                  <table className="w-full text-sm">
                    <tbody>
                      {g.entries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-border/50 border-b last:border-b-0"
                        >
                          <td className="py-1.5 pr-4 align-top whitespace-nowrap">
                            <ComboBadge combo={entry.combo} />
                          </td>
                          <td className="text-muted-foreground py-1.5 align-top">
                            {entry.description ?? (
                              <span className="opacity-60">
                                (no description)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComboBadge({ combo }: { combo: string }) {
  // Split chord on space, then each step on "+", render each token as a <kbd>.
  const steps = combo.trim().split(/\s+/);
  return (
    <span className="inline-flex items-center gap-1">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-muted-foreground mx-0.5">then</span>}
          <span className="inline-flex items-center gap-0.5">
            {step.split("+").map((part, j) => (
              <React.Fragment key={j}>
                {j > 0 && (
                  <span className="text-muted-foreground">+</span>
                )}
                <kbd className="bg-muted text-foreground border-border inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border px-1.5 font-mono text-xs">
                  {prettyKey(part)}
                </kbd>
              </React.Fragment>
            ))}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function prettyKey(part: string): string {
  const p = part.toLowerCase();
  switch (p) {
    case "cmd":
    case "command":
    case "mod":
      return isMac() ? "⌘" : "Ctrl";
    case "shift":
      return "⇧";
    case "alt":
    case "option":
    case "opt":
      return isMac() ? "⌥" : "Alt";
    case "ctrl":
    case "control":
      return "Ctrl";
    case "meta":
    case "super":
    case "win":
      return isMac() ? "⌘" : "Win";
    case "enter":
    case "return":
      return "↵";
    case "escape":
    case "esc":
      return "Esc";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "space":
      return "Space";
    case "backspace":
      return "⌫";
    case "tab":
      return "Tab";
    default:
      return part.length === 1 ? part.toUpperCase() : part;
  }
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // navigator.platform is deprecated but still useful as a fallback.
  const ua = navigator.userAgent || "";
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return true;
  // @ts-expect-error - userAgentData is not yet in the TS DOM lib for all targets.
  const uaData = navigator.userAgentData as
    | { platform?: string }
    | undefined;
  if (uaData?.platform && /mac/i.test(uaData.platform)) return true;
  return false;
}
