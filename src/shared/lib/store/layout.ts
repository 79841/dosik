import {
  type Arrangement,
  computeArrangement,
  type LayoutDirection,
  NOT_LAID_OUT,
} from "../autoLayout";
import { isSequenceMessage } from "../edgeUtils";
import type { DiagramEdge, DiagramNode } from "../types";
import { frameContents } from "./frames";
import { bothEnds, placeEnds } from "../placeEnds";
import { pickHandles } from "./nodeFactory";
import type { StoreGet, StoreSet } from "./state";

/**
 * What the toolbar's Layout arranges (#182): the selected shapes, and what
 * lies inside a selected frame — never the whole diagram, which could pull
 * unrelated diagrams on the same page into one block. Shapes the layout
 * leaves alone (sequence parts, frames themselves) are dropped. Frame
 * membership is asked in three places — here, `riderClosure` (drags) and
 * `computeArrangement` (frame fitting); a change to the rule touches all three.
 */
export const arrangeableSelection = (nodes: DiagramNode[]): string[] => {
  const picked = new Set<string>();
  for (const n of nodes) {
    if (!n.selected) continue;
    picked.add(n.id);
    if (n.data.shape === "frame") for (const id of frameContents(nodes, n)) picked.add(id);
  }
  return nodes
    .filter((n) => picked.has(n.id) && !NOT_LAID_OUT.includes(n.data.shape))
    .map((n) => n.id);
};

/**
 * Moves the laid-out shapes to their new places and re-fits the edges that
 * touch them (#3). Shared by the toolbar action and the bridge op so the two
 * cannot arrange differently. No history frame — the caller owns that.
 *
 * An edge on a moved shape gets its sides picked again, the way a new edge
 * does (`pickHandles`, the fixed-handle decision): the old sides were chosen
 * for where the shapes used to be. Its bends go too — they were bends around
 * the old layout. Messages and self-loops keep theirs: a message's handles are
 * its y, and a loop's sides do not depend on where its node is.
 */
type LaidOut = { nodes: DiagramNode[]; edges: DiagramEdge[] };

const laidOut = (nodes: DiagramNode[], edges: DiagramEdge[], arrangement: Arrangement): LaidOut => {
  const { positions, frames } = arrangement;
  const nextNodes = nodes.map((n) => {
    const p = positions.get(n.id);
    if (p) return { ...n, position: p };
    // a frame grown — and maybe moved — to keep holding its shapes (#182)
    const f = frames.get(n.id);
    return f ? { ...n, position: { x: f.x, y: f.y }, width: f.width, height: f.height } : n;
  });
  const byId = new Map(nextNodes.map((n) => [n.id, n]));
  const repicked: string[] = [];
  const pickedEdges = edges.map((e) => {
    if (e.source === e.target) return e;
    if (!positions.has(e.source) && !positions.has(e.target)) return e;
    if (isSequenceMessage(e, nextNodes)) return e;
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    if (!source || !target) return e;
    const picked = pickHandles(source, target);
    // A lifeline end that carries a `-<pct>` handle is the height the user
    // attached it at, not a side to pick again (#154) — keep it
    const keep = (node: typeof source, handle: string | null | undefined, fresh: string) =>
      node.data.shape === "lifeline" && /^(left|right)-/.test(handle ?? "")
        ? (handle as string)
        : fresh;
    const handles = {
      sourceHandle: keep(source, e.sourceHandle, picked.sourceHandle),
      targetHandle: keep(target, e.targetHandle, picked.targetHandle),
    };
    repicked.push(e.id);
    if (!e.data?.waypoints) return { ...e, ...handles };
    const { waypoints: _stale, ...data } = e.data;
    return { ...e, ...handles, data };
  });
  // new sides, so new spots along them — spread like any end nobody placed (#204 D7)
  return { nodes: nextNodes, edges: placeEnds(nextNodes, pickedEdges, bothEnds(repicked)) };
};

export const applyLayout = (
  get: StoreGet,
  set: StoreSet,
  arrangement: Arrangement,
  planned?: LaidOut,
): string[] => {
  const { nodes, edges } = get();
  set(planned ?? laidOut(nodes, edges, arrangement));
  // a grown frame changed too — the bridge flashes it with the shapes
  return [...arrangement.positions.keys(), ...arrangement.frames.keys()];
};

/**
 * What the arrangement would leave, or null when it would change nothing —
 * then there is nothing to undo either. Shapes already in place can still
 * have their ends bunched from before ends were spread (#204), so the edges
 * count too. Hand the result to `applyLayout` so the verdict and the change
 * are the same computation.
 */
export const planLayout = (get: StoreGet, arrangement: Arrangement): LaidOut | null => {
  const { nodes, edges } = get();
  const planned = laidOut(nodes, edges, arrangement);
  if (arrangement.frames.size > 0) return planned;
  const moves = nodes.some((n) => {
    const p = arrangement.positions.get(n.id);
    return p !== undefined && (p.x !== n.position.x || p.y !== n.position.y);
  });
  if (moves) return planned;
  const same = planned.edges.every(
    (e, i) =>
      e.sourceHandle === edges[i]!.sourceHandle &&
      e.targetHandle === edges[i]!.targetHandle &&
      e.data?.waypoints === edges[i]!.data?.waypoints,
  );
  return same ? null : planned;
};

export const layoutPositions = (
  get: StoreGet,
  direction: LayoutDirection,
  ids?: string[],
): Arrangement => {
  const { nodes, edges } = get();
  return computeArrangement(nodes, edges, { direction, ids });
};
