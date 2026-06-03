"use client";

import * as React from "react";
import { ApiClientProvider } from "@oper/api-client";
import { ThemeProvider } from "@oper/primitives";

/**
 * Client-side providers stack for two.octavo.press (pro terminal).
 * Terminal defaults to dark; we still allow toggling for users who want
 * a daytime mode.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark">
      <ApiClientProvider>{children}</ApiClientProvider>
    </ThemeProvider>
  );
}
