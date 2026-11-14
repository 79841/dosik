import { Position } from "@xyflow/react";

import { waypointsWorsenPath, type Rect } from "./edgeGeometry";
import { DEFAULT_NODE_SIZE, isBackdrop, LIFELINE_ACTIVATION_W, LIFELINE_HEADER_H } from "./palette";
import {
  handleRatio,
  nearestSide,
  outlineInset,
  parseSide,
  projectToSide,
  type Side,
  sideHandle,
} from "./sideAttach";
import { visibleActivation, visibleDestroyY } from "./store/opValidation";
import type {
  DiagramEdge,
  DiagramEdgeData,
  DiagramNode,
  EdgeStylePatch,
  MarkerShape,
} from "./types";

export const DEFAULT_EDGE_WIDTH = 1.25;

/** Fields remembered as the "last used" edge style, applied to new edges. */
export const EDGE_STYLE_KEYS = [
  "variant",
  "color",
  "width",
  "opacity",
  "animated",
  "pathStyle",
  "markerStart",
  "markerEnd",
  "markerSize",
] as const satisfies readonly (keyof EdgeStylePatch)[];

export const pickEdgeStyle = (data: Partial<DiagramEdgeData>): EdgeStylePatch => {
  const out: Record<string, unknown> = {};
  for (const key of EDGE_STYLE_KEYS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out as EdgeStylePatch;
};

/** End marker, honoring the legacy `arrow` boolean when `markerEnd` is unset. */
export const effectiveMarkerEnd = (data: Partial<DiagramEdgeData> | undefined): MarkerShape =>
  data?.markerEnd ?? ((data?.arrow ?? true) ? "arrow" : "none");

/**
 * The end a line being drawn now gets (#210 D24): the one asked for, none for
 * the legacy `arrow: false`, otherwise the open chevron. A line read from a
 * file goes through `effectiveMarkerEnd`, whose fallback stays the filled arrow
 * — an old document must look the way it was saved.
 */
export const newEdgeMarkerEnd = (
  data: { arrow?: boolean; markerEnd?: MarkerShape } | undefined,
): MarkerShape => data?.markerEnd ?? (data?.arrow === false ? "none" : "open");

/**
 * A new sequence message's end: UML's filled arrow for a call, unless an end was
 * chosen (#210 D24) — the legacy `arrow: false` still meaning none, as for any line.
 */
export const newMessageMarkerEnd = (
  data: { arrow?: boolean; markerEnd?: MarkerShape } | undefined,
): MarkerShape => data?.markerEnd ?? (data?.arrow === false ? "none" : "arrow");

/**
 * The end a line being drawn shows — the one the drop will make: a message's
 * when it runs between two lifelines, a new line's otherwise (#210).
 */
export const connectionEndShape = (
  lastStyle: { arrow?: boolean; markerEnd?: MarkerShape } | undefined,
  isMessage: boolean,
): MarkerShape => (isMessage ? newMessageMarkerEnd(lastStyle) : newEdgeMarkerEnd(lastStyle));

export const effectiveMarkerStart = (data: Partial<DiagramEdgeData> | undefined): MarkerShape =>
  data?.markerStart ?? "none";

export const nodeBounds = (
  node: DiagramNode,
): { x: number; y: number; width: number; height: number } => {
  const size = DEFAULT_NODE_SIZE[node.data.shape];
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? size.width,
    height: node.height ?? size.height,
  };
};

const SIDE_POSITIONS: Record<string, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * y range the lifeline's line occupies (below the header). Geometric — used
 * when re-deriving an *existing* attachment's handle, so it must not shrink
 * when a destroy marker appears or old messages would jump on the next resnap.
 */
export const lifelineLineRange = (node: DiagramNode): { min: number; max: number } => {
  const b = nodeBounds(node);
  return { min: b.y + Math.min(LIFELINE_HEADER_H, b.height), max: b.y + b.height };
};

/**
 * y range a *new* attachment may take. The object stops existing at the destroy
 * marker, so nothing new lands below it — but anything already there is left
 * alone (issue #36: cut new attachments, don't move or delete existing ones).
 */
export const lifelineAttachRange = (node: DiagramNode): { min: number; max: number } => {
  const b = nodeBounds(node);
  const range = lifelineLineRange(node);
  const destroy = visibleDestroyY(node.data.destroyY, b.height);
  return destroy === null ? range : { min: range.min, max: Math.min(range.max, b.y + destroy) };
};

