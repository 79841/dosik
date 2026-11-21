import type { Position } from "@xyflow/react";

import {
  buildEdgePath,
  facingPosition,
  polylinePointAtT,
  type Point,
} from "../../shared/lib/edgeGeometry";
import {
  DEFAULT_EDGE_WIDTH,
  drawnEnds,
  effectiveMarkerEnd,
  effectiveMarkerStart,
  handlePointOnNode,
  isSequenceMessage,
  nodeBounds,
  outlinePointAt,
  outlinePointOnNode,
  routingObstacles,
  soleOnSide,
} from "../../shared/lib/edgeUtils";
import { canvasInk, type ColorToken } from "../../shared/lib/palette";
import { parseSide } from "../../shared/lib/sideAttach";
import type {
  DiagramEdge,
  DiagramEdgeData,
  DiagramNode,
  MarkerShape,
  MarkerSize,
  PaletteColor,
} from "../../shared/lib/types";
import { DASH, polylineLength } from "./edgeMath";

/**
 * Where an edge goes and where its labels sit — computed once, from the
 * stored model, for every renderer (#148).
 *
 * This used to live inside `LabeledEdge`'s hooks, which meant a second
 * renderer (the windowless SVG export) would have had to copy it — the
 * parallel offset, the self-loop index, the obstacle set, the anchor facing
 * rule — and the day the two copies disagreed, the exported picture would lie
 * about the canvas. Now the canvas and the export call this same function.
 */
export interface EdgeEnd extends Point {
  position: Position;
}

export interface EdgeLayout {
  d: string;
  points: Point[];
  endpoints: {
    source: EdgeEnd;
    target: EdgeEnd;
    stubs: { source: boolean; target: boolean };
  };
  endpointBounds?: { source: ReturnType<typeof nodeBounds>; target: ReturnType<typeof nodeBounds> };
  pathStyle: NonNullable<DiagramEdgeData["pathStyle"]>;
  isSelfLoop: boolean;
  isMessage: boolean;
  isFreeArrow: boolean;
  sourceIsAnchor: boolean;
  targetIsAnchor: boolean;
  /** the three label spots along the drawn line */
  labelPoints: { center: Point; start: Point; end: Point };
}

type EdgeInput = Pick<DiagramEdge, "id" | "source" | "target" | "sourceHandle" | "targetHandle"> & {
  data?: Partial<DiagramEdgeData>;
};

/**
 * The `data` fields `layoutEdge` reads — and only those. The canvas memoises on
 * them instead of on the whole `data` object, so a field added to the layout
 * has to be added here or the canvas would route without it while the SVG
 * (which passes all of `data`) routes with it. A test compares the two.
 */
export const routingData = (
  data: Partial<DiagramEdgeData> | undefined,
): Pick<Partial<DiagramEdgeData>, "pathStyle" | "waypoints" | "selfLoopWidth" | "labelT"> => ({
  pathStyle: data?.pathStyle,
  waypoints: data?.waypoints,
  selfLoopWidth: data?.selfLoopWidth,
  labelT: data?.labelT,
});

/**
 * The edge as it will be once the end held by the dragged anchor `anchorId`
 * lands on `snap` — attached to that shape's spot, without the bends the old
 * route had (a rewire drops them). What a drag preview draws, so the line shows
 * the route the drop makes instead of running to the free end along the
 * shape's face (#210). Any other edge comes back as it is.
 */
export const landedEdge = <E extends EdgeInput>(
  edge: E,
  anchorId: string,
  snap: { nodeId: string; handle: string },
): E => {
  const data = edge.data ? { ...edge.data, waypoints: undefined } : edge.data;
  if (edge.source === anchorId) {
    return { ...edge, source: snap.nodeId, sourceHandle: snap.handle, data };
  }
  if (edge.target === anchorId) {
    return { ...edge, target: snap.nodeId, targetHandle: snap.handle, data };
  }
  return edge;
};

/** where an edge sits among its siblings — the cheap half of a layout, recomputed freely */
export interface EdgeSiblings {
  parallelOffset: number;
  selfLoopIndex: number | undefined;
  /** whether each end is alone on its side — only such an end may slide to straighten the line (#257) */
  soleEnds: { source: boolean; target: boolean };
}

const NOT_SOLE = { source: false, target: false };

/**
 * Parallel edges between the same pair get separated by an offset; self-loops
 * on one node get an index; and each end learns whether it is alone on its
 * side, which decides whether it may slide to straighten the line (#257).
 * Split from `layoutEdge` so the canvas can recompute this on every edge
 * change and route only when the numbers move (#152).
 */
