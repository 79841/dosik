import dagre from "@dagrejs/dagre";

import {
  type Arrangement,
  type Box,
  boxAround,
  edgeLabelBox,
  FRAME_FIT_PAD,
  type LayoutDirection,
} from "../../../shared/lib/autoLayout";
import {
  effectiveMarkerEnd,
  effectiveMarkerStart,
  nodeBounds,
} from "../../../shared/lib/edgeUtils";
import { FRAME_TITLE_H } from "../../../shared/lib/palette";
import type { DiagramEdge, DiagramNode, MarkerShape } from "../../../shared/lib/types";
import type { Cluster } from "./plan";

/** the toolbar layout's gaps (#3), a little wider when subgraphs need room for their frames */
const NODE_SEP = 48;
const RANK_SEP = 80;
const CLUSTER_SEP = FRAME_FIT_PAD * 2 + FRAME_TITLE_H;
/** UML ends that sit at the parent or the whole — the class drawn first in the flow */
const LEADING_ENDS: readonly MarkerShape[] = ["triangle", "diamond", "diamond-open"];

/**
 * Which end of a link ranks first. Mermaid ranks a link the way it is
 * written, and so does this — except a class diagram's UML ends: a parent
 * (the triangle) and a whole (the diamond) go above, the way UML is read,
 * whichever side of the arrow the source put them on. A flipped direction
 * (BT, RL) starts its ranks at the bottom or the right, so there the parent
 * ranks last — still above, or to the left (#206). That also matches
 * Mermaid's own drawing of the common `direction BT` + `Child --|> Parent`.
 */
const rankOrder = (edge: DiagramEdge, direction: LayoutDirection): [string, string] => {
  const parentAtEnd =
    LEADING_ENDS.includes(effectiveMarkerEnd(edge.data)) &&
    !LEADING_ENDS.includes(effectiveMarkerStart(edge.data));
  const parentAtStart =
    LEADING_ENDS.includes(effectiveMarkerStart(edge.data)) &&
    !LEADING_ENDS.includes(effectiveMarkerEnd(edge.data));
  if (!parentAtEnd && !parentAtStart) return [edge.source, edge.target];
  const [parent, child] = parentAtEnd ? [edge.target, edge.source] : [edge.source, edge.target];
  return direction === "BT" || direction === "RL" ? [child, parent] : [parent, child];
};

/** an empty subgraph still gets a frame of its own */
const EMPTY_FRAME = { width: 240, height: 120 };

/**
 * Where an imported diagram's shapes go (#200 D4) — dagre, like the toolbar's
 * Layout, but compound: a subgraph is a cluster, so dagre keeps what it holds
 * together and everything else out. Each frame is then fitted around what it
 * holds, inner frames first, with the title strip on top. The result is an
 * `Arrangement` for `applyLayout`, which also re-picks the edges' sides.
 */
export const arrangeImport = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: LayoutDirection,
  clusters: Cluster[],
): Arrangement => {
  const frameIds = new Set(clusters.map((c) => c.id));
  const filled = new Set(clusters.filter((c) => c.members.length > 0).map((c) => c.id));
  const compound = filled.size > 0;
  const graph = new dagre.graphlib.Graph({ compound, multigraph: true });
  const ranksep = compound ? RANK_SEP + CLUSTER_SEP : RANK_SEP;
  graph.setGraph({
    rankdir: direction,
    nodesep: compound ? NODE_SEP + CLUSTER_SEP : NODE_SEP,
    ranksep,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const laid = nodes.filter((n) => !frameIds.has(n.id) || !filled.has(n.id));
  for (const node of laid) {
    const size = frameIds.has(node.id) ? EMPTY_FRAME : nodeBounds(node);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }
  for (const id of filled) graph.setNode(id, {});
  for (const cluster of clusters) {
    for (const member of cluster.members) graph.setParent(member, cluster.id);
  }
  const laidIds = new Set(laid.map((n) => n.id));
  for (const edge of edges) {
    // a self-loop has no direction to rank by; frames end no line (fromFlowchart)
    if (edge.source === edge.target) continue;
    if (!laidIds.has(edge.source) || !laidIds.has(edge.target)) continue;
    const [from, to] = rankOrder(edge, direction);
    // a relation's two ends and its name, measured, one after another (#200, #202)
    graph.setEdge(from, to, edgeLabelBox(edge, direction, ranksep) ?? {}, edge.id);
  }
  dagre.layout(graph);

  const boxes = new Map<string, Box>();
  for (const node of laid) {
    const { x, y, width, height } = graph.node(node.id) as Box;
    // dagre places centres; the document stores top-left corners
    boxes.set(node.id, { x: x - width / 2, y: y - height / 2, width, height });
  }
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const frameBox = (id: string): Box | undefined => {
    const known = boxes.get(id);
    if (known) return known;
    const inside = (byId.get(id)?.members ?? []).map(frameBox).filter((b): b is Box => Boolean(b));
    if (inside.length === 0) return undefined;
    const around = boxAround(inside);
    const box = {
      x: around.x - FRAME_FIT_PAD,
      y: around.y - FRAME_FIT_PAD - FRAME_TITLE_H,
      width: around.width + FRAME_FIT_PAD * 2,
      height: around.height + FRAME_FIT_PAD * 2 + FRAME_TITLE_H,
    };
    boxes.set(id, box);
    return box;
  };
  for (const id of frameIds) frameBox(id);

  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  const result: Arrangement = { positions: new Map(), frames: new Map() };
  for (const [id, b] of boxes) {
    const at = { x: Math.round(b.x - minX), y: Math.round(b.y - minY) };
    if (frameIds.has(id)) {
      result.frames.set(id, { ...at, width: Math.round(b.width), height: Math.round(b.height) });
    } else {
      result.positions.set(id, at);
    }
  }
  return result;
};
