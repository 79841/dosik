import { handlePointOnNode } from "./edgeUtils";
import { spreadsOnSides } from "./placeEnds";
import { parseSide, type Side } from "./sideAttach";
import type { DiagramEdge, DiagramNode } from "./types";

type XY = { x: number; y: number };

/**
 * How far (px) past the grid a dragged shape is pulled to make a connector
 * straight. The grid alone may have no spot for it: a box lands by its
 * top-left corner while a line's end sits part way down a side, so two boxes
 * of different heights can have their ends level only off the grid.
 */
export const ALIGN_REACH = 6;

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** true when an end on `side` at `from` looks out across open space at `to` */
const faces = (side: Side, from: XY, to: XY): boolean => {
  switch (side) {
    case "right":
      return to.x > from.x;
    case "left":
      return to.x < from.x;
    case "bottom":
      return to.y > from.y;
    case "top":
      return to.y < from.y;
  }
};

/**
 * The extra move, per axis, that makes a connector straight when the shapes
 * in `at` stand where the grid put them. Read are the orthogonal lines with no
 * bends of their own from one of those shapes to a shape outside, whose two
 * ends sit on facing sides and look at each other: right↔left lines
 * straighten in y, bottom↔top lines in x. Each end keeps its spot on its side
 * — the shapes move, not the ends. Of the lines within `reach`, the nearest
 * wins on each axis; 0 where none is.
 */
export const alignToConnectors = (
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
  at: ReadonlyMap<string, XY>,
  reach = ALIGN_REACH,
): XY => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = (n: DiagramNode): DiagramNode => {
    const p = at.get(n.id);
    return p ? { ...n, position: p } : n;
  };
  const best = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
  for (const e of edges) {
    const sourceMoves = at.has(e.source);
    if (sourceMoves === at.has(e.target)) continue;
    if ((e.data?.pathStyle ?? "orthogonal") !== "orthogonal") continue;
    if (e.data?.waypoints?.length) continue;
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target) continue;
    if (!spreadsOnSides(source.data.shape) || !spreadsOnSides(target.data.shape)) continue;
    const sourceSide = parseSide(e.sourceHandle);
    const targetSide = parseSide(e.targetHandle);
    if (!sourceSide || !targetSide || OPPOSITE[sourceSide] !== targetSide) continue;
    const sp = handlePointOnNode(placed(source), e.sourceHandle);
    const tp = handlePointOnNode(placed(target), e.targetHandle);
    if (!faces(sourceSide, sp, tp)) continue;
    const axis = sourceSide === "left" || sourceSide === "right" ? "y" : "x";
    // the move that brings the moving end level with the one that stays, to
    // a hundredth of a px: a spot part way down a side gives long fractions
    const need = Math.round((sourceMoves ? tp[axis] - sp[axis] : sp[axis] - tp[axis]) * 100) / 100;
    // a tie keeps the line met first, so a drag never flips between the two
    if (Math.abs(need) <= reach && Math.abs(need) < Math.abs(best[axis])) best[axis] = need;
  }
  return {
    x: Number.isFinite(best.x) ? best.x : 0,
    y: Number.isFinite(best.y) ? best.y : 0,
  };
};
