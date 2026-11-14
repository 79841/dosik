import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  buildEdgePath,
  distanceToPolyline,
  facingPosition,
  polylinePointAtT,
  polylineProjectT,
  waypointsWorsenPath,
} from "../edgeGeometry";

const right = (x: number, y: number) => ({ x, y, position: Position.Right });
const left = (x: number, y: number) => ({ x, y, position: Position.Left });

const base = {
  waypoints: [],
  parallelOffset: 0,
  obstacles: [],
};

describe("buildEdgePath", () => {
  it("the straight style draws a line between the two points", () => {
    const built = buildEdgePath(right(0, 0), left(100, 0), { ...base, pathStyle: "straight" });
    expect(built.d).toBe("M 0 0 L 100 0");
    expect(built.points).toHaveLength(2);
  });

  it("includes waypoints in the path (straight)", () => {
    const built = buildEdgePath(right(0, 0), left(100, 0), {
      ...base,
      pathStyle: "straight",
      waypoints: [{ x: 50, y: 80 }],
    });
    expect(built.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 0 },
    ]);
  });

  it("the orthogonal style makes axis-aligned segments only", () => {
    const built = buildEdgePath(right(0, 0), left(200, 100), {
      ...base,
      pathStyle: "orthogonal",
    });
    for (let i = 0; i < built.points.length - 1; i++) {
      const a = built.points[i]!;
      const b = built.points[i + 1]!;
      const axisAligned = Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6;
      expect(axisAligned).toBe(true);
    }
  });

  it("orthogonal + waypoints: passes through the waypoints and stays orthogonal", () => {
    const wp = { x: 100, y: 150 };
    const built = buildEdgePath(right(0, 0), left(300, 0), {
      ...base,
      pathStyle: "orthogonal",
      waypoints: [wp],
    });
    expect(distanceToPolyline(wp, built.points)).toBeLessThan(1);
    for (let i = 0; i < built.points.length - 1; i++) {
      const a = built.points[i]!;
      const b = built.points[i + 1]!;
      expect(Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6).toBe(true);
    }
  });

  it("orthogonal routing picks a path around obstacles", () => {
    const obstacle = { x: 80, y: -40, width: 120, height: 80 };
    const built = buildEdgePath(right(0, 0), left(300, 0), {
      ...base,
      pathStyle: "orthogonal",
      obstacles: [obstacle],
    });
    // no polyline segment should cross the obstacle interior
    for (let i = 0; i < built.points.length - 1; i++) {
      const a = built.points[i]!;
      const b = built.points[i + 1]!;
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const crosses =
        minX < obstacle.x + obstacle.width &&
        maxX > obstacle.x &&
        minY < obstacle.y + obstacle.height &&
        maxY > obstacle.y;
      expect(crosses).toBe(false);
    }
  });

  it("approaching from the opposite handle makes no spike past the arrowhead", () => {
    // target's top handle approached from below (the reported bug): the path
    // must route around instead of overshooting past the arrowhead
    const targetRect = { x: -4, y: -4, width: 168, height: 64 };
    const built = buildEdgePath(
      { x: 300, y: 300, position: Position.Right },
      { x: 80, y: 0, position: Position.Top },
      { ...base, pathStyle: "orthogonal", obstacles: [targetRect] },
    );
    // no two consecutive segments may double back on each other
    for (let i = 0; i < built.points.length - 2; i++) {
      const a = built.points[i]!;
      const b = built.points[i + 1]!;
      const c = built.points[i + 2]!;
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const spike = Math.abs(cross) < 0.5 && dot < 0;
      expect(spike).toBe(false);
    }
    // final segment must enter the top handle downward (arrow points down)
    const last = built.points[built.points.length - 1]!;
    const beforeLast = built.points[built.points.length - 2]!;
    expect(last).toEqual({ x: 80, y: 0 });
    expect(beforeLast.y).toBeLessThan(last.y);
  });

  it("a free arrow (anchor ends) follows the drawn direction", () => {
    // anchors report no real side — the caller derives facing positions and
    // disables stubs; the final segment must then follow the drawn direction
    const cases = [
      { s: { x: 100, y: 100 }, t: { x: 340, y: 100 } }, // →
      { s: { x: 100, y: 100 }, t: { x: 100, y: 340 } }, // ↓
      { s: { x: 340, y: 340 }, t: { x: 340, y: 100 } }, // ↑
      { s: { x: 340, y: 100 }, t: { x: 100, y: 100 } }, // ←
    ];
    for (const { s, t } of cases) {
      const built = buildEdgePath(
        { ...s, position: facingPosition(s, t) },
        { ...t, position: facingPosition(t, s) },
        {
          ...base,
          pathStyle: "orthogonal",
          stubs: { source: false, target: false },
        },
      );
      const last = built.points[built.points.length - 1]!;
      const beforeLast = built.points[built.points.length - 2]!;
      // final segment direction must match the drawn direction
      expect(Math.sign(last.x - beforeLast.x)).toBe(Math.sign(t.x - s.x));
      expect(Math.sign(last.y - beforeLast.y)).toBe(Math.sign(t.y - s.y));
      // and the path must start/end exactly at the anchors (no stub overshoot)
      expect(built.points[0]).toEqual(s);
      expect(last).toEqual(t);
    }
  });

  it("a self loop leaves the node and comes back", () => {
    const built = buildEdgePath(
      right(100, 50),
      { x: 80, y: 0, position: Position.Top },
      {
        ...base,
        pathStyle: "orthogonal",
        selfLoopIndex: 0,
      },
    );
    expect(built.points.length).toBeGreaterThanOrEqual(4);
    expect(built.d).toContain("Q");
  });

  it("a self loop with ends spread on the same side makes a spike-free rectangular path", () => {
    // sequence self message: goes out to the right of the lifeline and comes back down
    const built = buildEdgePath(right(100, 100), right(100, 160), {
      ...base,
      pathStyle: "straight",
      selfLoopIndex: 0,
    });
    expect(built.points[0]).toEqual({ x: 100, y: 100 });
    expect(built.points[built.points.length - 1]).toEqual({ x: 100, y: 160 });
    expect(Math.max(...built.points.map((p) => p.x))).toBe(136);
    for (const p of built.points) {
      expect(p.y).toBeGreaterThanOrEqual(100);
      expect(p.y).toBeLessThanOrEqual(160);
    }
  });

  it("parallel offset moves the midpoints apart", () => {
    const a = buildEdgePath(right(0, 0), left(300, 0), {
      ...base,
      pathStyle: "straight",
      parallelOffset: 18,
    });
    const b = buildEdgePath(right(0, 0), left(300, 0), {
      ...base,
      pathStyle: "straight",
      parallelOffset: -18,
    });
    const midA = a.points[1]!;
    const midB = b.points[1]!;
    expect(Math.abs(midA.y - midB.y)).toBeGreaterThan(30);
  });
});

