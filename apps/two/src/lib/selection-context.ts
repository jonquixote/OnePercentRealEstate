/**
 * Selection context — defined outside a "use client" boundary so the same
 * context instance is shared by every bundle that imports it.
 *
 * The provider and consumer hooks live in ./selection.tsx (which IS a client
 * module) and import this context. Without this split, Next.js would bundle
 * separate copies of the context into the layout chunk and the page chunk,
 * causing useSelection() to fail on the client with:
 *   "useSelection must be used within SelectionProvider"
 */
import * as React from "react";
import type { PropertyRow } from "./types";

export interface SelectionState {
  selected: PropertyRow | null;
  setSelected: (r: PropertyRow | null) => void;
}

export const SelectionCtx = React.createContext<SelectionState | null>(null);
