import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  buildEdgePath,
  distanceToPolyline,
  facingPosition,
  polylinePointAtT,
  polylineProjectT,
  roundedPolylinePath,
  segmentMidpoints,
} from "../edgeGeometry";

const right = (x: number, y: number) => ({ x, y, position: Position.Right });
const left = (x: number, y: number) => ({ x, y, position: Position.Left });

const base = {
  waypoints: [],
  parallelOffset: 0,
  obstacles: [],
};

const isAxisAligned = (points: { x: number; y: number }[]): boolean => {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false;
  }
  return true;
};

describe("roundedPolylinePath edge cases", () => {
  it("an empty array gives an empty string", () => {
    expect(roundedPolylinePath([])).toBe("");
  });

  it("a single point gives only an M command", () => {
    expect(roundedPolylinePath([{ x: 3, y: 4 }])).toBe("M 3 4");
  });

  it("very close corners connect straight without rounding (r<0.5)", () => {
    const d = roundedPolylinePath([
      { x: 0, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0.4, y: 0.4 },
    ]);
    expect(d).toContain("L");
    expect(d).not.toContain("Q");
  });
});

describe("buildEdgePath style branches", () => {
  it("straight + parallel offset: the midpoint is pushed perpendicular", () => {
    const { points } = buildEdgePath(right(0, 0), left(100, 0), {
      ...base,
      pathStyle: "straight",
      parallelOffset: 12,
    });
    expect(points).toHaveLength(3);
    expect(Math.abs(points[1]!.y)).toBeCloseTo(12, 0);
  });

  it("curved with 2 points: a plain line path", () => {
    const { d } = buildEdgePath(right(0, 0), left(100, 0), {
      ...base,
      pathStyle: "curved",
      waypoints: [{ x: 50, y: 40 }],
    });
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("C");
  });

  it("curved: a bend-free curve is a cubic whose ends extend out of their faces — not a straight line (#204)", () => {
    // right face → top face of the shape below
    const { d, points } = buildEdgePath(
      right(0, 0),
      { x: 200, y: 160, position: Position.Top },
      {
        ...base,
        pathStyle: "curved",
      },
    );
    expect(d).toMatch(/^M 0 0 C /);
    // starts rightward (horizontal) and enters top-down (vertical)
    expect(Math.abs(points[1]!.y - points[0]!.y)).toBeLessThan(
      Math.abs(points[1]!.x - points[0]!.x),
    );
    const n = points.length;
    expect(Math.abs(points[n - 1]!.x - points[n - 2]!.x)).toBeLessThan(
      Math.abs(points[n - 1]!.y - points[n - 2]!.y),
    );
    // the middle sample is off the straight line joining the two ends
    const mid = points[Math.floor(n / 2)]!;
    const offLine = Math.abs(mid.x * 160 - mid.y * 200) / Math.hypot(200, 160);
    expect(offLine).toBeGreaterThan(10);
  });

  it("curved: parallel edges bend in opposite directions", () => {
    const a = buildEdgePath(right(0, 0), left(200, 0), {
      ...base,
      pathStyle: "curved",
      parallelOffset: 9,
    });
    const b = buildEdgePath(right(0, 0), left(200, 0), {
      ...base,
      pathStyle: "curved",
      parallelOffset: -9,
    });
    const midY = (p: { y: number }[]) => p[Math.floor(p.length / 2)]!.y;
    expect(Math.sign(midY(a.points))).toBe(-Math.sign(midY(b.points)));
  });

  it("orthogonal + parallel offset: adds a midpoint to a straight route, pushes it, and stays orthogonal", () => {
    const { points } = buildEdgePath(right(0, 0), left(200, 0), {
      ...base,
      pathStyle: "orthogonal",
      parallelOffset: 16,
    });
    expect(isAxisAligned(points)).toBe(true);
    expect(points.some((p) => Math.abs(p.y) > 8)).toBe(true);
  });

  it("self loop: same-axis handles (both right) make perpendicular detour corners", () => {
    const { points } = buildEdgePath(right(100, 20), right(100, 40), {
      ...base,
      pathStyle: "orthogonal",
      selfLoopIndex: 0,
    });
    expect(points.length).toBeGreaterThanOrEqual(4);
    // the loop goes out past the node's right side (x>100) and comes back
    expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(120);
  });

  it("a larger self loop index makes a larger loop", () => {
    const small = buildEdgePath(right(0, 0), right(0, 20), {
      ...base,
      pathStyle: "orthogonal",
      selfLoopIndex: 0,
    });
    const big = buildEdgePath(right(0, 0), right(0, 20), {
      ...base,
      pathStyle: "orthogonal",
      selfLoopIndex: 2,
    });
    const spanOf = (pts: { x: number }[]) => Math.max(...pts.map((p) => p.x));
    expect(spanOf(big.points)).toBeGreaterThan(spanOf(small.points));
  });

  it("orthogonal + waypoints + stubs off: the waypoint chain is made orthogonal", () => {
    const { points } = buildEdgePath(right(0, 0), left(300, 100), {
      ...base,
      pathStyle: "orthogonal",
      waypoints: [{ x: 150, y: 50 }],
      stubs: { source: false, target: false },
    });
    expect(isAxisAligned(points)).toBe(true);
  });
});

describe("facingPosition", () => {
  it("returns one of four directions by relative position", () => {
    expect(facingPosition({ x: 0, y: 0 }, { x: 100, y: 10 })).toBe(Position.Right);
    expect(facingPosition({ x: 0, y: 0 }, { x: -100, y: 10 })).toBe(Position.Left);
    expect(facingPosition({ x: 0, y: 0 }, { x: 10, y: 100 })).toBe(Position.Bottom);
    expect(facingPosition({ x: 0, y: 0 }, { x: 10, y: -100 })).toBe(Position.Top);
  });
});

describe("polyline helpers edge cases", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it("polylinePointAtT: empty array / single point / out-of-range t", () => {
    expect(polylinePointAtT([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(polylinePointAtT([{ x: 7, y: 8 }], 0.5)).toEqual({ x: 7, y: 8 });
    expect(polylinePointAtT(line, -1)).toEqual({ x: 0, y: 0 });
    expect(polylinePointAtT(line, 2)).toEqual({ x: 100, y: 0 });
  });

  it("polylinePointAtT: safe with zero-length segments", () => {
    const degenerate = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(polylinePointAtT(degenerate, 0.5)).toEqual({ x: 0, y: 0 });
  });

  it("polylineProjectT: fewer than 2 points gives 0.5", () => {
    expect(polylineProjectT([], { x: 1, y: 1 })).toBe(0.5);
    expect(polylineProjectT([{ x: 0, y: 0 }], { x: 1, y: 1 })).toBe(0.5);
  });

  it("polylineProjectT: points before the start / after the end clamp to 0/1", () => {
    expect(polylineProjectT(line, { x: -50, y: 10 })).toBe(0);
    expect(polylineProjectT(line, { x: 150, y: 10 })).toBe(1);
  });

  it("distanceToPolyline: a zero-length segment gives the distance to the point", () => {
    const degenerate = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(distanceToPolyline({ x: 13, y: 14 }, degenerate)).toBe(5);
  });

  it("segmentMidpoints: returns each segment's midpoint", () => {
    const mids = segmentMidpoints([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
    ]);
    expect(mids).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 30 },
    ]);
    expect(segmentMidpoints([{ x: 1, y: 1 }])).toEqual([]);
  });
});
