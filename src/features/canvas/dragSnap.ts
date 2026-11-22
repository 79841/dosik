import type { NodeChange, NodePositionChange } from "@xyflow/react";

import { alignToConnectors } from "../../shared/lib/connectorAlign";
import type { DiagramEdge, DiagramNode } from "../../shared/lib/types";

type XY = { x: number; y: number };

/**
 * How near the pane's edge a node drag makes React Flow slide the view — its
 * `calcAutoPan` default (`distance = 40`, @xyflow/system). Dosik does not set
 * its own, so this mirrors the library's — `xyDragContract.test.ts` holds the
 * zone rule and the drop's rounding to the real thing.
 */
export const AUTO_PAN_DISTANCE = 40;

/**
 * Whether React Flow slides the view under a drag with the pointer at
 * `client` (#228) — the rule `calcAutoPan` applies, a non-zero speed when the
 * pointer is less than `distance` from any edge of `pane`, or outside it.
 * Exactly `distance` away is still at rest.
 */
export const inAutoPanZone = (
  client: XY,
  pane: { left: number; top: number; width: number; height: number },
  distance = AUTO_PAN_DISTANCE,
): boolean => {
  const x = client.x - pane.left;
  const y = client.y - pane.top;
  return x < distance || x > pane.width - distance || y < distance || y > pane.height - distance;
};

/**
 * The moves that put dropped nodes back on the grid, rounded the way React
 * Flow snaps a drag (#228): one node to its nearest cell (`snapPosition`),
 * several by the first one's correction so they keep their spacing
 * (`calculateSnapOffset`). Nodes already in place are left out.
 */
export const snapDrop = (
  nodes: readonly { id: string; position: XY }[],
  [gx, gy]: readonly [number, number],
): { id: string; position: XY }[] => {
  const first = nodes[0];
  if (!first) return [];
  const snap = (p: XY): XY => ({ x: gx * Math.round(p.x / gx), y: gy * Math.round(p.y / gy) });
  const ref = snap(first.position);
  const dx = ref.x - first.position.x;
  const dy = ref.y - first.position.y;
  return nodes.flatMap(({ id, position }) => {
    const next =
      nodes.length === 1 ? ref : { x: Math.round(position.x + dx), y: Math.round(position.y + dy) };
    return next.x === position.x && next.y === position.y ? [] : [{ id, position: next }];
  });
};

/**
 * One batch of a node drag's moves, already on the grid, shifted by what
 * makes a connector to a shape left behind straight (`alignToConnectors`).
 * Everything moving shifts alike, so the shapes keep their spacing; `riders`
 * — what rides on the drag, keyed by the dragged node — count as moving too.
 * Only drag moves are touched: a resize from the left or top edge moves its
 * box without `dragging`, alongside its new size, and keeps its own move.
 */
export const alignDragMoves = (
  changes: NodeChange<DiagramNode>[],
  ctx: {
    nodes: readonly DiagramNode[];
    edges: readonly DiagramEdge[];
    riders: Readonly<Record<string, readonly string[]>> | null;
  },
): NodeChange<DiagramNode>[] => {
  if (changes.some((c) => c.type === "dimensions")) return changes;
  const moves = changes.filter(
    (c): c is NodePositionChange & { position: XY } =>
      c.type === "position" && !!c.position && c.dragging !== undefined,
  );
  if (moves.length === 0) return changes;
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  const at = new Map<string, XY>();
  for (const m of moves) {
    const node = byId.get(m.id);
    if (!node) continue;
    const dx = m.position.x - node.position.x;
    const dy = m.position.y - node.position.y;
    for (const id of ctx.riders?.[m.id] ?? []) {
      const rider = byId.get(id);
      if (rider && !at.has(id)) at.set(id, { x: rider.position.x + dx, y: rider.position.y + dy });
    }
  }
  // a dragged shape's own move wins over the one it would get as a rider
  for (const m of moves) at.set(m.id, m.position);
  const shift = alignToConnectors(ctx.nodes, ctx.edges, at);
  if (shift.x === 0 && shift.y === 0) return changes;
  const moving = new Set(moves.map((m) => m.id));
  return changes.map((c) =>
    c.type === "position" && c.position && moving.has(c.id)
      ? { ...c, position: { x: c.position.x + shift.x, y: c.position.y + shift.y } }
      : c,
  );
};

/**
 * The moves that put dropped nodes back on the grid after a pause in
 * snapping (`snapDrop`), shifted as a drag on the grid would be where that
 * makes a connector straight (`alignDragMoves`). Nodes already standing
 * there are left out.
 */
export const snapDropAligned = (
  dropped: readonly { id: string; position: XY }[],
  grid: readonly [number, number],
  ctx: Parameters<typeof alignDragMoves>[1],
): { id: string; position: XY }[] => {
  const landed = new Map(snapDrop(dropped, grid).map((m) => [m.id, m.position]));
  const now = new Map(ctx.nodes.map((n) => [n.id, n.position]));
  const aligned = alignDragMoves(
    dropped.map(({ id, position }) => ({
      type: "position",
      id,
      position: landed.get(id) ?? position,
      dragging: false,
    })),
    ctx,
  );
  return aligned.flatMap((c) => {
    if (c.type !== "position" || !c.position) return [];
    const at = now.get(c.id);
    return at && at.x === c.position.x && at.y === c.position.y
      ? []
      : [{ id: c.id, position: c.position }];
  });
};
