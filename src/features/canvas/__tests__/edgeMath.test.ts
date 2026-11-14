import { describe, expect, it } from "vitest";

import { DASH, nearestSegmentIndex, polylineLength } from "../edgeMath";

describe("polylineLength", () => {
  it("sums segment lengths", () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]),
    ).toBe(150);
    expect(polylineLength([{ x: 1, y: 1 }])).toBe(0);
    expect(polylineLength([])).toBe(0);
  });
});

describe("nearestSegmentIndex", () => {
  const chain = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("returns the index of the segment closest to a point", () => {
    expect(nearestSegmentIndex(chain, { x: 50, y: 5 })).toBe(0);
    expect(nearestSegmentIndex(chain, { x: 95, y: 60 })).toBe(1);
  });

  it("is safe with a zero-length segment", () => {
    const degenerate = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(nearestSegmentIndex(degenerate, { x: 90, y: 1 })).toBe(1);
  });
});

describe("DASH", () => {
  it("returns a dash pattern per variant", () => {
    expect(DASH.solid).toBeUndefined();
    expect(DASH.dashed).toBe("6 5");
    expect(DASH.dotted).toBe("1.5 5");
    expect(DASH.dashdot).toBe("9 4 1.5 4");
  });
});
