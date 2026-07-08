"use client";

import * as React from "react";
import { ApiClientProvider } from "@oper/api-client";
import { NuqsAdapter } from "nuqs/adapters/next/app";

/**
 * Client-side providers stack for one.octavo.press (consumer app).
 * Eggshell/light theme is the only theme (set in globals.css); no ThemeProvider.
 * Order matters: nuqs URL state adapter, then TanStack Query for data.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <ApiClientProvider>{children}</ApiClientProvider>
    </NuqsAdapter>
  );
}
