import { nanoid } from "nanoid";

import type { DiagramEdge, DiagramNode } from "../types";
import { normalizeEdge } from "./edgeFactory";
import { deepClone, withoutSelection } from "./history";
import { dropLoneGroupIds, remapGroupIds } from "./groups";
import { normalizeNode, pruneOrphanAnchors } from "./nodeFactory";

/**
 * Flow-coordinate step a paste is offset by. Repeated pastes of the same
 * buffer multiply it, so copies cascade instead of stacking.
 */
export const PASTE_OFFSET = 16;

/**
 * A detached piece of a document. Holds deep copies, not id references — the
 * originals may be deleted (or a whole other file opened) before it is pasted.
 */
export type ClipboardFragment = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

/**
 * Reduces the current selection to the piece the clipboard should hold.
 *
 * 1. nodes = selected nodes ∪ anchors attached to a *selected edge*
 * 2. edges = those with both endpoints in that set
 * 3. anchors no surviving edge references are dropped
 *
 * Step 1 exists because a free-standing arrow is picked by its line, not by
 * its endpoints — the anchors are invisible dots. Without it "copy this arrow"
 * would silently do nothing. Step 3 is the same rule read the other way: an
 * anchor on its own is not a shape anyone can see, let alone paste.
 *
 * Note the reach of step 1: it only rescues edges whose *every* endpoint is an
 * anchor. A found/lost message runs anchor↔lifeline, so picking just its line
 * still copies nothing — the lifeline was never selected, and dragging it in
 * would mean copying a shape the user did not point at. That asymmetry is the
 * both-endpoints rule holding (decision 2 in the spec), not a gap.
 *
 * Returns null when nothing worth holding was selected, so the caller can keep
 * the previous buffer rather than clobbering it with an empty copy.
 */
export const collectFragment = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): ClipboardFragment | null => {
  const taken = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  const anchors = new Set(nodes.filter((n) => n.data.shape === "anchor").map((n) => n.id));
  for (const edge of edges) {
    if (!edge.selected) continue;
    if (anchors.has(edge.source)) taken.add(edge.source);
    if (anchors.has(edge.target)) taken.add(edge.target);
  }
  const keptEdges = edges.filter((e) => taken.has(e.source) && taken.has(e.target));
  const keptNodes = pruneOrphanAnchors(
    nodes.filter((n) => taken.has(n.id)),
    keptEdges,
  );
  if (keptNodes.length === 0) return null;
  return {
    nodes: withoutSelection(deepClone(keptNodes)),
    edges: withoutSelection(deepClone(keptEdges)),
  };
};

/**
 * Turns a held fragment into a fresh piece of document, shifted by `delta`.
 *
 * Ids are reissued and the edges rewired onto them, so a paste never points
 * back at the originals. Handles are carried over verbatim — an edge's
 * attachment points are fixed at creation (project rule), and re-running
 * `pickHandles` here would both reshape plain edges and strip the `-<pct>`
 * handles that make a sequence message a message rather than a free arrow.
 *
 * Waypoints are absolute flow coordinates that do not follow their nodes, so
 * they take the same delta; left alone, a pasted edge would detour through
 * the original's bends.
 */
export const instantiateFragment = (
  fragment: ClipboardFragment,
  delta: { dx: number; dy: number },
): ClipboardFragment => {
  const idMap = new Map<string, string>();

  // a copy of a group is a group of its own (#171) — and part of one, copied
  // alone, belongs to none
  const nodes = dropLoneGroupIds(
    remapGroupIds(
      fragment.nodes.map((node) => {
        const id = nanoid(8);
        idMap.set(node.id, id);
        return normalizeNode({
          ...deepClone(node),
          id,
          position: { x: node.position.x + delta.dx, y: node.position.y + delta.dy },
        });
      }),
    ),
  );

  const edges = fragment.edges.map((edge) => {
    // already our own deep copy — shift the bends in place
    const copy = deepClone(edge);
    if (copy.data?.waypoints) {
      copy.data.waypoints = copy.data.waypoints.map((w) => ({
        x: w.x + delta.dx,
        y: w.y + delta.dy,
      }));
    }
    return normalizeEdge(
      {
        ...copy,
        id: nanoid(8),
        // every endpoint is in the map for a fragment `collectFragment` built;
        // one from anywhere else keeps the id it had and stays where it points
        source: idMap.get(copy.source) ?? copy.source,
        target: idMap.get(copy.target) ?? copy.target,
      },
      nodes,
    );
  });

  return { nodes, edges };
};

/**
 * Drops a freshly instantiated fragment into the document and makes it the
 * selection. Paste and duplicate differ only in where the fragment came from
 * and how far it moved — landing it is the same act.
 */
export const landFragment = (
  state: { nodes: DiagramNode[]; edges: DiagramEdge[] },
  fresh: ClipboardFragment,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } => ({
  nodes: [
    ...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
    ...fresh.nodes.map((n) => ({ ...n, selected: true })),
  ],
  edges: [
    ...state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    ...fresh.edges.map((e) => ({ ...e, selected: true })),
  ],
});
