import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LayoutBar } from "@/components/Workspace";

const baseProps = {
  canSaveLayout: false,
  currentColumns: ["address", "price"],
  currentSort: null as null | { col: string; dir: "asc" | "desc" },
};

function mockFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }),
  );
}

describe("LayoutBar upgrade nudge", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("shows the upgrade line when a free user hits the cap", async () => {
    mockFetch({
      layouts: Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        name: `L${i}`,
        layout: { columns: [] },
        updated_at: "2026-07-19T00:00:00Z",
      })),
      limits: { max: 5, used: 5, tier: "free" },
    });

    render(<LayoutBar {...baseProps} />);

    const link = await screen.findByText(/5 layouts on the free desk/);
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe(
      "https://one.octavo.press/pricing?from=layouts",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("hides the upgrade line when under the cap", async () => {
    mockFetch({
      layouts: Array.from({ length: 2 }, (_, i) => ({
        id: i + 1,
        name: `L${i}`,
        layout: { columns: [] },
        updated_at: "2026-07-19T00:00:00Z",
      })),
      limits: { max: 5, used: 2, tier: "free" },
    });

    render(<LayoutBar {...baseProps} />);

    await screen.findByText("Layout");
    expect(screen.queryByText(/layouts on the free desk/)).toBeNull();
  });
});