/** Builds a lifeline handle id attaching at absolute canvas y (clamped to the line). */
export const lifelineHandleAtY = (node: DiagramNode, y: number, side: "left" | "right"): string => {
  const b = nodeBounds(node);
  const range = lifelineLineRange(node);
  const clamped = Math.min(Math.max(y, range.min), range.max);
  const pct = b.height > 0 ? ((clamped - b.y) / b.height) * 100 : 50;
  return `${side}-${Number(pct.toFixed(2))}`;
};

/**
 * Re-anchors a side handle so its attachment point slides to `p` along the side
 * the handle already names. The side itself never changes — attachment sides are
 * fixed at creation by `pickHandles`. Returns null for anything but a side handle.
 */
export const handleSlidTo = (
  node: DiagramNode,
  handle: string | null | undefined,
  p: { x: number; y: number },
): string | null => {
  const side = (handle ?? "").split("-")[0];
  if (side !== "top" && side !== "right" && side !== "bottom" && side !== "left") return null;
  const b = nodeBounds(node);
  const vertical = side === "left" || side === "right";
  const span = vertical ? b.height : b.width;
  if (span <= 0) return null;
  // the middle is the bare side, as everywhere else — `left-50` would read
  // as a different end from `left` when lines are compared
  return sideHandle(side, (vertical ? p.y - b.y : p.x - b.x) / span);
};

/** The handle for an end put down at `p` on `side` of a box (#204 D3, D4). */
export const sideHandleAt = (node: DiagramNode, side: Side, p: { x: number; y: number }): string =>
  sideHandle(side, projectToSide(node.data.shape, nodeBounds(node), side, p));

/**
 * Handle pair for a horizontal sequence message between two lifelines at
 * absolute canvas y. Sides face each other; a self-message loops out the
 * right side and returns `selfGap` px lower.
 */
/** default vertical span of a self-message loop */
export const SELF_MESSAGE_GAP = 24;

/**
 * Shortest a self-message loop may get. Below this the two corners meet and the
 * loop reads as a single stroke, so every path that resizes one — the create
 * drag, the whole-loop move, the height grips — clamps to it (#99).
 */
export const SELF_MESSAGE_MIN_GAP = 16;

export const messageHandles = (
  source: DiagramNode,
  target: DiagramNode,
  y: number,
  selfGap = SELF_MESSAGE_GAP,
): { sourceHandle: string; targetHandle: string } => {
  if (source.id === target.id) {
    return {
      sourceHandle: lifelineHandleAtY(source, y, "right"),
      targetHandle: lifelineHandleAtY(source, y + selfGap, "right"),
    };
  }
  const sb = nodeBounds(source);
  const tb = nodeBounds(target);
  const sourceIsLeft = sb.x + sb.width / 2 <= tb.x + tb.width / 2;
  return {
    sourceHandle: lifelineHandleAtY(source, y, sourceIsLeft ? "right" : "left"),
    targetHandle: lifelineHandleAtY(target, y, sourceIsLeft ? "left" : "right"),
  };
};

/**
 * True when the edge is a sequence message: both ends on lifelines, or one end
 * an anchor point and the other a lifeline attached via a `-<pct>` side handle
 * (found/lost message). Canvas-drawn free arrows attach to lifelines with
 * plain side handles, so they are not messages.
 */
export const isSequenceMessage = (
  edge: Pick<DiagramEdge, "source" | "target" | "sourceHandle" | "targetHandle">,
  nodes: DiagramNode[],
): boolean => {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return false;
  if (source.data.shape === "lifeline" && target.data.shape === "lifeline") return true;
  const pctSide = (h: string | null | undefined): boolean => !!h && /^(left|right)-/.test(h);
  if (source.data.shape === "anchor" && target.data.shape === "lifeline")
    return pctSide(edge.targetHandle);
  if (source.data.shape === "lifeline" && target.data.shape === "anchor")
    return pctSide(edge.sourceHandle);
  return false;
};

/** Lifeline-side handle for a found/lost message, level with the anchor's center. */
/**
 * Pulls a y into the range a *new* attachment may use.
 *
 * The rule this enforces: automatic recomputation (resnap) never moves an
 * existing attachment, but **every user-initiated placement respects the
 * destroy cap** — connect drags, the arrow tool, endpoint snapping and body
 * drags all go through here.
 */
export const clampToAttach = (node: DiagramNode, y: number): number => {
  const r = lifelineAttachRange(node);
  return Math.min(Math.max(y, r.min), r.max);
};

