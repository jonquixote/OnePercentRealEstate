'use client';

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

/**
 * next/image with a "Photo pending" mat fallback when the source 404s.
 * Keeps the same footprint as the wrapped image (fills `relative` parents
 * when `fill`, otherwise inherits the passed className) so there is no CLS.
 */
export function Photo(props: ImageProps) {
  const { alt, className, fill, ...rest } = props;
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--ink-2)",
          color: "var(--mute)",
          ...(fill ? { position: "absolute", inset: 0 } : null),
        }}
      >
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Photo pending
        </span>
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className={className}
      fill={fill}
      onError={() => setErrored(true)}
      {...rest}
    />
  );
}
