"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "./button";

/**
 * Shared theme provider. Wraps next-themes with sensible defaults for both
 * apps. one.octavo.press defaults to light, two.octavo.press defaults to
 * dark — each app sets its own `defaultTheme` prop.
 *
 * Persists via cookie (not localStorage) so SSR can render the correct
 * theme without a flash.
 */
export interface ThemeProviderProps
  extends Omit<React.ComponentProps<typeof NextThemesProvider>, "attribute"> {
  children: React.ReactNode;
}

export function ThemeProvider({ children, ...rest }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...rest}
    >
      {children}
    </NextThemesProvider>
  );
}

/**
 * Simple sun/moon toggle. Hides until mounted to avoid SSR/CSR mismatch
 * (next-themes can't know the user's choice on the server).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle theme"
        className={className}
      >
        <Sun className="h-4 w-4 opacity-0" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={className}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export { useTheme };
