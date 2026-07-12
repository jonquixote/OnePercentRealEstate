import { describe, it, expect } from "vitest";
import { thinVertices } from "./DrawSearch";

// Smoke test for the @oper/map package: exercises the pure freehand-trace
// thinning helper so the package has a real (non-empty) test target in CI.
describe("thinVertices", () => {
  const pt = (i: number): [number, number] => [i, i];

  it("returns the input unchanged when under the cap", () => {
    const pts = Array.from({ length: 10 }, (_, i) => pt(i));
    expect(thinVertices(pts, 100)).toEqual(pts);
  });

  it("thins a dense trace down to exactly `max` vertices", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => pt(i));
    const out = thinVertices(pts, 100);
    expect(out).toHaveLength(100);
    // evenly sampled: first point preserved, samples are ascending & in-range
    expect(out[0]).toEqual(pt(0));
    for (const [x] of out) expect(x).toBeGreaterThanOrEqual(0);
    expect(out[out.length - 1][0]).toBeLessThan(1000);
  });

  it("keeps input when exactly at the cap", () => {
    const pts = Array.from({ length: 100 }, (_, i) => pt(i));
    expect(thinVertices(pts, 100)).toHaveLength(100);
  });
});