describe("polyline helpers", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("polylinePointAtT: the midpoint (t=0.5) is half the total arc length", () => {
    expect(polylinePointAtT(points, 0.5)).toEqual({ x: 100, y: 0 });
  });

  it("polylineProjectT: projects a point to a ratio along the polyline", () => {
    const t = polylineProjectT(points, { x: 100, y: 2 });
    expect(t).toBeCloseTo(0.5, 1);
  });

  it("distanceToPolyline: shortest distance to a segment", () => {
    expect(distanceToPolyline({ x: 50, y: 30 }, points)).toBeCloseTo(30, 5);
  });
});

describe("waypointsWorsenPath (#69)", () => {
  // right→left layout where the minimal H-V-H path has 2 bends
  const source = right(160, 40);
  const target = left(400, 160);

  it("no waypoints do not worsen the path", () => {
    expect(waypointsWorsenPath(source, target, [], [])).toBe(false);
  });

  it("a valid slide (same bend count) does not worsen the path", () => {
    // H-V-H with its vertical segment slid to x=320
    const waypoints = [
      { x: 320, y: 40 },
      { x: 320, y: 160 },
    ];
    expect(waypointsWorsenPath(source, target, waypoints, [])).toBe(false);
  });

  it("waypoints twisted by a node move worsen the path", () => {
    // a slide trace from when the target was at y=160, left behind after the target moved to y=-80
    const stale = [
      { x: 320, y: 40 },
      { x: 320, y: 160 },
    ];
    expect(waypointsWorsenPath(source, left(400, -80), stale, [])).toBe(true);
  });
});
