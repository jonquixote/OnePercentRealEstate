"use client";

import * as React from "react";
import { ApiClientProvider } from "@oper/api-client";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { CompareProvider } from "@/components/compare/useCompare";
import { CompareTray } from "@/components/compare/CompareTray";
import { CommandPalette } from "@/components/CommandPalette";

/**
 * Client-side providers stack for one.octavo.press (consumer app).
 * Eggshell/light theme is the only theme (set in globals.css); no ThemeProvider.
 * Order matters: nuqs URL state adapter, then TanStack Query for data.
 * CompareProvider carries the compare selection app-wide; the tray renders
 * once here so it survives navigation.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <ApiClientProvider>
        <CompareProvider>
          {children}
          <CompareTray />
          <CommandPalette />
        </CompareProvider>
      </ApiClientProvider>
    </NuqsAdapter>
  );
}
