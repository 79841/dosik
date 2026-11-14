import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  buildEdgePath,
  distanceToPolyline,
  slideSegment,
  stubPoints,
  type Point,
} from "../edgeGeometry";

const right = (x: number, y: number) => ({ x, y, position: Position.Right });
const left = (x: number, y: number) => ({ x, y, position: Position.Left });

/**
 * A segment where the line doubles back over itself (a spike). True when it reverses along the same axis.
 * It is drawn on top of itself, so it looks like a "dead stub" (#53).
 */
const hasSpike = (points: Point[]): boolean => {
  for (let i = 0; i < points.length - 2; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const c = points[i + 2]!;
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 0.5 && dot < 0) return true;
  }
  return false;
};

// Staple layout: right→left, the rendered polyline has 4 points (simplify absorbs the stubs)
const source = right(160, 28);
const target = left(560, 248);
const rendered = () =>
  buildEdgePath(source, target, {
    pathStyle: "orthogonal",
    waypoints: [],
    parallelOffset: 0,
    obstacles: [],
  }).points;

/** The route redrawn from the slide result as stored waypoints — the same flow as LabeledEdge */
const renderAfterSlide = (to: Point) => {
  const stubs = stubPoints(source, target);
  const waypoints = slideSegment(rendered(), 1, to, stubs).slice(1, -1);
  return buildEdgePath(source, target, {
    pathStyle: "orthogonal",
    waypoints,
    parallelOffset: 0,
    obstacles: [],
  }).points;
};