export const mixedMessageHandle = (lifeline: DiagramNode, anchor: DiagramNode): string => {
  const ab = nodeBounds(anchor);
  const lb = nodeBounds(lifeline);
  const cx = ab.x + ab.width / 2;
  const cy = ab.y + ab.height / 2;
  return lifelineHandleAtY(lifeline, cy, cx < lb.x + lb.width / 2 ? "left" : "right");
};

/**
 * Resolves a stored handle id to a point on the node boundary.
 * Handle ids: `top` | `right` | `bottom` | `left`, optionally with a `-<pct>`
 * suffix (any 0-100 number) selecting the position along that side; `center` /
 * `body` resolve to the node center (used by anchors and whole-node drops).
 * Lifelines resolve `left-*`/`right-*` onto their center line — the side only
 * conveys the outward direction.
 */
export const handlePointOnNode = (
  node: DiagramNode,
  handleId: string | null | undefined,
): { x: number; y: number; position: Position } => {
  const b = nodeBounds(node);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (!handleId || handleId === "center" || handleId === "body") {
    return { x: cx, y: cy, position: Position.Top };
  }
  const side = handleId.split("-")[0];
  const ratio = handleRatio(handleId);
  const position = SIDE_POSITIONS[side ?? "top"] ?? Position.Top;
  if (
    node.data.shape === "lifeline" &&
    (position === Position.Left || position === Position.Right)
  ) {
    return { x: cx, y: b.y + b.height * ratio, position };
  }
  switch (position) {
    case Position.Top:
      return { x: b.x + b.width * ratio, y: b.y, position };
    case Position.Bottom:
      return { x: b.x + b.width * ratio, y: b.y + b.height, position };
    case Position.Left:
      return { x: b.x, y: b.y + b.height * ratio, position };
    case Position.Right:
      return { x: b.x + b.width, y: b.y + b.height * ratio, position };
  }
};

const INWARD: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

/**
 * how far a message's y may sit outside a bar and still count as on it: a
 * handle keeps its height as a percentage to two decimals, so the y it gives
 * back can fall a hair short of the bar it was put on (#210)
 */
const ON_BAR_SLACK = 0.5;

/**
 * A message landing on a lifeline where an activation bar runs stops at the
 * bar's facing edge — at the line itself the bar would cover its arrowhead
 * (#210). Elsewhere it ends on the line.
 */
const onActivationEdge = <P extends { x: number; y: number }>(
  node: DiagramNode,
  side: Side,
  p: P,
): P => {
  if (side !== "left" && side !== "right") return p;
  const b = nodeBounds(node);
  const y = p.y - b.y;
  const onBar = (node.data.activations ?? []).some((raw) => {
    const a = visibleActivation(raw, b.height);
    return a !== null && y >= a.y0 - ON_BAR_SLACK && y <= a.y1 + ON_BAR_SLACK;
  });
  if (!onBar) return p;
  return { ...p, x: p.x + (side === "left" ? -1 : 1) * (LIFELINE_ACTIVATION_W / 2) };
};

/**
 * Where the drawn line touches the node: `handlePointOnNode` carried in along
 * the side's normal to the shape's outline (#204 D10) — or, on a lifeline, out
 * to the edge of the activation bar it lands on. On a box, and for anything
 * that is not a side handle, the two are the same point. Routing keeps judging
 * from `handlePointOnNode`; only the drawing reaches in.
 */
export const outlinePointOnNode = (
  node: DiagramNode,
  handleId: string | null | undefined,
): { x: number; y: number; position: Position } => {
  const p = handlePointOnNode(node, handleId);
  const side = parseSide(handleId);
  if (!side) return p;
  if (node.data.shape === "lifeline") return onActivationEdge(node, side, p);
  const inset = outlineInset(node.data.shape, nodeBounds(node), side, handleRatio(handleId));
  if (inset === 0) return p;
  const n = INWARD[side];
  return { ...p, x: p.x + n.x * inset, y: p.y + n.y * inset };
};

/**
 * Node bounds the orthogonal router avoids, inflated by 4px — less than the
 * 16px stub, so a stub never starts inside its own node's rect. Source/target
 * nodes are included too: an edge reaching a far-side handle must route
 * around its node instead of doubling back past the arrowhead. Lifelines are
 * tall, deliberately crossed columns — routing around them would send every
 * orthogonal edge on a detour — and anchors are dimensionless endpoints.
 */
export const routingObstacles = (nodes: DiagramNode[]): Rect[] =>
  nodes
    // a backdrop is behind everything and lets lines pass over it (#170 D2)
    .filter(
      (n) => n.data.shape !== "anchor" && n.data.shape !== "lifeline" && !isBackdrop(n.data.shape),
    )
    .map((n) => {
      const b = nodeBounds(n);
      return { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 };
    });

