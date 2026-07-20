import { vi } from "vitest";

// maplibre-gl touches window.URL.createObjectURL at import time; jsdom lacks it.
if (typeof window !== "undefined" && !window.URL.createObjectURL) {
  window.URL.createObjectURL = vi.fn();
}
