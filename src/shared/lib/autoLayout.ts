import dagre from "@dagrejs/dagre";

import {
  effectiveMarkerEnd,
  effectiveMarkerStart,
  isSequenceMessage,
  nodeBounds,
} from "./edgeUtils";
import { pillSize } from "./labelPill";
import { FRAME_TITLE_H } from "./palette";
import { frameContents } from "./store/frames";
import type { DiagramEdge, DiagramNode, MarkerShape, ShapeKind } from "./types";

/**
 * Automatic arrangement with dagre (#3).
 *
 * Layered layout — each edge points one rank down (TB), up (BT), right (LR)
 * or left (RL) — which is what flowcharts, architecture sketches and class
 * diagrams read as.
 * Sequence diagrams are not layered graphs: a lifeline's x is a column and a
 * message's y is time, and both have their own rules (`alignLifelines`,
 * message resnap), so their parts are left where they are.
 */
export const LAYOUT_DIRECTIONS = ["TB", "BT", "LR", "RL"] as const;
export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number];

/** the ranks run along x — a row of ranks, not a column (#206) */
export const isHorizontal = (direction: LayoutDirection): boolean =>
  direction === "LR" || direction === "RL";

/** shapes the layout leaves alone — see above; anchors are free-arrow ends */
export const NOT_LAID_OUT: readonly ShapeKind[] = ["lifeline", "fragment", "frame", "anchor"];

/** gaps between shapes: beside each other in a rank, and between ranks */
const NODE_SEP = 48;
const RANK_SEP = 80;

/** line left showing on each side of an edge label, so the label never hides the line it names */
const LABEL_CLEAR = 16;

/**
 * What an edge's labels ask of dagre (#202): a label box on the link, centred
 * on it as the app draws the pill. Without it a left-to-right layout put two
 * shapes 80 apart with a 146-wide label between them, which covered the line
 * and its arrowhead whole. The pills are measured as the vector SVG draws them
 * (`pillSize`); a relation's two ends and its name sit one after another along
 * the flow, with line showing between them and at both ends.
 *
 * dagre *adds* a label's length to the rank gap (`ranksep`), so only what the
 * gap cannot already hold is asked for — a label that fits leaves the gap as
 * it was (#202). The length stays at least 1: dagre places a label only
 * when both sides are non-zero, and the cross-flow side still keeps
 * neighbouring links apart.
 */
export const edgeLabelBox = (
  edge: DiagramEdge,
  direction: LayoutDirection,
  ranksep: number,
): { width: number; height: number; labelpos: "c" } | null => {
  const pills = [edge.data?.label, edge.data?.labelStart, edge.data?.labelEnd]
    .filter((text): text is string => Boolean(text?.trim()))
    .map(pillSize);
  if (pills.length === 0) return null;
  const clear = LABEL_CLEAR * (pills.length + 1);
  const along = (side: "width" | "height") =>
    // whole pixels: positions are rounded, and a fraction short shows as a gap too small
    Math.max(1, Math.ceil(pills.reduce((sum, pill) => sum + pill[side], 0) + clear - ranksep));
  const across = (side: "width" | "height") => Math.max(...pills.map((pill) => pill[side]));
  return isHorizontal(direction)
    ? { width: along("width"), height: across("height"), labelpos: "c" }
    : { width: across("width"), height: along("height"), labelpos: "c" };
};

/**
 * What gets arranged: the laid-out shapes (all of them, or the given ids), and
 * the edges that rank them — between two of those shapes, never a self-loop
 * (it has no direction to rank by) or a message (sequence, see above).
 */
export const layoutTargets = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  ids?: string[],
): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const wanted = ids ? new Set(ids) : null;
  const targets = nodes.filter(
    (n) => !NOT_LAID_OUT.includes(n.data.shape) && (wanted === null || wanted.has(n.id)),
  );
  const inSet = new Set(targets.map((n) => n.id));
  return {
    nodes: targets,
    edges: edges.filter(
      (e) =>
        e.source !== e.target &&
        inSet.has(e.source) &&
        inSet.has(e.target) &&
        !isSequenceMessage(e, nodes),
    ),
  };
};

/** what an arrangement changes: where the shapes go, and the frames that hold them */
export type Arrangement = {
  positions: Map<string, { x: number; y: number }>;
  /** a frame's new box — grown to hold its shapes again, moved with them if the block had to move */
  frames: Map<string, Box>;
};

/** room kept between a frame's edge and the arranged block it grew to hold */
export const FRAME_FIT_PAD = 24;

/** heads that say "this way" — a dot, a bar or a crow's foot does not */
const POINTING: readonly MarkerShape[] = ["arrow", "open", "triangle"];

