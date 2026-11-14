import { collectFragment } from "../../shared/lib/store/clipboard";
import type { DiagramDoc, DiagramEdge, DiagramNode } from "../../shared/lib/types";

/**
 * The part of the document the user picked, as a document of its own (#48).
 *
 * The three questions the issue left open — how far a selection reaches, what
 * happens to an edge with one end outside it, whether picking two nodes brings
 * the edge between them — are already answered by `collectFragment`, the rule
 * the clipboard copies by. Exporting a selection and copying one should not
 * disagree about what "the selection" is, so this reuses it rather than
 * inventing a second rule:
 *
 * 1. nodes = selected nodes ∪ anchors held by a *selected edge*
 * 2. edges = those with **both** endpoints in that set — an edge running out of
 *    the selection is dropped rather than exported dangling
 * 3. anchors no surviving edge references are dropped
 *
 * Returns null when the selection holds nothing exportable, so the caller can
 * leave the menu entry out instead of writing an empty file.
 */
export const selectionDoc = (
  doc: DiagramDoc,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): DiagramDoc | null => {
  const fragment = collectFragment(nodes, edges);
  if (!fragment) return null;
  return { ...doc, nodes: fragment.nodes, edges: fragment.edges };
};

/**
 * Whether an export of just the selection would produce anything.
 *
 * The same rule as `collectFragment` but over ids only: this runs on every
 * store change (a node drag is one per pointer move), and cloning the picked
 * nodes just to throw the copy away is pure garbage.
 */
export const hasExportableSelection = (nodes: DiagramNode[], edges: DiagramEdge[]): boolean => {
  const anchors = new Set(nodes.filter((n) => n.data.shape === "anchor").map((n) => n.id));
  const taken = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  for (const edge of edges) {
    if (!edge.selected) continue;
    if (anchors.has(edge.source)) taken.add(edge.source);
    if (anchors.has(edge.target)) taken.add(edge.target);
  }
  // a non-anchor in the selection is enough on its own
  if (nodes.some((n) => taken.has(n.id) && !anchors.has(n.id))) return true;
  // an anchor only survives while an edge still holds it
  return edges.some((e) => taken.has(e.source) && taken.has(e.target));
};
