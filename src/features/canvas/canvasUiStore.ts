import { create } from "zustand";

import type { SnapTarget } from "../../shared/lib/edgeUtils";
import { useDiagramStore } from "../../shared/lib/store";

export interface EdgeMenuState {
  edgeId: string;
  clientX: number;
  clientY: number;
}

export interface NodeMenuState {
  nodeId: string;
  clientX: number;
  clientY: number;
  /** opened without a pointer, so the menu takes focus (#139) */
  fromKeyboard?: boolean;
}

export interface DropMenuState {
  fromId: string;
  fromHandle: string | null;
  flowX: number;
  flowY: number;
  clientX: number;
  clientY: number;
}

export interface EdgeLabelEditState {
  edgeId: string;
  which: "center" | "start" | "end";
}

interface CanvasUiState {
  /** arrow draw tool active (drag on canvas to draw a free arrow) */
  arrowMode: boolean;
  edgeMenu: EdgeMenuState | null;
  nodeMenu: NodeMenuState | null;
  dropMenu: DropMenuState | null;
  edgeLabelEdit: EdgeLabelEditState | null;
  /**
   * id of the node whose label editor is open.
   *
   * Lives here rather than in `ShapeNode` local state so the swap cleanup
   * below can close it. React keys nodes by id, so a document swap that reuses
   * an id reuses the component instance — a local `editing` would survive into
   * the new document with the *old* text in an uncontrolled textarea, and blur
   * would then write that text onto the new node (#105).
   */
  nodeLabelEdit: string | null;
  /** clipboard for edge style copy/paste */
  copiedEdgeStyle: Record<string, unknown> | null;
  /** node/handle an arrow endpoint drag would snap to (shows its points) */
  snapTarget: SnapTarget | null;
  /** the anchor whose drag found `snapTarget` — its lines preview as landed there */
  snapFor: string | null;
  /** the image node shown large over the window (`ImageView`) */
  imageView: string | null;

  setArrowMode: (on: boolean) => void;
  /** `forAnchor`: the dragged anchor, when an existing line's end is what lands */
  setSnapTarget: (target: SnapTarget | null, forAnchor?: string) => void;
  setEdgeMenu: (menu: EdgeMenuState | null) => void;
  setNodeMenu: (menu: NodeMenuState | null) => void;
  setDropMenu: (menu: DropMenuState | null) => void;
  setEdgeLabelEdit: (state: EdgeLabelEditState | null) => void;
  setNodeLabelEdit: (nodeId: string | null) => void;
  setCopiedEdgeStyle: (style: Record<string, unknown> | null) => void;
  setImageView: (nodeId: string | null) => void;
}

/**
 * Live pointer state during a React Flow connection drag (flow coords).
 * Mutable module state, not reactive: read once when the connection completes
 * to place lifeline message handles at the pointer's y.
 *
 * Lifetime: written by the lifeline handle's pointerdown and by ConnectionLine
 * while dragging, read by DiagramCanvas's onConnect, cleared by
 * ConnectionLine's unmount cleanup. This relies on React Flow calling
 * onConnect *before* it tears down the connection preview — if that order ever
 * flips, `start` reads as null and messages silently fall back to mid-line
 * (`right-50`) instead of landing at the pointer. A failing
 * `resolveMessageConnection` test would not catch it; the canvas drag test in
 * DiagramCanvas is the guard.
 */
export const connectDrag: {
  /** where the drag started (pointer-down on a handle) */
  start: { x: number; y: number } | null;
  /** latest drag position (kept fresh by ConnectionLine) */
  point: { x: number; y: number } | null;
} = { start: null, point: null };