/**
 * Drops slide waypoints (#43) that a moved/resized endpoint node has made
 * worse than a fresh route (#69). Only orthogonal box↔box edges qualify:
 * anchor endpoints manage their waypoints in their own drag paths (a free
 * arrow translates them along), and non-orthogonal styles render waypoints
 * verbatim by design.
 */
export const pruneSpentWaypoints = (
  edges: DiagramEdge[],
  nodes: DiagramNode[],
  movedIds: ReadonlySet<string>,
): DiagramEdge[] => {
  let changed = false;
  let obstacles: Rect[] | null = null;
  const out = edges.map((e) => {
    if (!e.data?.waypoints?.length) return e;
    if ((e.data.pathStyle ?? "orthogonal") !== "orthogonal") return e;
    if (!movedIds.has(e.source) && !movedIds.has(e.target)) return e;
    if (e.source === e.target) return e; // self loops ignore waypoints
    const source = nodes.find((n) => n.id === e.source);
    const target = nodes.find((n) => n.id === e.target);
    if (!source || !target) return e;
    if (source.data.shape === "anchor" || target.data.shape === "anchor") return e;
    const sp = handlePointOnNode(source, e.sourceHandle);
    const tp = handlePointOnNode(target, e.targetHandle);
    // judge against the same obstacle set the renderer would route with, so a
    // slide that detours around an obstacle isn't mistaken for a spent one
    obstacles ??= routingObstacles(nodes);
    // same bounds the renderer passes, so the stub math (and with it the
    // verdict) can't drift from what is on screen (#96)
    const bounds = { source: nodeBounds(source), target: nodeBounds(target) };
    if (!waypointsWorsenPath(sp, tp, e.data.waypoints, obstacles, bounds)) return e;
    changed = true;
    return { ...e, data: { ...e.data, waypoints: undefined } };
  });
  return changed ? out : edges;
};

export interface SnapTarget {
  nodeId: string;
  /** side handle id, with a `-<pct>` suffix unless it is the side's middle */
  handle: string;
  point: { x: number; y: number };
}

/** Distance from a point to a rect (0 when inside). */
const distanceToRect = (
  p: { x: number; y: number },
  r: { x: number; y: number; width: number; height: number },
): number => {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
};

/**
 * Finds the node (and its nearest side connection point) within `range` of
 * `p` — used to snap a dragged arrow endpoint onto a box.
 */
export const findSnapTarget = (
  nodes: DiagramNode[],
  p: { x: number; y: number },
  excludeIds: string[] = [],
  range = 32,
  /** the line's other end, when there is one: a lifeline end takes the side facing it */
  toward?: { x: number; y: number },
): SnapTarget | null => {
  const excluded = new Set(excludeIds);
  let bestNode: DiagramNode | null = null;
  let bestDist = Infinity;
  for (const node of nodes) {
    // backdrops (fragment, frame): distanceToRect returns 0 anywhere inside them, so
    // leaving them in would make every anchor dropped inside a frame snap to it
    if (node.data.shape === "anchor" || isBackdrop(node.data.shape)) continue;
    if (excluded.has(node.id)) continue;
    const d = distanceToRect(p, nodeBounds(node));
    if (d <= range && d < bestDist) {
      bestDist = d;
      bestNode = node;
    }
  }
  if (!bestNode) return null;

  if (bestNode.data.shape === "lifeline") {
    const b = nodeBounds(bestNode);
    const cx = b.x + b.width / 2;
    const range = lifelineAttachRange(bestNode);
    const y = Math.min(Math.max(p.y, range.min), range.max);
    // the side facing the line's other end — it picks which edge of a bar the
    // line ends on (#210); with no other end yet, the pointer's side
    const side = (toward ?? p).x < cx ? "left" : "right";
    const handle = lifelineHandleAtY(bestNode, y, side);
    // the dot shows where the line will end — at a bar's edge where one runs
    return { nodeId: bestNode.id, handle, point: { x: outlinePointOnNode(bestNode, handle).x, y } };
  }

  // anywhere around a box, not just its four middles (#204 D4): the nearest
  // side, at the pointer's spot along it
  const handle = sideHandleAt(bestNode, nearestSide(nodeBounds(bestNode), p), p);
  const point = outlinePointOnNode(bestNode, handle);
  return { nodeId: bestNode.id, handle, point: { x: point.x, y: point.y } };
};

export const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
