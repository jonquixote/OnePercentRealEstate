import { describe, it, expect } from "vitest";
import {
  PropertyListItemSchema,
  ViewportResponseSchema,
  SavedSearchSchema,
  FilteredListingsResponseSchema,
  StatsResponseSchema,
} from "./schemas";

describe("api-client wire schemas", () => {
  it("accepts a minimal valid PropertyListItem", () => {
    const row = {
      id: "123",
      address: "1 Main St",
      listing_price: 500000,
      estimated_rent: 4000,
      status: "for_sale",
      images: [],
      financial_snapshot: {
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1500,
      },
    };
    expect(PropertyListItemSchema.parse(row)).toMatchObject({ id: "123" });
  });

  it("rejects a PropertyListItem missing required fields", () => {
    const bad = { id: "123", address: "1 Main St" };
    expect(PropertyListItemSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts numeric columns as string or number in the viewport response", () => {
    const res = {
      type: "clusters",
      zoom: 11,
      data: [
        {
          latitude: 34.1,
          longitude: -118.3,
          count: "42",
          avg_price: "500000",
          min_price: 100000,
          max_price: null,
        },
      ],
    };
    expect(ViewportResponseSchema.parse(res).type).toBe("clusters");
  });

  it("treats SavedSearch.email_digest as optional (Tasks 2.1/2.2 opt-in)", () => {
    const base = {
      id: 1,
      user_id: "u1",
      name: "cheap houses",
      params: { minPrice: 100000 },
      created_at: "2026-07-12T00:00:00Z",
    };
    // valid without email_digest
    expect(SavedSearchSchema.parse(base).email_digest).toBeUndefined();
    // valid with it
    expect(SavedSearchSchema.parse({ ...base, email_digest: true }).email_digest).toBe(true);
  });

  it("parses a FilteredListingsResponse with mixed numeric types", () => {
    const res = {
      items: [
        {
          id: 7,
          address: "9 Oak Ave",
          price: "425000",
          bedrooms: 4,
          bathrooms: "2",
          sqft: null,
          estimated_rent: "3200",
          year_built: 1998,
          primary_photo: null,
          listing_status: "active",
        },
      ],
      usedColumns: ["price", "bedrooms"],
      compiledWhere: "price >= $1",
    };
    expect(FilteredListingsResponseSchema.parse(res).items).toHaveLength(1);
  });

  it("rejects a StatsResponse whose histogram rows are malformed", () => {
    const bad = {
      total: 10,
      onePercentPasses: 2,
      medianRatioPct: null,
      markets: 3,
      rentable: 8,
      rentCalcPending: 1,
      histogram: [{ loPct: 0 /* missing hiPct + count */ }],
      thresholdPct: 1,
      strategy: "one_percent",
      lastUpdated: null,
    };
    expect(StatsResponseSchema.safeParse(bad).success).toBe(false);
  });
});