export const edgeSiblings = (
  edge: Pick<EdgeInput, "id" | "source" | "target" | "sourceHandle" | "targetHandle">,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): EdgeSiblings => {
  const { id, source, target } = edge;
  if (source === target) {
    const loops = edges.filter((e) => e.source === e.target && e.source === source);
    return {
      parallelOffset: 0,
      selfLoopIndex: Math.max(
        0,
        loops.findIndex((e) => e.id === id),
      ),
      soleEnds: NOT_SOLE,
    };
  }
  // messages are already separated by their y — offsetting would tilt them
  if (isSequenceMessage(edge, nodes)) {
    return { parallelOffset: 0, selfLoopIndex: undefined, soleEnds: NOT_SOLE };
  }
  // only lines that share both end points overlap; ends placed apart along
  // their sides already keep the lines apart (#204 D11)
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "") === (b ?? "");
  const siblings = edges.filter(
    (e) =>
      e.source !== e.target &&
      ((e.source === source &&
        e.target === target &&
        same(e.sourceHandle, edge.sourceHandle) &&
        same(e.targetHandle, edge.targetHandle)) ||
        (e.source === target &&
          e.target === source &&
          same(e.sourceHandle, edge.targetHandle) &&
          same(e.targetHandle, edge.sourceHandle))),
  );
  if (siblings.length < 2) {
    return { parallelOffset: 0, selfLoopIndex: undefined, soleEnds: soleOnSide(edge, edges) };
  }
  const idx = siblings.findIndex((e) => e.id === id);
  const dirSign = source < target ? 1 : -1;
  return {
    parallelOffset: (idx - (siblings.length - 1) / 2) * 18 * dirSign,
    selfLoopIndex: undefined,
    // parallel lines share both sides
    soleEnds: NOT_SOLE,
  };
};

/**
 * The routing obstacles, once per node array. Every edge on the canvas asks
 * for them; the store replaces the array when a node moves, so a drag frame
 * computes them once for all edges instead of once per edge (#152).
 */
const obstacleCache = new WeakMap<DiagramNode[], ReturnType<typeof routingObstacles>>();
export const obstaclesFor = (nodes: DiagramNode[]): ReturnType<typeof routingObstacles> => {
  let cached = obstacleCache.get(nodes);
  if (!cached) {
    cached = routingObstacles(nodes);
    obstacleCache.set(nodes, cached);
  }
  return cached;
};

/**
 * Lays out one edge against the whole document.
 *
 * `siblings` may be passed precomputed (the canvas does, to keep its memo
 * narrow); otherwise it is derived from `edges`. `fallback` is where React
 * Flow measured the ends, used only while an endpoint node is missing from
 * `nodes`. Without it such an edge has no layout and the caller skips it.
 */
