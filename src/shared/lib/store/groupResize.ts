import { nodeBounds } from "../edgeUtils";
import { resizeFloor } from "../resizeFloor";
import type { DiagramEdge, DiagramNode } from "../types";

/**
 * Resizing a group as one (#179): the group's box gets handles of its own,
 * and dragging one scales every member — position and size — by the same
 * factors, anchored at the side that stays put. Pure functions; the canvas
 * owns the pointer and the store applies the result.
 */

export type Box = { x: number; y: number; width: number; height: number };

export type ResizeHandle =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left";

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
];

/** the box around the members (no outline padding) */
export const groupBox = (members: DiagramNode[]): Box => {
  const rects = members.map(nodeBounds);
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  };
};

/** an anchor (free-arrow end) is a point: it moves with the group but keeps its size */
const keepsSize = (n: DiagramNode) => n.data.shape === "anchor";

/**
 * The least scale on each axis that keeps every member at or above its own
 * resize floor — a group shrinks only as far as its tightest member allows.
 * A member already under its floor does not make the group grow (capped at
 * 1); `scaleGroup` lifts that member alone.
 */
export const scaleFloor = (members: DiagramNode[]): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  for (const n of members) {
    if (keepsSize(n)) continue;
    const { width, height } = nodeBounds(n);
    const floor = resizeFloor(n.data);
    // a member already under its floor (a file, an agent's size, a shape
    // change) must not make the group grow on the first nudge — it only stops
    // the group from shrinking; `scaleGroup` lifts that member alone (#179)
    if (width > 0) x = Math.max(x, Math.min(1, floor.width / width));
    if (height > 0) y = Math.max(y, Math.min(1, floor.height / height));
  }
  return { x, y };
};

/**
 * The group box after dragging `handle` by (dx, dy) in flow units. The
 * opposite side stays put, the box never shrinks under `minWidth`/`minHeight`
 * (and so never flips), and with `keepAspect` — a group holding a picture,
 * which must not be stretched — both axes follow the one that moved more. A
 * side handle under `keepAspect` grows the other axis from its start edge
 * (down or right); React Flow's own resizer grows it towards the handle
 * instead — the group keeps its top-left still, which reads less surprising.
 */
export const resizeBox = (
  from: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  limits: { minWidth: number; minHeight: number; keepAspect: boolean },
): Box => {
  const movesLeft = handle.includes("left");
  const movesRight = handle.includes("right");
  const movesTop = handle.includes("top");
  const movesBottom = handle.includes("bottom");
  let width = from.width + (movesRight ? dx : movesLeft ? -dx : 0);
  let height = from.height + (movesBottom ? dy : movesTop ? -dy : 0);
  if (limits.keepAspect) {
    const sx = width / from.width;
    const sy = height / from.height;
    const horizontal = movesLeft || movesRight;
    const vertical = movesTop || movesBottom;
    const s =
      horizontal && vertical
        ? Math.abs(sx - 1) >= Math.abs(sy - 1)
          ? sx
          : sy
        : horizontal
          ? sx
          : sy;
    const least = Math.max(limits.minWidth / from.width, limits.minHeight / from.height);
    width = from.width * Math.max(s, least);
    height = from.height * Math.max(s, least);
  } else {
    width = Math.max(width, limits.minWidth);
    height = Math.max(height, limits.minHeight);
  }
  return {
    x: movesLeft ? from.x + from.width - width : from.x,
    y: movesTop ? from.y + from.height - height : from.y,
    width,
    height,
  };
};

/**
 * Members of `ids` scaled from their current box onto `to`; everything else
 * untouched. Edges between two members carry their bends along; an edge
 * leaving the group keeps them here, and the store drops the ones the resize
 * spent when it ends (`pruneSpentWaypoints`, as for a single shape).
 */
export const scaleGroup = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  ids: readonly string[],
  to: Box,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const inGroup = new Set(ids);
  const members = nodes.filter((n) => inGroup.has(n.id));
  if (members.length === 0) return { nodes, edges };
  const from = groupBox(members);
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  const mapX = (x: number) => to.x + (x - from.x) * sx;
  const mapY = (y: number) => to.y + (y - from.y) * sy;

  const nextNodes = nodes.map((n) => {
    if (!inGroup.has(n.id)) return n;
    const b = nodeBounds(n);
    if (keepsSize(n)) {
      return {
        ...n,
        position: {
          x: Math.round(mapX(b.x + b.width / 2) - b.width / 2),
          y: Math.round(mapY(b.y + b.height / 2) - b.height / 2),
        },
      };
    }
    const floor = resizeFloor(n.data);
    const x = Math.round(mapX(b.x));
    const y = Math.round(mapY(b.y));
    return {
      ...n,
      position: { x, y },
      width: Math.max(floor.width, Math.round(mapX(b.x + b.width)) - x),
      height: Math.max(floor.height, Math.round(mapY(b.y + b.height)) - y),
    };
  });

  const nextEdges = edges.map((e): DiagramEdge => {
    const data = e.data;
    if (!data?.waypoints || !inGroup.has(e.source) || !inGroup.has(e.target)) return e;
    return {
      ...e,
      data: {
        ...data,
        waypoints: data.waypoints.map((p) => ({
          x: Math.round(mapX(p.x)),
          y: Math.round(mapY(p.y)),
        })),
      },
    };
  });
  return { nodes: nextNodes, edges: nextEdges };
};