describe("stub clamp for segment slides (#53)", () => {
  it("stops at the stub when dragged inside it", () => {
    const stubs = stubPoints(source, target);
    expect(stubs.source).toEqual({ x: 176, y: 28 });

    // drag far to the left of the source stub (x=176)
    const out = slideSegment(rendered(), 1, { x: 100, y: 138 }, stubs);
    expect(out[1]!.x).toBeCloseTo(176, 5);
    expect(out[2]!.x).toBeCloseTo(176, 5);
  });

  it("the line does not double back over itself even when dragged past the stub", () => {
    expect(hasSpike(renderAfterSlide({ x: 100, y: 138 }))).toBe(false);
  });

  it("blocks the target-side stub by the same rule", () => {
    const out = slideSegment(rendered(), 1, { x: 600, y: 138 }, stubPoints(source, target));
    expect(out[1]!.x).toBeCloseTo(544, 5); // tStub.x
    expect(hasSpike(renderAfterSlide({ x: 600, y: 138 }))).toBe(false);
  });

  it("a normal slide between the stubs passes through unchanged", () => {
    const out = slideSegment(rendered(), 1, { x: 300, y: 138 }, stubPoints(source, target));
    expect(out[1]!.x).toBeCloseTo(300, 5);
    expect(hasSpike(renderAfterSlide({ x: 300, y: 138 }))).toBe(false);
  });

  it("behaves as before without clamp arguments (the pure-function contract holds)", () => {
    const out = slideSegment(rendered(), 1, { x: 100, y: 138 });
    expect(out[1]!.x).toBeCloseTo(100, 5);
  });

  it("touching a chain already inside the stub does not teleport it to the boundary", () => {
    // A stale chain from a file load or a bridge update_edge must not jump hundreds of px
    // the moment it is grabbed. The clamp only blocks "going further in".
    const inside: Point[] = [
      { x: 160, y: 28 },
      { x: 176, y: 28 },
      { x: 100, y: 28 },
      { x: 100, y: 248 },
      { x: 560, y: 248 },
    ];
    const stubs = stubPoints(source, target);
    // passing the unmoved state (the current midpoint) must leave the chain as it is
    const held = slideSegment(inside, 2, { x: 100, y: 138 }, stubs);
    expect(held[2]!.x).toBeCloseTo(100, 5);
    expect(held[3]!.x).toBeCloseTo(100, 5);
  });

  it("stays put when both constraints conflict in a facing layout", () => {
    // a gap narrow enough to shrink the stubs — lo/hi must not invert
    const near = right(112, -105);
    const farSide = left(113, 220);
    const stubs = stubPoints(near, farSide);
    const chain: Point[] = [
      { x: 112, y: -105 },
      { x: -181, y: -105 },
      { x: -181, y: 220 },
      { x: 113, y: 220 },
    ];
    const held = slideSegment(chain, 1, { x: -181, y: 57 }, stubs);
    expect(held[1]!.x).toBeCloseTo(-181, 5);
  });

  // #85: aligning a segment exactly with the opposite endpoint's column collapsed the segment
  // in between to zero length, making it endpoint-adjacent after the fact. The clamp only looks at
  // adjacency when the drag starts, so it missed this; the landing band (0.6px) blocks it.
  it("no spike forms even when aligned exactly with an endpoint column (#85)", () => {
    const src = right(160, 28);
    const dst = { x: 380, y: 256, position: Position.Bottom };
    const frozen = buildEdgePath(src, dst, {
      pathStyle: "orthogonal",
      waypoints: [],
      parallelOffset: 0,
      obstacles: [],
    }).points;
    const waypoints = slideSegment(frozen, 1, { x: 380, y: 150 }, stubPoints(src, dst)).slice(
      1,
      -1,
    );
    const after = buildEdgePath(src, dst, {
      pathStyle: "orthogonal",
      waypoints,
      parallelOffset: 0,
      obstacles: [],
    }).points;
    expect(hasSpike(after)).toBe(false);
  });

  it("the band does not push away #53's exact landing on the stub", () => {
    // A stub under the adjacency constraint must be excluded from the band — stopping exactly here
    // is what the #53 clamp intends, so the band stepping in would break it.
    const out = slideSegment(rendered(), 1, { x: 100, y: 138 }, stubPoints(source, target));
    expect(out[1]!.x).toBeCloseTo(176, 5); // 176, not 176.6
  });

  it("a normal slide near the opposite endpoint column follows as usual", () => {
    // the band only works within a ±0.5px window — 2px away is left alone
    const src = right(160, 28);
    const dst = { x: 380, y: 256, position: Position.Bottom };
    const frozen = buildEdgePath(src, dst, {
      pathStyle: "orthogonal",
      waypoints: [],
      parallelOffset: 0,
      obstacles: [],
    }).points;
    const out = slideSegment(frozen, 1, { x: 374, y: 150 }, stubPoints(src, dst));
    expect(out[1]!.x).toBeCloseTo(374, 5);
  });

  it("steps aside 0.6px to the far side when the near side is blocked by the clamp", () => {
    // The target stub column (176.55) is 0.55px from the source clamp boundary (176) — the near side
    // (175.95) is beyond the boundary and blocked, so it must go to the far side (177.15).
    const src = right(160, 28);
    const dst = { x: 176.55, y: 256, position: Position.Bottom };
    const stubs = stubPoints(src, dst);
    const frozen = buildEdgePath(src, dst, {
      pathStyle: "orthogonal",
      waypoints: [],
      parallelOffset: 0,
      obstacles: [],
    }).points;
    for (const to of [176.2, 176.4, 176.55]) {
      const out = slideSegment(frozen, 1, { x: to, y: 150 }, stubs);
      expect(out[1]!.x).toBeCloseTo(177.15, 4); // far fallback
      expect(out[1]!.x).toBeGreaterThanOrEqual(176 - 1e-6); // clamp lower bound holds
    }
  });

  it("the band also blocks an adjacent stub whose constraint is inert (k=0)", () => {
    // In a near-degenerate chain whose end segment turned diagonal after a dedupe merge, the stub
    // constraint yields no boundary even when adjacent. If the band were off too, #85 would remain.
    const src = right(160, 28);
    const dst = { x: 176.3, y: 256, position: Position.Bottom };
    const stubs = stubPoints(src, dst);
    const frozen = buildEdgePath(src, dst, {
      pathStyle: "orthogonal",
      waypoints: [],
      parallelOffset: 0,
      obstacles: [],
    }).points;
    const waypoints = slideSegment(frozen, 1, { x: 176.32, y: 150 }, stubs).slice(1, -1);
    const after = buildEdgePath(src, dst, {
      pathStyle: "orthogonal",
      waypoints,
      parallelOffset: 0,
      obstacles: [],
    }).points;
    expect(hasSpike(after)).toBe(false);
  });

  it("does not clamp an anchored endpoint (stub 0)", () => {
    // a free arrow has no stub, so there is nothing to double back over
    const anchorStubs = stubPoints(source, target, { source: false, target: false });
    expect(anchorStubs.source).toEqual({ x: 160, y: 28 });
    const out = slideSegment(rendered(), 1, { x: 100, y: 138 }, anchorStubs);
    expect(out[1]!.x).toBeCloseTo(100, 5);
  });
});

