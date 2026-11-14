import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { buildEdgePath } from "../edgeGeometry";

/**
 * #204 D10 — paths are computed on the bounding box faces; only the drawn ends reach the actual outline.
 */
const base = { waypoints: [], parallelOffset: 0, obstacles: [] };
const source = { x: 100, y: 50, position: Position.Right };
const target = { x: 300, y: 50, position: Position.Left };

describe("buildEdgePath reach", () => {
  it("orthogonal: extends the first and last segments along the normal", () => {
    const plain = buildEdgePath(source, target, { ...base, pathStyle: "orthogonal" });
    const reached = buildEdgePath(source, target, {
      ...base,
      pathStyle: "orthogonal",
      reach: { source: { x: 96, y: 50 }, target: { x: 304, y: 50 } },
    });
    expect(reached.points.length).toBe(plain.points.length);
    expect(reached.points[0]).toEqual({ x: 96, y: 50 });
    expect(reached.points.at(-1)).toEqual({ x: 304, y: 50 });
    expect(reached.d.startsWith("M 96 50")).toBe(true);
  });

  it("orthogonal: prepends the outline point when the first segment is not parallel to the normal", () => {
    // when the two ends meet at one point, a short vertical tick remains — not parallel to the normal (right)
    const touching = { x: 200, y: 50, position: Position.Bottom };
    const facing = { x: 200, y: 50, position: Position.Top };
    const reached = buildEdgePath(touching, facing, {
      ...base,
      pathStyle: "orthogonal",
      stubs: { source: false, target: false },
      reach: { source: { x: 190, y: 50 } },
    });
    expect(reached.points[0]).toEqual({ x: 190, y: 50 });
  });

  it("straight / curved: the end point itself is the outline point", () => {
    const reach = { source: { x: 96, y: 40 }, target: { x: 304, y: 60 } };
    const straight = buildEdgePath(source, target, { ...base, pathStyle: "straight", reach });
    expect(straight.points[0]).toEqual(reach.source);
    expect(straight.points.at(-1)).toEqual(reach.target);
    const curved = buildEdgePath(source, target, { ...base, pathStyle: "curved", reach });
    expect(curved.points[0]).toEqual(reach.source);
    expect(curved.points.at(-1)).toEqual(reach.target);
  });

  it("self loops also reach the outline", () => {
    const right = { x: 160, y: 40, position: Position.Right };
    const top = { x: 120, y: 0, position: Position.Top };
    const reached = buildEdgePath(right, top, {
      ...base,
      pathStyle: "orthogonal",
      selfLoopIndex: 0,
      reach: { source: { x: 156, y: 40 }, target: { x: 120, y: 3 } },
    });
    expect(reached.points[0]).toEqual({ x: 156, y: 40 });
    expect(reached.points.at(-1)).toEqual({ x: 120, y: 3 });
  });

  it("without reach, nothing changes", () => {
    const a = buildEdgePath(source, target, { ...base, pathStyle: "orthogonal" });
    const b = buildEdgePath(source, target, { ...base, pathStyle: "orthogonal", reach: {} });
    expect(b).toEqual(a);
  });
});

describe("Orthogonal paths count bends including the stubs", () => {
  // right face → top face of the shape below: going right and bending down once (an L) is natural.
  // Counting only between the stub ends tied it with a staircase that bends inward first (3 bends), and that one was picked.
  const cases = [
    {
      s: { x: 160, y: 27, position: Position.Right },
      t: { x: 252, y: 122, position: Position.Top },
    },
    {
      s: { x: 160, y: 27, position: Position.Right },
      t: { x: 252, y: -68, position: Position.Bottom },
    },
    { s: { x: 0, y: 27, position: Position.Left }, t: { x: -92, y: 122, position: Position.Top } },
    {
      s: { x: 0, y: 27, position: Position.Left },
      t: { x: -92, y: -68, position: Position.Bottom },
    },
    {
      s: { x: 80, y: 54, position: Position.Bottom },
      t: { x: 172, y: 149, position: Position.Left },
    },
  ];
  it.each(cases)("$s.position → $t.position bends once", ({ s, t }) => {
    const { points } = buildEdgePath(s, t, { ...base, pathStyle: "orthogonal" });
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: s.x, y: s.y });
    expect(points[2]).toEqual({ x: t.x, y: t.y });
  });
});
