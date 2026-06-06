import { z } from "zod";

/**
 * Wire schemas matching the responses from /api/properties etc.
 * These mirror the shape that route handlers in apps/one return after the
 * Wave 1 raw_data excise.
 */

export const PropertySpecsSchema = z.object({
  bedrooms: z.number().nullable(),
  bathrooms: z.number().nullable(),
  sqft: z.number().nullable(),
  year_built: z.number().nullable(),
  hoa_fee: z.number().nullable(),
});
export type PropertySpecs = z.infer<typeof PropertySpecsSchema>;

export const PropertyListItemSchema = z.object({
  id: z.string(),
  address: z.string(),
  listing_price: z.number().nullable(),
  estimated_rent: z.number().nullable(),
  status: z.string(),
  images: z.array(z.string()),
  media_blur: z.any().nullable().optional(),
  specs: PropertySpecsSchema,
});
export type PropertyListItem = z.infer<typeof PropertyListItemSchema>;

export const PropertyListResponseSchema = z.array(PropertyListItemSchema);

export const PropertyListResponseWithCursorSchema = z.object({
  items: z.array(PropertyListItemSchema),
  nextCursor: z.string().nullable(),
});
export type PropertyListResponseWithCursor = z.infer<
  typeof PropertyListResponseWithCursorSchema
>;

export const ViewportClusterSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  count: z.union([z.number(), z.string()]),
  avg_price: z.union([z.number(), z.string()]).nullable(),
  min_price: z.union([z.number(), z.string()]).nullable(),
  max_price: z.union([z.number(), z.string()]).nullable(),
});

export const ViewportPropertySchema = z.object({
  id: z.union([z.number(), z.string()]),
  address: z.string(),
  price: z.union([z.number(), z.string()]).nullable(),
  bedrooms: z.union([z.number(), z.string()]).nullable(),
  bathrooms: z.union([z.number(), z.string()]).nullable(),
  sqft: z.union([z.number(), z.string()]).nullable(),
  primary_photo: z.string().nullable(),
  status: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
});

export const ViewportResponseSchema = z.object({
  type: z.enum(["clusters", "properties"]),
  data: z.array(z.union([ViewportClusterSchema, ViewportPropertySchema])),
  zoom: z.number(),
  meta: z
    .object({ time: z.number(), count: z.number() })
    .optional(),
});
export type ViewportResponse = z.infer<typeof ViewportResponseSchema>;

export const ListingHistoryPointSchema = z.object({
  observed_at: z.string(),
  price: z.number().nullable(),
  estimated_rent: z.number().nullable(),
  days_on_market: z.number().nullable(),
});
export type ListingHistoryPoint = z.infer<typeof ListingHistoryPointSchema>;

export const ListingHistoryResponseSchema = z.object({
  points: z.array(ListingHistoryPointSchema),
});
export type ListingHistoryResponse = z.infer<
  typeof ListingHistoryResponseSchema
>;

/**
 * Saved search wire shape — mirrors `saved_searches` row in Postgres.
 * `params` is a free-form JSONB blob; the dashboard treats it as a partial
 * filter snapshot. Server returns `created_at` as an ISO timestamp string.
 */
export const SavedSearchSchema = z.object({
  id: z.union([z.number(), z.string()]),
  user_id: z.string(),
  name: z.string(),
  params: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const SavedSearchListSchema = z.array(SavedSearchSchema);

// -----------------------------------------------------------------------------
// Filtered listings — /api/properties/query (Wave 6, query-lang)
// -----------------------------------------------------------------------------
// Numeric columns ship as either string or number depending on the pg driver's
// cast (numeric/bigint come back as strings). The terminal coerces at the
// boundary; the schema stays permissive so we don't reject valid rows.

export const FilteredListingItemSchema = z.object({
  id: z.union([z.number(), z.string()]),
  address: z.string(),
  price: z.union([z.number(), z.string()]).nullable(),
  bedrooms: z.union([z.number(), z.string()]).nullable(),
  bathrooms: z.union([z.number(), z.string()]).nullable(),
  sqft: z.union([z.number(), z.string()]).nullable(),
  estimated_rent: z.union([z.number(), z.string()]).nullable(),
  year_built: z.number().nullable(),
  primary_photo: z.string().nullable(),
  listing_status: z.string().nullable(),
});
export type FilteredListingItem = z.infer<typeof FilteredListingItemSchema>;

export const FilteredListingsResponseSchema = z.object({
  items: z.array(FilteredListingItemSchema),
  usedColumns: z.array(z.string()),
  compiledWhere: z.string(),
});
export type FilteredListingsResponse = z.infer<
  typeof FilteredListingsResponseSchema
>;