/**
 * The flow reads the way the arrowhead points, not the way the edge was stored
 * (#182): an edge drawn with its only head at the source end — the edit bar's
 * marker swap, or an agent that connected the steps backwards — runs from
 * target to source on screen, and "Top to bottom" must follow the screen.
 * Heads at both ends or neither keep the stored direction.
 */
export const flowsBackward = (edge: DiagramEdge): boolean =>
  POINTING.includes(effectiveMarkerStart(edge.data)) &&
  !POINTING.includes(effectiveMarkerEnd(edge.data));

/**
 * Positions only — for checks and tests. The store arranges through
 * `computeArrangement`, which also moves and grows the frames that hold the
 * shapes; using this alone would leave them behind.
 */
export const computeLayout = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  options: { direction: LayoutDirection; ids?: string[] },
): Map<string, { x: number; y: number }> => computeArrangement(nodes, edges, options).positions;

/**
 * New top-left positions for the arranged shapes, and new boxes for the frames
 * holding them. The arrangement starts where the shapes were — at their old
 * bounding box's top-left — so a layout never throws the diagram to another
 * part of the canvas.
 */
export const computeArrangement = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  options: { direction: LayoutDirection; ids?: string[] },
): Arrangement => {
  const targets = layoutTargets(nodes, edges, options.ids);
  const result: Arrangement = { positions: new Map(), frames: new Map() };
  if (targets.nodes.length === 0) return result;

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: options.direction, nodesep: NODE_SEP, ranksep: RANK_SEP });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of targets.nodes) {
    const { width, height } = nodeBounds(node);
    graph.setNode(node.id, { width, height });
  }
  for (const edge of targets.edges) {
    const [from, to] = flowsBackward(edge)
      ? [edge.target, edge.source]
      : [edge.source, edge.target];
    graph.setEdge(from, to, edgeLabelBox(edge, options.direction, RANK_SEP) ?? {}, edge.id);
  }
  chainLoose(graph, targets, options.direction);
  dagre.layout(graph);

  const before = targets.nodes.map(nodeBounds);
  const originX = Math.min(...before.map((b) => b.x));
  const originY = Math.min(...before.map((b) => b.y));
  const laid = targets.nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    const { width, height } = nodeBounds(node);
    // dagre places centres; the document stores top-left corners
    return { id: node.id, x: x - width / 2, y: y - height / 2 };
  });
  const minX = Math.min(...laid.map((p) => p.x));
  const minY = Math.min(...laid.map((p) => p.y));
  const sizes = new Map(targets.nodes.map((n) => [n.id, nodeBounds(n)]));
  const placed: Box[] = laid.map((p) => {
    const { width, height } = sizes.get(p.id)!;
    return {
      x: Math.round(p.x - minX + originX),
      y: Math.round(p.y - minY + originY),
      width,
      height,
    };
  });

  // An arrangement must not empty a frame (#170 spec, #182): the block
  // is nearly always bigger than the shapes' old spread, and frame membership
  // is geometry only — a shape past the edge silently leaves. A frame that held
  // arranged shapes grows (never shrinks) to hold them again.
  const byId = new Map(targets.nodes.map((n, i) => [n.id, i]));
  const held = nodes
    .filter((f) => f.data.shape === "frame")
    .map((f) => {
      const inside = frameContents(nodes, f);
      const arranged = inside.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
      // a frame that also holds shapes left out of the arrangement stays where
      // it is — moving it would leave them behind, outside (#182)
      const stays = inside.some((id) => !byId.has(id));
      return { frame: f, inside: new Set(inside), arranged, stays };
    })
    .filter((h) => h.arranged.length > 0);
  // the frame grown to hold `boxes`: each side moves only when a shape crossed
  // it, and the top only when a shape rose into the title strip it was not in
  // before (#182, 3)
  const fitFrame = (frame: DiagramNode, arranged: number[], dx: number, dy: number): Box => {
    const f = nodeBounds(frame);
    const boxes = arranged.map((i) => ({ ...placed[i], x: placed[i].x + dx, y: placed[i].y + dy }));
    const wasTop = Math.min(...arranged.map((i) => before[i].y));
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.width));
    const maxY = Math.max(...boxes.map((b) => b.y + b.height));
    const left = minX < f.x ? minX - FRAME_FIT_PAD : f.x;
    const top =
      minY < f.y + FRAME_TITLE_H && minY < wasTop ? minY - FRAME_TITLE_H - FRAME_FIT_PAD : f.y;
    const right = maxX > f.x + f.width ? maxX + FRAME_FIT_PAD : f.x + f.width;
    const bottom = maxY > f.y + f.height ? maxY + FRAME_FIT_PAD : f.y + f.height;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  // The block — and every frame grown around it that travels with it — must
  // not land on what the layout did not arrange: a shape outside the
  // selection, a lifeline (#154), or anything a frame would swallow by
  // growing (#182). They move as one along the rank direction until
  // clear; what the layout skipped never moves. A frame is no obstacle — it
  // holds what it frames — but a travelling frame avoids everything that was
  // not already inside it. A frame that stays only grows, after the move.
  const others = nodes
    .filter((n) => !sizes.has(n.id) && n.data.shape !== "anchor" && n.data.shape !== "frame")
    .map((n) => ({ id: n.id, box: nodeBounds(n) }));
  const travelling = held.filter((h) => !h.stays);
  const moving: Moving[] = [
    ...placed.map((box) => ({ box, avoid: others.map((o) => o.box) })),
    ...travelling.map((h) => ({
      box: fitFrame(h.frame, h.arranged, 0, 0),
      avoid: others.filter((o) => !h.inside.has(o.id)).map((o) => o.box),
    })),
  ];
  const shift = clearOf(moving, options.direction);
  targets.nodes.forEach((n, i) => {
    result.positions.set(n.id, { x: placed[i].x + shift.x, y: placed[i].y + shift.y });
  });
  for (const h of held) {
    const f = nodeBounds(h.frame);
    const g = h.stays
      ? fitFrame(h.frame, h.arranged, shift.x, shift.y)
      : (() => {
          const box = fitFrame(h.frame, h.arranged, 0, 0);
          return { ...box, x: box.x + shift.x, y: box.y + shift.y };
        })();
    if (g.x === f.x && g.y === f.y && g.width === f.width && g.height === f.height) continue;
    result.frames.set(h.frame.id, g);
  }
  return result;
};

