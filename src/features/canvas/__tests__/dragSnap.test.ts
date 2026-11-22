import type { NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import type { DiagramNode } from "../../../shared/lib/types";
import {
  AUTO_PAN_DISTANCE,
  alignDragMoves,
  inAutoPanZone,
  snapDrop,
  snapDropAligned,
} from "../dragSnap";

/**
 * #228 — a dragged shape shakes at the canvas edge.
 *
 * While a drag's pointer is within 40px of the canvas edge (outside included),
 * React Flow slides the view by a fraction of a pixel every frame
 * (`calcAutoPan`). Meanwhile the shape moves only in 8px steps, so it saws back
 * and forth under the pointer. This pins down the rule that marks out that
 * zone, and the rule that puts a shape dropped in it back on the grid.
 */
const pane = { left: 100, top: 50, width: 800, height: 600 };

describe("auto-pan zone (#228)", () => {
  it("the distance is React Flow's default, 40px", () => {
    expect(AUTO_PAN_DISTANCE).toBe(40);
  });

  it("the middle of the canvas is not in the zone", () => {
    expect(inAutoPanZone({ x: 500, y: 350 }, pane)).toBe(false);
  });

  it("within 40px of any of the four edges is in the zone", () => {
    expect(inAutoPanZone({ x: 100 + 39, y: 350 }, pane)).toBe(true); // left
    expect(inAutoPanZone({ x: 100 + 800 - 39, y: 350 }, pane)).toBe(true); // right
    expect(inAutoPanZone({ x: 500, y: 50 + 39 }, pane)).toBe(true); // top
    expect(inAutoPanZone({ x: 500, y: 50 + 600 - 39 }, pane)).toBe(true); // bottom
  });

  it("exactly 40px away is not in the zone — the boundary where calcAutoPan gives 0", () => {
    expect(inAutoPanZone({ x: 100 + 40, y: 350 }, pane)).toBe(false);
    expect(inAutoPanZone({ x: 100 + 800 - 40, y: 350 }, pane)).toBe(false);
    expect(inAutoPanZone({ x: 500, y: 50 + 40 }, pane)).toBe(false);
    expect(inAutoPanZone({ x: 500, y: 50 + 600 - 40 }, pane)).toBe(false);
  });

  it("outside the canvas is in the zone too — the view slides there as well", () => {
    expect(inAutoPanZone({ x: 20, y: 350 }, pane)).toBe(true);
    expect(inAutoPanZone({ x: 1200, y: 350 }, pane)).toBe(true);
    expect(inAutoPanZone({ x: 500, y: -10 }, pane)).toBe(true);
    expect(inAutoPanZone({ x: 500, y: 900 }, pane)).toBe(true);
  });

  it("takes another distance", () => {
    expect(inAutoPanZone({ x: 100 + 30, y: 350 }, pane, 20)).toBe(false);
    expect(inAutoPanZone({ x: 100 + 19, y: 350 }, pane, 20)).toBe(true);
  });
});

describe("a shape dropped in the zone goes back on the grid (#228)", () => {
  it("one shape goes to the nearest 8px cell — rounded like React Flow's snapPosition", () => {
    expect(snapDrop([{ id: "a", position: { x: 13.4, y: 99.7 } }], [8, 8])).toEqual([
      { id: "a", position: { x: 16, y: 96 } },
    ]);
    expect(snapDrop([{ id: "a", position: { x: 11.9, y: 4.1 } }], [8, 8])).toEqual([
      { id: "a", position: { x: 8, y: 8 } },
    ]);
  });

  it("nothing to change when already on the grid", () => {
    expect(snapDrop([{ id: "a", position: { x: 16, y: 96 } }], [8, 8])).toEqual([]);
  });

  it("several move together by the first one's correction and keep their spacing — like React Flow's multi-node drag", () => {
    const moves = snapDrop(
      [
        { id: "a", position: { x: 13.4, y: 99.7 } },
        // a shape off the grid to begin with — its spacing must be kept
        { id: "b", position: { x: 213.4 + 3, y: 199.7 } },
      ],
      [8, 8],
    );
    expect(moves).toEqual([
      { id: "a", position: { x: 16, y: 96 } },
      { id: "b", position: { x: 219, y: 196 } },
    ]);
  });

  it("nothing to change when several are already in place", () => {
    expect(
      snapDrop(
        [
          { id: "a", position: { x: 16, y: 96 } },
          { id: "b", position: { x: 219, y: 196 } },
        ],
        [8, 8],
      ),
    ).toEqual([]);
  });

  it("an empty list gives an empty list", () => {
    expect(snapDrop([], [8, 8])).toEqual([]);
  });
});

/*
 * A drag on the grid also lands where a connector to a shape left behind
 * runs straight: with a 160×144 box `a` and a 160×164 box `b` joined right
 * side to left side, that is `b` 10px above `a` — off the 8px grid.
 */
describe("a drag lines up a connector to a shape left behind", () => {
  const a = makeNode({ id: "a", x: 0, y: 0, width: 160, height: 144 });
  const b = makeNode({ id: "b", x: 240, y: 40, width: 160, height: 164 });
  const link = makeEdge({
    id: "e",
    source: "a",
    target: "b",
    sourceHandle: "right",
    targetHandle: "left",
  });
  const ctx = { nodes: [a, b], edges: [link], riders: null };
  const move = (id: string, x: number, y: number, dragging?: boolean): NodeChange<DiagramNode> => ({
    type: "position",
    id,
    position: { x, y },
    ...(dragging === undefined ? {} : { dragging }),
  });
  const positions = (changes: NodeChange<DiagramNode>[]) =>
    changes.flatMap((c) => (c.type === "position" && c.position ? [[c.id, c.position]] : []));

  it("shifts a drag the grid put 2px off to where the line runs straight", () => {
    expect(positions(alignDragMoves([move("b", 240, -8, true)], ctx))).toEqual([
      ["b", { x: 240, y: -10 }],
    ]);
  });

  it("shifts everything dragged alike, so the shapes keep their spacing", () => {
    const c = makeNode({ id: "c", x: 480, y: 40 });
    const out = alignDragMoves([move("b", 240, -8, true), move("c", 480, -8, true)], {
      ...ctx,
      nodes: [a, b, c],
    });
    expect(positions(out)).toEqual([
      ["b", { x: 240, y: -10 }],
      ["c", { x: 480, y: -10 }],
    ]);
  });

  it("counts what rides on the drag — a frame's contents line up too", () => {
    const frame = makeNode({ id: "f", shape: "frame", x: 200, y: 0, width: 400, height: 300 });
    const out = alignDragMoves([move("f", 200, -48, true)], {
      nodes: [a, frame, b],
      edges: [link],
      riders: { f: ["b"] },
    });
    // b rides 48px up to -8, 2px short of straight: the frame shifts the 2px
    expect(positions(out)).toEqual([["f", { x: 200, y: -50 }]]);
  });

  it("takes a rider shared by two dragged shapes along with the first of them", () => {
    // r rides on both b and c; b's step brings it 2px short of straight, c's
    // would leave it 6px past — b's counts, as in the store's carrying
    const r = makeNode({ id: "r", x: 240, y: 0, width: 160, height: 164 });
    const c = makeNode({ id: "c", x: 600, y: 0 });
    const out = alignDragMoves([move("b", 240, 32, true), move("c", 600, -16, true)], {
      nodes: [a, b, c, r],
      edges: [{ ...link, target: "r" }],
      riders: { b: ["r"], c: ["r"] },
    });
    expect(positions(out)).toEqual([
      ["b", { x: 240, y: 30 }],
      ["c", { x: 600, y: -18 }],
    ]);
  });

  it("leaves a move with no drag in it alone — a resize from the top edge", () => {
    const moves = [move("b", 240, -8)];
    expect(alignDragMoves(moves, ctx)).toBe(moves);
    const resize: NodeChange<DiagramNode>[] = [
      move("b", 240, -8, true),
      { type: "dimensions", id: "b", dimensions: { width: 160, height: 172 }, resizing: true },
    ];
    expect(alignDragMoves(resize, ctx)).toBe(resize);
  });

  it("leaves the grid's spot when no line is within reach", () => {
    const moves = [move("b", 240, 0, true)];
    expect(alignDragMoves(moves, ctx)).toBe(moves);
  });

  it("puts a drop after a pause in snapping where the line runs straight", () => {
    const raw = { ...b, position: { x: 240.4, y: -9.3 } };
    expect(
      snapDropAligned([{ id: "b", position: raw.position }], [8, 8], {
        ...ctx,
        nodes: [a, raw],
      }),
    ).toEqual([{ id: "b", position: { x: 240, y: -10 } }]);
  });

  it("leaves a drop already standing there out", () => {
    const there = { ...b, position: { x: 240, y: -10 } };
    expect(
      snapDropAligned([{ id: "b", position: { x: 240, y: -10 } }], [8, 8], {
        ...ctx,
        nodes: [a, there],
      }),
    ).toEqual([]);
  });
});
