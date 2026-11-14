import { isSequenceMessage } from "../../shared/lib/edgeUtils";
import { isBackdrop } from "../../shared/lib/palette";
import type { DiagramEdge, DiagramNode } from "../../shared/lib/types";

/**
 * Paint order the canvas injects on the way into React Flow. Every value here
 * is **view-only** — none of it reaches the store, so none of it lands in an
 * undo frame or a saved file. `setNodeZ` is the committed version.
 *
 * ```
 *  0   plain nodes (a selected one too — nothing lifts on select, #170 D7)
 * 11   the edge whose label is being edited            (#93)
 * 12   that edge's two endpoint nodes                  (#93),
 *      and a node whose label is being edited          (#170)
 * 13   a lifeline's self-message                       (#99)
 * ```
 *
 * The label-edit pair (11/12) keeps the edge *below* its own two boxes, which
 * is how edges paint everywhere else — only the box covering it loses.
 *
 * A self-message is the one edge that has to break that: its loop is drawn
 * entirely **inside** its own lifeline (36px of loop against 60px of node
 * half-width on a default 120px column), and a lifeline's body takes pointer
 * events, so at any z below the node the edge is unreachable — not selectable,
 * not deletable, not even right-clickable. 13 puts it over every other value
 * here, including a lifeline lifted for a label edit (12), so the loop stays
 * grabbable in all of them.
 */
export const LIFT_NODE_Z = 12;
export const LIFT_EDGE_Z = 11;
export const LIFT_SELF_MESSAGE_Z = 13;

/**
 * Brings the edge whose label is being edited, and the two nodes it connects,
 * to the front, and keeps every lifeline self-message above its own column.
 *
 * Editing a label on an edge that runs *under* a box used to focus an input
 * nobody could see: the edge layer paints behind the nodes and the label layer
 * is isolated behind them too (#91). `LabeledEdge` moves the editor itself
 * above the nodes (`ViewportPortal`), and this brings the line and its two
 * boxes along so the editor is not left hovering over a line that is still
 * hidden.
 *
 * **View-only.** `zIndex` is injected on the way into React Flow and never
 * reaches the store, so editing a label leaves no undo frame and never changes
 * what a saved file contains. `setNodeZ` is the deliberate, committed version
 * of this; the two must not be confused.
 *
 * Returns the arrays unchanged (same references, so React Flow sees no update)
 * when nothing is being edited or the id no longer resolves.
 */
export const liftForView = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  editedEdgeId: string | null,
  /**
   * The node whose label editor is open: selecting no longer lifts a node
   * (#170 D7), so a box partly under another would focus an editor nobody can
   * see. A backdrop stays back — lifted, a frame would cover what it holds.
   */
  editedNodeId: string | null = null,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const selfMessages = new Set(
    edges.filter((e) => e.source === e.target && isSequenceMessage(e, nodes)).map((e) => e.id),
  );
  const edited = editedEdgeId === null ? undefined : edges.find((e) => e.id === editedEdgeId);
  const editedNode =
    editedNodeId === null
      ? undefined
      : nodes.find((n) => n.id === editedNodeId && !isBackdrop(n.data.shape));
  if (selfMessages.size === 0 && !edited && !editedNode) return { nodes, edges };
  const lifted = (n: DiagramNode) =>
    n.id === editedNode?.id || (edited && (n.id === edited.source || n.id === edited.target));
  return {
    nodes:
      edited || editedNode
        ? nodes.map((n) => (lifted(n) ? { ...n, zIndex: LIFT_NODE_Z } : n))
        : nodes,
    edges: edges.map((e) => {
      // a self-message outranks the label-edit lift: the edited edge sitting
      // below its endpoint node is exactly what buries a self-message
      if (selfMessages.has(e.id)) return { ...e, zIndex: LIFT_SELF_MESSAGE_Z };
      if (edited && e.id === edited.id) return { ...e, zIndex: LIFT_EDGE_Z };
      return e;
    }),
  };
};