/**
 * Shapes with no edge between them all land in dagre's first rank, and a rank runs across
 * the direction — "Left to right" stacked them top to bottom (#182). Chaining
 * them with unseen edges, in the order they already read along the direction,
 * lines them up the way the menu says.
 */
const chainLoose = (
  graph: InstanceType<typeof dagre.graphlib.Graph>,
  targets: { nodes: DiagramNode[]; edges: DiagramEdge[] },
  direction: LayoutDirection,
): void => {
  const linked = new Set(targets.edges.flatMap((e) => [e.source, e.target]));
  // the chain's first shape goes in the first rank — the bottom for BT, the
  // right for RL — so those read from the far end (#206)
  const sign = direction === "BT" || direction === "RL" ? -1 : 1;
  const along = (b: Box) =>
    isHorizontal(direction)
      ? [sign * (b.x + b.width / 2), b.y + b.height / 2]
      : [sign * (b.y + b.height / 2), b.x + b.width / 2];
  const loose = targets.nodes
    .filter((n) => !linked.has(n.id))
    .map((n) => ({ id: n.id, key: along(nodeBounds(n)) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  for (let i = 1; i < loose.length; i += 1)
    graph.setEdge(loose[i - 1].id, loose[i].id, {}, `layout-chain-${i}`);
};

export type Box = { x: number; y: number; width: number; height: number };

/** the smallest box holding all of `boxes` — there must be at least one */
export const boxAround = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};

/** a box moving with the block, and what it has to stay clear of */
type Moving = { box: Box; avoid: Box[] };
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** how far the block has to move along the ranks for every box in it to touch nothing it avoids */
export const clearOf = (moving: Moving[], direction: LayoutDirection): { x: number; y: number } => {
  let dx = 0;
  let dy = 0;
  const bound = moving.reduce((n, m) => n + m.avoid.length, 0);
  // each round pushes past everything the block touches; bounded, since every
  // push clears at least one obstacle for good
  for (let round = 0; round <= bound; round += 1) {
    const hits = moving.flatMap((m) => {
      const at = { ...m.box, x: m.box.x + dx, y: m.box.y + dy };
      return m.avoid.filter((o) => overlaps(at, o));
    });
    if (hits.length === 0) break;
    const blockTop = Math.min(...moving.map((m) => m.box.y + dy));
    const blockLeft = Math.min(...moving.map((m) => m.box.x + dx));
    // along the axis only, away from the block's top-left start — the same
    // way for both senses of an axis (#206)
    if (!isHorizontal(direction))
      dy += Math.max(...hits.map((h) => h.y + h.height)) + RANK_SEP - blockTop;
    else dx += Math.max(...hits.map((h) => h.x + h.width)) + RANK_SEP - blockLeft;
  }
  return { x: dx, y: dy };
};
