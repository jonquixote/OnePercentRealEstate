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
