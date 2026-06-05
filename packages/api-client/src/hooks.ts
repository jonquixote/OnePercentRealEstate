"use client";

import {
  useQuery,
  useInfiniteQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { fetchJson } from "./fetcher";
import {
  PropertyListResponseSchema,
  PropertyListResponseWithCursorSchema,
  ViewportResponseSchema,
  ListingHistoryResponseSchema,
  type PropertyListItem,
  type PropertyListResponseWithCursor,
  type ViewportResponse,
  type ListingHistoryResponse,
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

/** Fetch a single property by id. */
export function useProperty(
  id: string | null,
  options?: Partial<UseQueryOptions<PropertyListItem | null>>,
) {
  return useQuery({
    queryKey: ["property", id],
    queryFn: ({ signal }) => {
      if (!id) throw new Error("property id missing");
      return fetchJson<PropertyListItem[]>(
        `/api/properties?ids=${encodeURIComponent(id)}`,
        { signal, schema: PropertyListResponseSchema },
      ).then((items) => items[0] || null);
    },
    enabled: id != null,
    ...options,
  });
}

export interface InfiniteListingsFilters {
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  onlyOnePercentRule?: boolean;
  propertyType?: string;
}

/** Fetch properties with infinite scroll pagination using cursor. */
export function useInfiniteListings(
  filters: InfiniteListingsFilters,
  pageSize?: number,
) {
  const size = pageSize ?? 100;

  return useInfiniteQuery({
    queryKey: ["infinite-listings", filters, size] as const,
    queryFn: ({ signal, pageParam }) => {
      const search = new URLSearchParams();

      // Add filter params
      if (filters.minPrice != null) search.set("minPrice", String(filters.minPrice));
      if (filters.maxPrice != null) search.set("maxPrice", String(filters.maxPrice));
      if (filters.minBeds != null) search.set("minBeds", String(filters.minBeds));
      if (filters.minBaths != null)
        search.set("minBaths", String(filters.minBaths));
      if (filters.onlyOnePercentRule != null)
        search.set("onlyOnePercentRule", String(filters.onlyOnePercentRule));
      if (filters.propertyType != null) search.set("propertyType", filters.propertyType);

      // Add cursor and page size
      search.set("pageSize", String(size));
      if (typeof pageParam === "string" && pageParam) {
        search.set("cursor", pageParam);
      }

      return fetchJson<PropertyListResponseWithCursor>(
        `/api/properties?${search.toString()}`,
        { signal, schema: PropertyListResponseWithCursorSchema },
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** Fetch historical data points for a listing from listings_history. */
export function useListingHistory(
  id: string | null,
  options?: Partial<UseQueryOptions<ListingHistoryResponse>>,
) {
  return useQuery({
    queryKey: ["listing-history", id],
    queryFn: ({ signal }) => {
      if (!id) throw new Error("listing id missing");
      return fetchJson<ListingHistoryResponse>(
        `/api/properties/${encodeURIComponent(id)}/history`,
        { signal, schema: ListingHistoryResponseSchema },
      );
    },
    enabled: id != null,
    staleTime: 60_000,
    ...options,
  });
}
