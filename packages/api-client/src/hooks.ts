"use client";

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { fetchJson } from "./fetcher";
import {
  PropertyListResponseSchema,
  PropertyListResponseWithCursorSchema,
  ViewportResponseSchema,
  ListingHistoryResponseSchema,
  SavedSearchListSchema,
  SavedSearchSchema,
  FilteredListingsResponseSchema,
  StatsResponseSchema,
  FeaturedResponseSchema,
  type PropertyListItem,
  type PropertyListResponseWithCursor,
  type ViewportResponse,
  type ListingHistoryResponse,
  type SavedSearch,
  type FilteredListingsResponse,
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

/**
 * Saved searches. `userId` is the (currently localStorage-scoped) browser id
 * — once auth lands in Wave 8 the param will be dropped and the server
 * resolves it from the session. Until then, callers MUST pass it explicitly.
 */
export function useSavedSearches(
  userId: string | null,
  options?: Partial<UseQueryOptions<SavedSearch[]>>,
) {
  return useQuery({
    queryKey: ["saved-searches", userId],
    queryFn: ({ signal }) => {
      if (!userId) throw new Error("user_id missing");
      return fetchJson<SavedSearch[]>(
        `/api/saved-searches?user_id=${encodeURIComponent(userId)}`,
        { signal, schema: SavedSearchListSchema },
      );
    },
    enabled: userId != null,
    staleTime: 30_000,
    ...options,
  });
}

export interface SaveSearchInput {
  user_id: string;
  name: string;
  params: Record<string, unknown>;
}

export function useSaveSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSearchInput) =>
      fetchJson<SavedSearch>("/api/saved-searches", {
        method: "POST",
        body: JSON.stringify(input),
        schema: SavedSearchSchema,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["saved-searches", vars.user_id] });
    },
  });
}

export interface DeleteSavedSearchInput {
  id: number | string;
  user_id: string;
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, user_id }: DeleteSavedSearchInput) =>
      fetchJson<{ success: true }>(
        `/api/saved-searches?id=${encodeURIComponent(String(id))}&user_id=${encodeURIComponent(user_id)}`,
        { method: "DELETE" },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["saved-searches", vars.user_id] });
    },
  });
}

/**
 * Run a SQL-like filter expression through the terminal's `/api/properties/query`
 * endpoint. The expression is parsed + compiled server-side; the client
 * never sees raw SQL. When `expression` is null/empty/whitespace the hook
 * stays disabled so the caller can fall back to its viewport query.
 */
export function useFilteredListings(
  expression: string | null,
  options?: { limit?: number } & Partial<UseQueryOptions<FilteredListingsResponse>>,
) {
  const { limit, ...rest } = options ?? {};
  const trimmed = (expression ?? "").trim();
  const enabled = trimmed.length > 0;

  return useQuery({
    queryKey: ["filtered-listings", trimmed, limit ?? null] as const,
    queryFn: ({ signal }) =>
      fetchJson<FilteredListingsResponse>("/api/properties/query", {
        signal,
        method: "POST",
        body: JSON.stringify({ expression: trimmed, limit }),
        schema: FilteredListingsResponseSchema,
      }),
    enabled,
    staleTime: 30_000,
    ...rest,
  });
}

/** Fetch homepage stats for a given strategy. Polls every 120s. */
export function useStats(strategy: string = "buy_hold") {
  return useQuery({
    queryKey: ["stats", strategy],
    queryFn: async () => {
      const res = await fetch(`/api/stats?strategy=${encodeURIComponent(strategy)}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return StatsResponseSchema.parse(await res.json());
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: 3,
  });
}

/** Fetch featured deals for a given strategy. */
export function useFeatured(strategy: string = "buy_hold", limit: number = 6) {
  return useQuery({
    queryKey: ["featured", strategy, limit],
    queryFn: async () => {
      const res = await fetch(`/api/featured?limit=${limit}&strategy=${encodeURIComponent(strategy)}`);
      if (!res.ok) throw new Error("Failed to fetch featured");
      const json = await res.json();
      return FeaturedResponseSchema.parse(json);
    },
    refetchInterval: 600_000,
    staleTime: 300_000,
    retry: 3,
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
