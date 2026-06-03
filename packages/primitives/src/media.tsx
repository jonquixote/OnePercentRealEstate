"use client";

import * as React from "react";
import Image, { type ImageProps } from "next/image";

/**
 * Listing media descriptor that the primitive consumes.
 *
 * The shape mirrors the `listings` columns added in the Wave 1 migration
 * `2026_06_03_media_abstraction.sql`. Wave 4 only reads `primary_photo`
 * (origin URL) and the optional `media_blur` placeholder. When the rehost
 * flip happens later, `media_source` is checked first and the fallback URL
 * (`fallback_url`) takes priority if populated.
 */
export type MediaSource = "origin" | "r2" | "cf-images";

export interface MediaInput {
  primary_photo?: string | null;
  media_source?: MediaSource | string | null;
  /** URL from media_fallback table if one exists; otherwise null/undefined */
  fallback_url?: string | null;
  /** raw bytes of an 8x8 LQIP jpeg; if present we synthesize a data: URL */
  media_blur?: Uint8Array | string | null;
}

/**
 * Resolve which URL to render today.
 *
 * Resolution order:
 *   1. fallback_url (Wave 5+ may populate via media_fallback table)
 *   2. media_source-specific URL (future: r2 / cf-images variant)
 *   3. primary_photo (origin URL — the only case populated today)
 *
 * Returns null if no usable URL exists.
 */
export function resolveMediaSrc(input: MediaInput | null | undefined): string | null {
  if (!input) return null;
  if (input.fallback_url) return input.fallback_url;
  // future branches for r2 / cf-images go here
  if (input.primary_photo) return input.primary_photo;
  return null;
}

function blobToDataUrl(buf: Uint8Array | string): string | undefined {
  if (typeof buf === "string") {
    // already a data URL or base64
    if (buf.startsWith("data:")) return buf;
    return `data:image/jpeg;base64,${buf}`;
  }
  if (typeof Buffer !== "undefined" && buf instanceof Uint8Array) {
    return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
  }
  return undefined;
}

export type MediaProps = Omit<ImageProps, "src"> & {
  media: MediaInput | null | undefined;
  /** Rendered when no URL can be resolved. Defaults to a neutral panel. */
  fallback?: React.ReactNode;
};

/**
 * Drop-in wrapper around next/image that consumes a `MediaInput` instead of
 * a string `src`. All `<img>` and direct `next/image` usage in the apps
 * should migrate to this so the eventual image-rehost flip is centralized.
 */
export function Media({ media, fallback, alt, ...rest }: MediaProps) {
  const src = resolveMediaSrc(media);
  if (!src) {
    return (
      <>
        {fallback ?? (
          <div
            data-slot="media-fallback"
            className="flex h-full w-full items-center justify-center bg-zinc-100 text-xs text-zinc-400"
            aria-label={alt || "no image available"}
          />
        )}
      </>
    );
  }

  const placeholderProps =
    media?.media_blur != null
      ? {
          placeholder: "blur" as const,
          blurDataURL: blobToDataUrl(media.media_blur),
        }
      : {};

  return <Image src={src} alt={alt ?? ""} {...placeholderProps} {...rest} />;
}
