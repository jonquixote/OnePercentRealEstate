import * as React from "react";

/**
 * JSON-LD structured-data tags for SEO.
 *
 * Renders a single <script type="application/ld+json"> element. Use on
 * property detail pages so search engines surface listing data in rich
 * results.
 */

export interface RealEstateListingData {
  url: string;
  name: string;
  description?: string;
  image?: string | string[];
  address?: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  geo?: { latitude: number; longitude: number };
  offers?: {
    price: number;
    priceCurrency?: string;
    availability?: "InStock" | "OutOfStock" | "PreOrder";
  };
  numberOfBedrooms?: number;
  numberOfBathrooms?: number;
  floorSize?: { value: number; unitCode?: "FTK" | "MTK" }; // FTK = sqft, MTK = sqm
  yearBuilt?: number;
  datePosted?: string; // ISO
}

function buildRealEstateJsonLd(data: RealEstateListingData) {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    url: data.url,
    name: data.name,
  };
  if (data.description) obj.description = data.description;
  if (data.image) obj.image = data.image;
  if (data.address) {
    obj.address = { "@type": "PostalAddress", ...data.address };
  }
  if (data.geo) {
    obj.geo = { "@type": "GeoCoordinates", ...data.geo };
  }
  if (data.offers) {
    obj.offers = {
      "@type": "Offer",
      priceCurrency: data.offers.priceCurrency ?? "USD",
      price: data.offers.price,
      availability: `https://schema.org/${data.offers.availability ?? "InStock"}`,
    };
  }
  if (data.numberOfBedrooms != null) obj.numberOfBedrooms = data.numberOfBedrooms;
  if (data.numberOfBathrooms != null) obj.numberOfBathroomsTotal = data.numberOfBathrooms;
  if (data.floorSize) {
    obj.floorSize = {
      "@type": "QuantitativeValue",
      value: data.floorSize.value,
      unitCode: data.floorSize.unitCode ?? "FTK",
    };
  }
  if (data.yearBuilt != null) obj.yearBuilt = data.yearBuilt;
  if (data.datePosted) obj.datePosted = data.datePosted;
  return obj;
}

export type SchemaKind = "RealEstateListing";

export function Schema({
  kind,
  data,
}:
  | { kind: "RealEstateListing"; data: RealEstateListingData }) {
  let payload: Record<string, unknown>;
  switch (kind) {
    case "RealEstateListing":
      payload = buildRealEstateJsonLd(data);
      break;
    default:
      return null;
  }

  // Escape `<` so a hostile field value containing `</script>` can't break
  // out of this <script> block. Listing data ultimately comes from MLS
  // scrapes which we treat as untrusted. This is the standard JSON-LD
  // hardening — see https://html.spec.whatwg.org/#restrictions-for-contents-of-script-elements.
  const safeJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}
