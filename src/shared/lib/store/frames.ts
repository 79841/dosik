import type { NodeChange } from "@xyflow/react";

import { nodeBounds } from "../edgeUtils";
import { isBackdrop } from "../palette";
import { liveGroups } from "./groups";
import type { DiagramEdge, DiagramNode } from "../types";

/**
 * What belongs to a frame (#170 D4): every node lying wholly inside it, a
 * frame inside it included. Decided by geometry when the frame moves — there
 * is no stored membership, so dragging a shape in makes it belong and
 * dragging it out lets it go.
 */
export const frameContents = (nodes: DiagramNode[], frame: DiagramNode): string[] => {
  const f = nodeBounds(frame);
  return nodes
    .filter((n) => {
      if (n.id === frame.id) return false;
      const b = nodeBounds(n);
      return (
        b.x >= f.x &&
        b.y >= f.y &&
        b.x + b.width <= f.x + f.width &&
        b.y + b.height <= f.y + f.height
      );
    })
    .map((n) => n.id);
};

/**
 * Everything that moves when `ids` move, followed through (#170, #171): what
 * lies inside a frame among them, and the rest of a group — a frame in a group
 * carries its contents, a shape inside a frame brings its group. The group
 * the user stepped into (`entered`) is not followed. `ids` themselves are
 * left out.
 */
export const riderClosure = (
  nodes: DiagramNode[],
  ids: readonly string[],
  entered: string | null = null,
): string[] => {
  const groups = liveGroups(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const moving = new Set(ids);
  const queue = [...ids];
  while (queue.length > 0) {
    const n = byId.get(queue.pop()!);
    if (!n) continue;
    const g = n.data.groupId;
    const more = [
      ...(n.data.shape === "frame" ? frameContents(nodes, n) : []),
      ...(g && g !== entered ? (groups.get(g) ?? []) : []),
    ];
    for (const id of more) {
      if (moving.has(id)) continue;
      moving.add(id);
      queue.push(id);
    }
  }
  return [...moving].filter((id) => !ids.includes(id));
};

/**
 * The riders of a drag that is starting, fixed now — so a frame swept over
 * other shapes mid-drag does not pick them up. Shapes that are themselves
 * being dragged are left out: React Flow already moves them, and riding too
 * would move them twice (#170 D5). Keyed by each dragged node; in one drag
 * they all move by the same step.
 */
export const dragRiders = (
  nodes: DiagramNode[],
  draggedIds: readonly string[],
  entered: string | null = null,
): Record<string, string[]> => {
  const riders = riderClosure(nodes, draggedIds, entered);
  return riders.length > 0 ? Object.fromEntries(draggedIds.map((id) => [id, riders])) : {};
};

/**
 * `changes` plus a matching move for everything riding on a moving node —
 * what lies inside a frame (#170), the rest of a shape's group (#171).
 * During a drag the riders were fixed at its start (`riders`, keyed by the
 * dragged node); `null` means no drag is on — a move by the arrow keys
 * (`dragging: false`), which moves the whole selection, a selected group
 * included — and a frame then takes what is inside it right now. A move that
 * is part of a resize from the left or top edge (no `dragging` at all, with a
 * size change beside it) carries nothing: a resize is the node's own.
 *
 * The end of a drag arrives as a move to where the node already is with
 * `dragging: false`; the riders get that too, or React Flow would go on
 * treating them as mid-drag — and a later selection box anywhere would pick
 * them up (#170).
 */
export const withFrameRiders = (
  changes: NodeChange<DiagramNode>[],
  nodes: DiagramNode[],
  riders: Record<string, string[]> | null,
  entered: string | null = null,
): NodeChange<DiagramNode>[] => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const moving = new Set(changes.filter((c) => c.type === "position").map((c) => c.id));
  const resized = new Set(changes.filter((c) => c.type === "dimensions").map((c) => c.id));
  const extra = new Map<string, NodeChange<DiagramNode>>();
  for (const change of changes) {
    if (change.type !== "position") continue;
    const moved = byId.get(change.id);
    if (!moved || resized.has(moved.id)) continue;
    if (!riders && change.dragging !== false) continue;
    const inside = riders
      ? (riders[moved.id] ?? [])
      : moved.data.shape === "frame"
        ? riderClosure(nodes, [moved.id], entered)
        : [];
    if (inside.length === 0) continue;
    const dx = change.position ? change.position.x - moved.position.x : 0;
    const dy = change.position ? change.position.y - moved.position.y : 0;
    const still = dx === 0 && dy === 0;
    // nothing to say: no move, and not the end of a drag
    if (still && change.dragging !== false) continue;
    for (const id of inside) {
      const node = byId.get(id);
      if (!node || moving.has(id) || extra.has(id)) continue;
      extra.set(id, {
        type: "position",
        id,
        position: { x: node.position.x + dx, y: node.position.y + dy },
        ...(change.dragging !== undefined ? { dragging: change.dragging } : {}),
      });
    }
  }
  return extra.size > 0 ? [...changes, ...extra.values()] : changes;
};

/**
 * Select changes from a selection box, minus the backdrops (fragment, frame)
 * it only touches: a box drawn inside a frame always touches it, and picking
 * the frame too would drag it — and all it holds — with the shapes the user
 * boxed, or delete it with them (#170). A backdrop the box holds whole
 * is kept. `box` is in diagram coordinates.
 */
export const withoutTouchedBackdrops = (
  changes: NodeChange<DiagramNode>[],
  nodes: DiagramNode[],
  box: { x: number; y: number; width: number; height: number },
): NodeChange<DiagramNode>[] => {
  const kept = changes.filter((c) => {
    if (c.type !== "select" || !c.selected) return true;
    const n = nodes.find((node) => node.id === c.id);
    if (!n || !isBackdrop(n.data.shape)) return true;
    const b = nodeBounds(n);
    return (
      b.x >= box.x &&
      b.y >= box.y &&
      b.x + b.width <= box.x + box.width &&
      b.y + b.height <= box.y + box.height
    );
  });
  return kept.length === changes.length ? changes : kept;
};

/**
 * Lines whose two ends moved together by the same step, at least one of them
 * a rider, take their bends along — a line inside a dragged frame keeps its
 * shape instead of springing back to bends left where the frame was (#170). Lines between shapes React Flow itself dragged are left as they
 * were before frames existed.
 */
export const carryBends = (
  edges: DiagramEdge[],
  before: DiagramNode[],
  after: DiagramNode[],
  riderIds: ReadonlySet<string>,
): DiagramEdge[] => {
  if (riderIds.size === 0) return edges;
  const was = new Map(before.map((n) => [n.id, n.position]));
  const step = (id: string) => {
    const now = after.find((n) => n.id === id)?.position;
    const old = was.get(id);
    return now && old ? { dx: now.x - old.x, dy: now.y - old.y } : null;
  };
  let changed = false;
  const out = edges.map((e) => {
    if (!e.data?.waypoints?.length) return e;
    if (!riderIds.has(e.source) && !riderIds.has(e.target)) return e;
    const a = step(e.source);
    const b = step(e.target);
    if (!a || !b || a.dx !== b.dx || a.dy !== b.dy || (a.dx === 0 && a.dy === 0)) return e;
    changed = true;
    return {
      ...e,
      data: {
        ...e.data,
        waypoints: e.data.waypoints.map((w) => ({ x: w.x + a.dx, y: w.y + a.dy })),
      },
    };
  });
  return changed ? out : edges;
};