export const useCanvasUiStore = create<CanvasUiState>((set, get) => ({
  arrowMode: false,
  edgeMenu: null,
  nodeMenu: null,
  dropMenu: null,
  edgeLabelEdit: null,
  nodeLabelEdit: null,
  copiedEdgeStyle: null,
  snapTarget: null,
  snapFor: null,
  imageView: null,

  setArrowMode: (arrowMode) => set({ arrowMode }),
  setSnapTarget: (snapTarget, forAnchor) =>
    set({ snapTarget, snapFor: snapTarget ? (forAnchor ?? null) : null }),
  // The two right-click menus are mutually exclusive: opening one closes the
  // other, so a stale menu never survives behind the new one.
  //
  // In practice this is usually redundant — a right-click's `pointerdown`
  // lands before its `contextmenu`, so `useOutsideDismiss` has already closed
  // the previous menu. It is kept as the guarantee rather than the mechanism
  // (#139).
  setEdgeMenu: (edgeMenu) => set({ edgeMenu, nodeMenu: edgeMenu ? null : get().nodeMenu }),
  setNodeMenu: (nodeMenu) => set({ nodeMenu, edgeMenu: nodeMenu ? null : get().edgeMenu }),
  setDropMenu: (dropMenu) => set({ dropMenu }),
  setEdgeLabelEdit: (edgeLabelEdit) => set({ edgeLabelEdit }),
  setNodeLabelEdit: (nodeLabelEdit) => set({ nodeLabelEdit }),
  setCopiedEdgeStyle: (copiedEdgeStyle) => set({ copiedEdgeStyle }),
  setImageView: (imageView) => set({ imageView }),
}));

// An entity deleted while ui state points at it (bridge ops, undo, file load)
// would leave that state referencing a dead id. Bridge clients pick their own
// ids, so the next same-id entity would inherit it — an edge would mount
// already editing with #74's guard hiding its handles (#76), a drop menu
// would create an edge from a vanished node (#77). Every deletion path
// funnels through the diagram store, so one subscription covers them all.
// No dispose: an HMR re-evaluation stacks a duplicate subscription, but the
// callback is idempotent — same class as the store.ts restart rule.
useDiagramStore.subscribe((state, prevState) => {
  const ui = useCanvasUiStore.getState();
  if (
    !ui.edgeLabelEdit &&
    !ui.nodeLabelEdit &&
    !ui.edgeMenu &&
    !ui.nodeMenu &&
    !ui.dropMenu &&
    !ui.snapTarget &&
    !ui.imageView
  )
    return;
  // a wholesale document swap (loadDoc / set_diagram) may reuse the same ids
  // in a single set, so an existence check can't see it — the version bump
  // can, and a context switch should close the editor/menus anyway
  const swapped = state.docVersion !== prevState.docVersion;
  const edgeGone = (edgeId: string): boolean =>
    swapped || !state.edges.some((e) => e.id === edgeId);
  const nodeGone = (nodeId: string): boolean =>
    swapped || !state.nodes.some((n) => n.id === nodeId);
  if (ui.edgeLabelEdit && edgeGone(ui.edgeLabelEdit.edgeId)) ui.setEdgeLabelEdit(null);
  if (ui.nodeLabelEdit && nodeGone(ui.nodeLabelEdit)) ui.setNodeLabelEdit(null);
  if (ui.edgeMenu && edgeGone(ui.edgeMenu.edgeId)) ui.setEdgeMenu(null);
  if (ui.nodeMenu && nodeGone(ui.nodeMenu.nodeId)) ui.setNodeMenu(null);
  if (ui.dropMenu && nodeGone(ui.dropMenu.fromId)) ui.setDropMenu(null);
  if (ui.snapTarget && nodeGone(ui.snapTarget.nodeId)) ui.setSnapTarget(null);
  // the image view closes with its picture: the node gone, no longer an image,
  // or another document on screen
  const viewed = ui.imageView;
  const stillImage = (id: string): boolean =>
    !swapped && state.nodes.some((n) => n.id === id && n.data.shape === "image");
  if (viewed && !stillImage(viewed)) ui.setImageView(null);
});