export const layoutEdge = (
  edge: EdgeInput,
  nodes: DiagramNode[],
  context: {
    edges?: DiagramEdge[];
    siblings?: EdgeSiblings;
    fallback?: { source: EdgeEnd; target: EdgeEnd };
  },
): EdgeLayout | null => {
  const { source, target, data } = edge;
  const { fallback } = context;
  const pathStyle = data?.pathStyle ?? "orthogonal";
  const waypoints = data?.waypoints ?? [];
  const isSelfLoop = source === target;
  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if ((!sourceNode || !targetNode) && !fallback) return null;
  const sourceIsAnchor = sourceNode?.data.shape === "anchor";
  const targetIsAnchor = targetNode?.data.shape === "anchor";
  const isFreeArrow = sourceIsAnchor && targetIsAnchor;
  /** sequence message: lifeline↔lifeline, or found/lost anchor↔lifeline (kept horizontal) */
  const isMessage = isSequenceMessage(
    { source, target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle },
    nodes,
  );
  const { parallelOffset, selfLoopIndex, soleEnds } =
    context.siblings ?? edgeSiblings(edge, nodes, context.edges ?? []);

  const obstacles =
    pathStyle !== "orthogonal" || waypoints.length > 0 || isSelfLoop ? [] : obstaclesFor(nodes);

  // Endpoints come from the *stored* model, never from React Flow's
  // DOM-measured `sourceX/sourceY` — those are the handle element's outer
  // edge, and Dosik's connection dots are 10x10 centred on the node border
  // (`translate(50%, -50%)`), so every measured endpoint sat 5px outside its
  // node. Two touching boxes then had their endpoints 10px *past* each other,
  // each inside the other's obstacle rect, and the router hooked up and over
  // the pair. The stub shrink and `stubsCollide` (#69, #86) key off a
  // non-negative facing separation, so on screen they never fired (#89).
  //
  // Reading the model also restores the "verdict = render" invariant:
  // waypoint pruning, the slide clamp and the obstacle set all judge with
  // `handlePointOnNode` — through `drawnEnds` where an auto end slides
  // (#257) — and `nodeBounds` is exactly what `ShapeNode` sizes itself with,
  // so there is nothing left for the DOM to disagree about.
  //
  // Anchors have no side — their point is the stored centre and their
  // direction follows where the line actually goes, so the arrowhead matches
  // the drawn direction.
  const anchorCenter = (n: DiagramNode | undefined): Point | null => {
    if (!n) return null;
    const b = nodeBounds(n);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const modelPoint = (
    n: DiagramNode | undefined,
    handleId: string | null | undefined,
    end: EdgeEnd | undefined,
  ): EdgeEnd => (n ? handlePointOnNode(n, handleId) : (end as EdgeEnd));

  // an auto end may slide along its side to meet a facing one straight (#257)
  const drawn =
    sourceNode && targetNode
      ? drawnEnds(edge, sourceNode, targetNode, soleEnds, obstacles)
      : undefined;
  const sSide = drawn?.source ?? modelPoint(sourceNode, edge.sourceHandle, fallback?.source);
  const tSide = drawn?.target ?? modelPoint(targetNode, edge.targetHandle, fallback?.target);
  const sPoint: Point = sourceIsAnchor
    ? (anchorCenter(sourceNode) ?? sSide)
    : { x: sSide.x, y: sSide.y };
  const tPoint: Point = targetIsAnchor
    ? (anchorCenter(targetNode) ?? tSide)
    : { x: tSide.x, y: tSide.y };
  const endpoints = {
    source: {
      ...sPoint,
      position: sourceIsAnchor ? facingPosition(sPoint, waypoints[0] ?? tPoint) : sSide.position,
    },
    target: {
      ...tPoint,
      position: targetIsAnchor
        ? facingPosition(tPoint, waypoints[waypoints.length - 1] ?? sPoint)
        : tSide.position,
    },
    stubs: { source: !sourceIsAnchor, target: !targetIsAnchor },
  };

  const endpointBounds =
    sourceNode && targetNode
      ? { source: nodeBounds(sourceNode), target: nodeBounds(targetNode) }
      : undefined;

  // the drawn ends reach in to a curved or slanted outline (#204 D10) — an end
  // slid along its side (#257) from the spot it slid to
  const outline = (n: DiagramNode | undefined, handleId: string | null | undefined, at: Point) => {
    if (!n || n.data.shape === "anchor") return undefined;
    const placed = handlePointOnNode(n, handleId);
    const side = parseSide(handleId);
    const p =
      side && (placed.x !== at.x || placed.y !== at.y)
        ? outlinePointAt(n, side, at)
        : outlinePointOnNode(n, handleId);
    return p.x === at.x && p.y === at.y ? undefined : { x: p.x, y: p.y };
  };
  const reachS = outline(sourceNode, edge.sourceHandle, sPoint);
  const reachT = outline(targetNode, edge.targetHandle, tPoint);

  const built = buildEdgePath(endpoints.source, endpoints.target, {
    reach: reachS || reachT ? { source: reachS, target: reachT } : undefined,
    pathStyle,
    waypoints,
    parallelOffset,
    obstacles,
    endpointBounds,
    selfLoopIndex: isSelfLoop ? selfLoopIndex : undefined,
    selfLoopWidth: data?.selfLoopWidth,
    stubs: endpoints.stubs,
  });

  // label anchor points
  const totalLen = polylineLength(built.points);
  const endInset = totalLen > 0 ? Math.min(0.45, 26 / totalLen) : 0.15;
  const labelPoints = {
    center: polylinePointAtT(built.points, data?.labelT ?? 0.5),
    start: polylinePointAtT(built.points, endInset),
    end: polylinePointAtT(built.points, 1 - endInset),
  };

  return {
    d: built.d,
    points: built.points,
    endpoints,
    endpointBounds,
    pathStyle,
    isSelfLoop,
    isMessage,
    isFreeArrow,
    sourceIsAnchor,
    targetIsAnchor,
    labelPoints,
  };
};

/** The colours an edge paints with — the canvas passes CSS variables, an export concrete values. */
export interface EdgePalette {
  tokens: Record<PaletteColor, ColorToken>;
  /** an uncoloured line: the ink (#210 D8) */
  stroke: string;
}

export interface EdgePaint {
  stroke: string;
  labelColor: string;
  strokeWidth: number;
  dasharray: string | undefined;
  linecap: "round" | undefined;
  opacity: number;
  animated: boolean;
  markerStart: MarkerShape;
  markerEnd: MarkerShape;
  markerSize: MarkerSize;
}

/** How an edge is stroked, apart from selection and agent highlight (the canvas adds those). */
export const edgePaint = (
  data: Partial<DiagramEdgeData> | undefined,
  palette: EdgePalette,
): EdgePaint => {
  const variant = data?.variant ?? "solid";
  const animated = data?.animated ?? false;
  // a coloured line draws in its deep tone — on bare canvas, so `ink` turns near-black
  const stroke = data?.color ? canvasInk(data.color, palette.tokens) : palette.stroke;
  return {
    stroke,
    // the label sits on the line in the line's own colour (#210 D7, Cloudflare)
    labelColor: stroke,
    strokeWidth: data?.width ?? DEFAULT_EDGE_WIDTH,
    dasharray: animated && variant === "solid" ? "6 4" : DASH[variant],
    linecap: variant === "dotted" ? "round" : undefined,
    opacity: data?.opacity ?? 1,
    animated,
    markerStart: effectiveMarkerStart(data),
    markerEnd: effectiveMarkerEnd(data),
    markerSize: data?.markerSize ?? "md",
  };
};
