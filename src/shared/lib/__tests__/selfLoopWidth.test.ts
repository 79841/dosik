import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { buildEdgePath, SELF_LOOP_MIN_WIDTH } from "../edgeGeometry";

/**
 * #99 — the self-message loop's width used to be a constant (`36 + loopIndex * 22`). A label
 * wider than the loop spilled outside it, and there was no way to widen it. `selfLoopWidth`
 * replaces that constant.
 */
const loop = (selfLoopWidth?: number, selfLoopIndex = 0) =>
  buildEdgePath(
    { x: 100, y: 200, position: Position.Right },
    { x: 100, y: 280, position: Position.Right },
    {
      pathStyle: "straight",
      waypoints: [],
      parallelOffset: 0,
      obstacles: [],
      selfLoopIndex,
      selfLoopWidth,
    },
  ).points;

/** How far the loop reaches out from the anchor */
const reach = (pts: { x: number }[]) => Math.max(...pts.map((p) => p.x)) - pts[0]!.x;

describe("self-loop width (#99)", () => {
  it("uses the previous default when not set", () => {
    expect(reach(loop())).toBe(36);
    // the rule that spreads stacked loops apart still applies
    expect(reach(loop(undefined, 1))).toBe(58);
  });

  it("draws at the given width when set", () => {
    expect(reach(loop(120))).toBe(120);
    expect(reach(loop(24))).toBe(24);
  });

  it("a set width is not widened again by the stacking gap", () => {
    // if index added to the value the user dragged out, the drag would slip
    expect(reach(loop(120, 3))).toBe(120);
  });

  it("does not shrink below the minimum — there would be no room for the corners", () => {
    expect(reach(loop(0))).toBe(SELF_LOOP_MIN_WIDTH);
    expect(reach(loop(-40))).toBe(SELF_LOOP_MIN_WIDTH);
  });

  it("the chain stays at 4 points — the grip assumes this shape", () => {
    // The grip reads points[1] and points[2]. If the shape changed, the grip would attach in the wrong place
    expect(loop(120)).toHaveLength(4);
    expect(loop()).toHaveLength(4);
  });

  it("the outer leg is vertical — why the grip drags sideways", () => {
    const pts = loop(120);
    expect(pts[1]!.x).toBeCloseTo(pts[2]!.x, 5);
    expect(pts[1]!.y).not.toBeCloseTo(pts[2]!.y, 5);
  });
});
