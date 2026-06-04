"use client";

import * as React from "react";
import { SelectionCtx } from "./selection-context";
import type { SelectionState } from "./selection-context";
import type { PropertyRow } from "./types";

/**
 * Tiny selection context so the inspector (rendered by the `(terminal)`
 * layout) and the table (rendered by the page) can sync without lifting
 * state up to a global store. Anything more heavyweight (zustand etc) would
 * be over-engineering at this stage.
 */
export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState<PropertyRow | null>(null);
  const value = React.useMemo(() => ({ selected, setSelected }), [selected]);
  return <SelectionCtx.Provider value={value}>{children}</SelectionCtx.Provider>;
}

export function useSelection(): SelectionState {
  const ctx = React.useContext(SelectionCtx);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
