"use client";

import * as React from "react";
import { ApiClientProvider } from "@oper/api-client";
import { ThemeProvider } from "@oper/primitives";
import { NuqsAdapter } from "nuqs/adapters/next/app";

/**
 * Client-side providers stack for one.octavo.press (consumer app).
 * Order matters: Theme outermost (sets html class), then nuqs URL state
 * adapter, then TanStack Query for data.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light">
      <NuqsAdapter>
        <ApiClientProvider>{children}</ApiClientProvider>
      </NuqsAdapter>
    </ThemeProvider>
  );
}
