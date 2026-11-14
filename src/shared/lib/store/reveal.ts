import type { Viewport } from "@xyflow/react";

/**
 * A request to bring the viewport to a document that was just swapped in.
 *
 * The store cannot touch the viewport (that is React Flow's), so every path
 * that replaces the document wholesale — file open, New, bridge `set_diagram`
 * and `clear` — leaves one of these, and a single consumer inside the
 * `ReactFlowProvider` (`ViewportReveal`) acts on it. `key` makes each request
 * distinct so the consumer can clear exactly the one it handled.
 */
export interface RevealRequest {
  key: number;
  /**
   * fit the content, go back to the origin when there is nothing to fit,
   * move to `bounds` at the zoom the user has, or put back the `viewport` a
   * tab was left at (#218 D5)
   */
  mode: "fit" | "origin" | "center" | "viewport";
  /**
   * `center` only: what a paste just put down (#200). A box, not node ids:
   * shapes that were only just added are not measured yet. The view moves to
   * it only when part of it is out of sight, and never zooms — the user
   * rejected a paste that changed the zoom.
   */
  bounds?: { x: number; y: number; width: number; height: number };
  /** `viewport` only: where the tab's canvas was when the user left it */
  viewport?: Viewport;
}

let seq = 0;

/**
 * Decides from the nodes the swap *ended up with* — not the ones the file or
 * op declared. `loadDoc` drops orphan anchors, so a "one node" file can load
 * to nothing, and a fit queued for nothing would outlive the open and fire on
 * the next shape added (#58's yank, #81). `set_diagram` does not prune, so
 * there an anchor-only document still counts as content and gets a fit.
 */
export const revealRequestFor = (nodes: readonly unknown[]): RevealRequest => ({
  key: ++seq,
  mode: nodes.length > 0 ? "fit" : "origin",
});

/** a move to this box, keeping the zoom (#200) */
export const revealBounds = (bounds: NonNullable<RevealRequest["bounds"]>): RevealRequest => ({
  key: ++seq,
  mode: "center",
  bounds,
});

/** back to where a tab was left — no fit, the user's own pan and zoom (#218 D5) */
export const revealViewport = (viewport: Viewport): RevealRequest => ({
  key: ++seq,
  mode: "viewport",
  viewport,
});
