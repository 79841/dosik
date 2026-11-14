import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { buildEdgePath, type EndpointBounds } from "../edgeGeometry";

/**
 * A stub is the route's only side constraint — the one segment guaranteed to
 * leave (or enter) along its handle's own direction. `stubLengths` may shrink
 * it to nothing, and where it does, the router is free to arrive from any
 * direction; an edge pinned to a `left` handle then comes down into the box
 * from above (#96).
 *
 * The shrink is right for boxes pushed together (#86) and wrong everywhere
 * else, so these tests fence both sides of that line: the sweep pins that a
 * separated pair always keeps its declared sides, and the aligned-overlap
 * cases pin that #86 stays fixed.
 */

const W = 160;
const H = 60;

const DIR: Record<string, { x: number; y: number }> = {
  [Position.Right]: { x: 1, y: 0 },
  [Position.Left]: { x: -1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

const FACING_PAIRS: [Position, Position][] = [
  [Position.Right, Position.Left],
  [Position.Left, Position.Right],
  [Position.Bottom, Position.Top],
  [Position.Top, Position.Bottom],
];

const handleOf = (x: number, y: number, p: Position) =>
  p === Position.Right
    ? { x: x + W, y: y + H / 2 }
    : p === Position.Left
      ? { x, y: y + H / 2 }
      : p === Position.Top
        ? { x: x + W / 2, y }
        : { x: x + W / 2, y: y + H };

const route = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  sp: Position,
  tp: Position,
) => {
  const bounds: EndpointBounds = {
    source: { x: a.x, y: a.y, width: W, height: H },
    target: { x: b.x, y: b.y, width: W, height: H },
  };
  return buildEdgePath(
    { ...handleOf(a.x, a.y, sp), position: sp },
    { ...handleOf(b.x, b.y, tp), position: tp },
    {
      pathStyle: "orthogonal",
      waypoints: [],
      parallelOffset: 0,
      obstacles: [
        { x: a.x - 4, y: a.y - 4, width: W + 8, height: H + 8 },
        { x: b.x - 4, y: b.y - 4, width: W + 8, height: H + 8 },
      ],
      endpointBounds: bounds,
    },
  ).points;
};

/** `-0` and `0` differ to `toEqual`, so directions are normalised on the way out. */
const flip = (d: { x: number; y: number }) => ({
  x: d.x === 0 ? 0 : -d.x,
  y: d.y === 0 ? 0 : -d.y,
});

/** Direction of the last segment — where the line goes as it reaches the node. */
const entryDir = (pts: { x: number; y: number }[]) => {
  const last = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  return { x: Math.sign(last.x - prev.x), y: Math.sign(last.y - prev.y) };
};

describe("anchor side constraint (#96)", () => {
  it("the layout the user reported — enters the lower box's left anchor from the side", () => {
    // Leaves the upper shape on the right and enters the lower box on the left: nodes moved after
    // creation left the anchors facing away from each other. With shrinking, the line ran down the
    // box's left side from above and stabbed in
    const pts = route({ x: 0, y: 0 }, { x: 20, y: 300 }, Position.Right, Position.Left);
    expect(entryDir(pts)).toEqual({ x: 1, y: 0 });
    // The same goes for the start — a right anchor must leave to the right
    expect(Math.sign(pts[1]!.x - pts[0]!.x)).toBe(1);
  });

  it("enters through the anchor side even when the target is fully behind on the same row", () => {
    const pts = route({ x: 0, y: 0 }, { x: -400, y: 0 }, Position.Right, Position.Left);
    expect(entryDir(pts)).toEqual({ x: 1, y: 0 });
  });

  it.each([
    ["vertically facing away", { x: 0, y: 0 }, { x: 0, y: -300 }, Position.Bottom, Position.Top],
    ["diagonally facing away", { x: 0, y: 0 }, { x: -300, y: -220 }, Position.Right, Position.Left],
  ])("%s works the same way", (_name, a, b, sp, tp) => {
    const td = DIR[tp as string]!;
    expect(
      entryDir(
        route(
          a as { x: number; y: number },
          b as { x: number; y: number },
          sp as Position,
          tp as Position,
        ),
      ),
    ).toEqual(flip(td));
  });

  it("exhaustive sweep of separated layouts — no route ignores the anchor side", () => {
    const offenders: string[] = [];
    for (const [sp, tp] of FACING_PAIRS) {
      const td = DIR[tp]!;
      for (let dx = -400; dx <= 400; dx += 16) {
        for (let dy = -400; dy <= 400; dy += 16) {
          // Overlapping or touching pairs are where shrinking is intended (#86) — the tests below cover them
          if (Math.abs(dx) <= W && Math.abs(dy) <= H) continue;
          const pts = route({ x: 0, y: 0 }, { x: dx, y: dy }, sp, tp);
          const e = entryDir(pts);
          if (e.x !== -td.x || e.y !== -td.y) offenders.push(`${sp}->${tp} d=(${dx},${dy})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("touching or overlapping boxes still shrink (#86 regression)", () => {
  it.each([0, 16, 40, 100, 140])(
    "does not rise out of the boxes with an aligned %ipx overlap",
    (overlap) => {
      const pts = route({ x: 0, y: 0 }, { x: W - overlap, y: 0 }, Position.Right, Position.Left);
      // Both boxes share 0..H in y — any point outside that is a hook
      expect(pts.every((p) => p.y >= 0 && p.y <= H)).toBe(true);
      expect(pts.length).toBe(2);
    },
  );

  it("a touching pair still shrinks to a single grid step", () => {
    const pts = route({ x: 0, y: 0 }, { x: W, y: 0 }, Position.Right, Position.Left);
    expect(pts).toHaveLength(2);
    expect(Math.abs(pts[1]!.x - pts[0]!.x)).toBeLessThanOrEqual(8);
  });
});

describe("proportional shrinking of close facing pairs is kept (#69 regression)", () => {
  it("with an 8px gap the stubs shrink and no hook forms", () => {
    const pts = route({ x: 0, y: 0 }, { x: W + 8, y: 0 }, Position.Right, Position.Left);
    expect(pts.every((p) => p.y === H / 2)).toBe(true);
    expect(entryDir(pts)).toEqual({ x: 1, y: 0 });
  });
});
