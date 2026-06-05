"use client";

import * as React from "react";
import { parse, compile, ALLOWED_COLUMNS_LIST } from "@oper/query-lang";
import { useHotkey } from "@oper/primitives";

const LS_KEY = "two:filter:v1";

interface ParsedState {
  valid: boolean;
  error?: string;
  usedColumns: string[];
  whereSql?: string;
}

function tryParseCompile(expression: string): ParsedState {
  if (!expression.trim()) {
    return { valid: true, usedColumns: [], whereSql: "" };
  }
  try {
    const ast = parse(expression);
    const c = compile(ast);
    return { valid: true, usedColumns: c.usedColumns, whereSql: c.whereSql };
  } catch (err) {
    return { valid: false, error: (err as Error).message, usedColumns: [] };
  }
}

export interface FilterExpressionProps {
  value: string;
  onChange: (value: string) => void;
  onValidChange?: (expression: string) => void;
  label?: string;
}

/**
 * Slash-search-style filter expression input for the pro terminal.
 *
 * Type a filter like `price < 300k AND state = 'OH'`. Parses + compiles
 * locally for UX; server endpoint /api/properties/query re-parses +
 * re-compiles before SQL — never trust client-compiled output.
 *
 * Hotkey `/` focuses the input.
 */
export function FilterExpression({
  value,
  onChange,
  onValidChange,
  label = "Filter expression",
}: FilterExpressionProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [state, setState] = React.useState<ParsedState>(() => tryParseCompile(value));
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValidRef = React.useRef<string>(value);

  React.useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const next = tryParseCompile(value);
      setState(next);
      if (next.valid && value !== lastValidRef.current) {
        lastValidRef.current = value;
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(LS_KEY, value);
          } catch {
            /* ignore */
          }
        }
        onValidChange?.(value);
      }
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [value, onValidChange]);

  React.useEffect(() => {
    if (value) return;
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(LS_KEY);
      if (stored) onChange(stored);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHotkey(
    "/",
    () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    { description: "Focus filter expression", group: "Filter" }
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const next = tryParseCompile(value);
      setState(next);
      if (next.valid && value !== lastValidRef.current) {
        lastValidRef.current = value;
        onValidChange?.(value);
      }
    } else if (e.key === "Escape") {
      onChange("");
      inputRef.current?.blur();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-center">
        <span aria-hidden className="absolute left-2 text-xs font-mono text-zinc-500">/</span>
        <input
          ref={inputRef}
          type="text"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="price < 300k AND state = 'OH'"
          className="w-full bg-background border border-border rounded-md py-1 pl-6 pr-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          spellCheck={false}
        />
      </div>

      {state.error && value.trim() && (
        <div className="text-xs font-mono text-loss">{state.error}</div>
      )}

      {state.valid && state.usedColumns.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {state.usedColumns.map((col) => (
            <span
              key={col}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
            >
              {col}
            </span>
          ))}
        </div>
      )}

      <details className="text-[10px] font-mono text-muted-foreground">
        <summary className="cursor-pointer select-none hover:text-foreground">hint</summary>
        <div className="mt-1 space-y-0.5 pl-2">
          <div>cols: {ALLOWED_COLUMNS_LIST.join(", ")}</div>
          <div>ops: &lt; &lt;= = != &gt;= &gt; IN AND</div>
          <div>literals: 300k, $300,000, 0.08, 'TX', ('TX','CA')</div>
        </div>
      </details>
    </div>
  );
}
