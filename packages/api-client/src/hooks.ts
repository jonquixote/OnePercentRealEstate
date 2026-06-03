"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { fetchJson } from "./fetcher";
import {
  PropertyListResponseSchema,
  ViewportResponseSchema,
  type PropertyListItem,
  type ViewportResponse,
} from "./schemas";

/** Fetch a list of properties by id (compare page, etc.). */
export function useProperties(
  ids: string[],
  options?: Partial<UseQueryOptions<PropertyListItem[]>>,
) {
  return useQuery({
    queryKey: ["properties", { ids: ids.join(",") }],
    queryFn: ({ signal }) =>
      fetchJson<PropertyListItem[]>(
        `/api/properties?ids=${encodeURIComponent(ids.join(","))}`,
        { signal, schema: PropertyListResponseSchema },
      ),
    enabled: ids.length > 0,
    ...options,
  });
}

export interface ViewportParams {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  baths?: number;
  status?: string;
}

export function useViewport(
  params: ViewportParams | null,
  options?: Partial<UseQueryOptions<ViewportResponse>>,
) {
  return useQuery({
    queryKey: ["viewport", params],
    queryFn: ({ signal }) => {
      if (!params) throw new Error("viewport params missing");
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") search.set(k, String(v));
      }
      return fetchJson<ViewportResponse>(
        `/api/properties/viewport?${search.toString()}`,
        { signal, schema: ViewportResponseSchema },
      );
    },
    enabled: params != null,
    staleTime: 30_000,
    ...options,
  });
}
