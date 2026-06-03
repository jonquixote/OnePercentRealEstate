"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * TanStack Query client + provider for app shells. Defaults tuned for
 * read-heavy real-estate data: 1-minute freshness window, no refetch on
 * window focus (annoying for power users in the pro terminal), 3 retries
 * with exponential backoff.
 */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // don't retry on 4xx
          const status = (error as { status?: number })?.status ?? 0;
          if (status >= 400 && status < 500) return false;
          return failureCount < 3;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") {
    // server: always make a new one (no module-level cache survives between requests)
    return makeQueryClient();
  }
  if (!browserClient) browserClient = makeQueryClient();
  return browserClient;
}

export function ApiClientProvider({ children }: { children: React.ReactNode }) {
  const client = getQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