// #86 — when boxes touched or overlapped, the two 16px stubs passed each other and the router
// came back with a hook over the boxes. Shrinking both stubs down to 0 prevents it.
describe("hooks in touching and overlapping layouts (#86)", () => {
  const box = (x: number, y: number) => ({ x: x - 4, y: y - 4, width: 168, height: 64 });

  /** Leaving the two boxes' vertical range and coming back is a hook */
  const hooksOver = (points: Point[], top: number, bottom: number): boolean =>
    points.some((p) => p.y < top - 1 || p.y > bottom + 1);

  it.each([-40, -16, -4, 0])("does not detour over the boxes with a %ipx gap", (gap) => {
    // Target (left) ← Source (right), anchors facing each other
    const sourceX = 160 + gap;
    const built = buildEdgePath(
      { x: sourceX, y: 28, position: Position.Left },
      { x: 160, y: 28, position: Position.Right },
      {
        pathStyle: "orthogonal",
        waypoints: [],
        parallelOffset: 0,
        obstacles: [box(sourceX, 0), box(0, 0)],
      },
    );
    expect(hooksOver(built.points, 0, 56)).toBe(false);
    expect(hasSpike(built.points)).toBe(false);
    // With a 1-point polyline the two assertions above are trivially true and pass vacuously.
    // This also rules out a line that can be neither seen nor grabbed (and so cannot be deleted).
    expect(built.points.length).toBeGreaterThan(1);
  });

  it("does not produce a degenerate 1-point route even when the handles coincide exactly", () => {
    // Butting the two boxes together puts both anchors on the same point. A 1-point polyline breaks
    // the invariant "a chain has at least one segment", so distanceToPolyline becomes Infinity and
    // the hit path loses its stroke geometry — a short tick removes that degeneracy (#86).
    // This assertion pins the tick (a single point fails with Infinity). In the facing combination
    // the tick is hidden behind the two boxes and still cannot be grabbed — judged to be
    // natural (user, 2026-08-18). Drop-split was removed in #91.
    const built = buildEdgePath(
      { x: 160, y: 28, position: Position.Left },
      { x: 160, y: 28, position: Position.Right },
      { pathStyle: "orthogonal", waypoints: [], parallelOffset: 0, obstacles: [] },
    );
    expect(built.points).toHaveLength(2);
    expect(built.d).not.toBe("M 160 28");
    expect(distanceToPolyline({ x: 160, y: 28 }, built.points)).toBeLessThan(1);
  });

  it("stub shrinking at a normal gap is unchanged (#69 regression)", () => {
    // an 8px gap → each stub shrinks to 4px and they meet in the middle
    const built = buildEdgePath(
      { x: 168, y: 28, position: Position.Left },
      { x: 160, y: 28, position: Position.Right },
      { pathStyle: "orthogonal", waypoints: [], parallelOffset: 0, obstacles: [] },
    );
    expect(built.points).toEqual([
      { x: 168, y: 28 },
      { x: 160, y: 28 },
    ]);
    // simplify absorbs the stub points, so the assertions above alone do not pin the shrinking
    const stubs = stubPoints(
      { x: 168, y: 28, position: Position.Left },
      { x: 160, y: 28, position: Position.Right },
    );
    expect(stubs.source).toEqual({ x: 164, y: 28 });
    expect(stubs.target).toEqual({ x: 164, y: 28 });
  });
});
