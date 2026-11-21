import {
  outlinePointOnNode,
  type SnapTarget,
  sideHandleAt,
  spreadsOnSides,
} from "../../shared/lib/edgeUtils";
import { placeEnds } from "../../shared/lib/placeEnds";
import { parseSide } from "../../shared/lib/sideAttach";
import { pickHandles } from "../../shared/lib/store/nodeFactory";
import type { DiagramEdge, DiagramNode } from "../../shared/lib/types";

/** true for a connection dot — a bare side handle, not a body or a placed `side-<pct>` one */
export const isDot = (handle: string | null | undefined): boolean =>
  !!handle && parseSide(handle) === handle;

/**
 * Where a new connection dragged over `toId` would land — what the store
 * makes of the same drop, shown before the release (#204). On a connection
 * dot: that side's free spot nearest its middle (D3, D6). Anywhere else on
 * the box — its body, or a placed end's hidden handle — the side
 * `pickHandles` gives, at the pointer's spot along it. Null where the end has
 * no spot to choose: lifelines, anchors, a box connecting to itself.
 */
export const connectionLanding = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  from: { id: string; handle: string | null | undefined },
  to: { id: string; handle: string | null | undefined },
  p: { x: number; y: number },
): SnapTarget | null => {
  if (from.id === to.id) return null;
  const fromNode = nodes.find((n) => n.id === from.id);
  const toNode = nodes.find((n) => n.id === to.id);
  if (!fromNode || !toNode || !spreadsOnSides(toNode.data.shape)) return null;
  let handle: string | null | undefined;
  if (isDot(to.handle)) {
    const probe: DiagramEdge = {
      id: "\u0000landing",
      source: from.id,
      target: to.id,
      sourceHandle: from.handle,
      targetHandle: to.handle,
    };
    handle = placeEnds(nodes, [...edges, probe], [{ edgeId: probe.id, end: "target" }]).at(
      -1,
    )?.targetHandle;
  } else {
    const side = parseSide(pickHandles(fromNode, toNode).targetHandle);
    handle = side ? sideHandleAt(toNode, side, p) : null;
  }
  if (!handle) return null;
  const point = outlinePointOnNode(toNode, handle);
  return { nodeId: toNode.id, handle, point: { x: point.x, y: point.y } };
};
