import type { LayoutDirection } from "../autoLayout";
import type { Box } from "./groupResize";
import type { Connection, EdgeChange, NodeChange } from "@xyflow/react";
import type { StoreApi } from "zustand";

import type { ClipboardFragment } from "./clipboard";
import type {
  AgentOp,
  DiagramDoc,
  DiagramEdge,
  DiagramNode,
  EdgeStylePatch,
  PaletteColor,
  ShapeKind,
} from "../types";
import type { IconId } from "../iconIds";
import type { RevealRequest } from "./reveal";

export interface Snapshot {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** one undo step: the document — a diagram is one canvas (#229 D1) */
export type HistoryFrame = Snapshot;

export interface DiagramState {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** external file the document came from (Open) — never set together with `projectId` */
  filePath: string | null;
  /**
   * Library project the document belongs to (#114). Autosave follows this;
   * `filePath` documents are saved only on request. Both null = a document
   * that lives nowhere yet (blank canvas before the first project).
   */
  projectId: string | null;
  /**
   * Bumped whenever the document is replaced wholesale (loadDoc / set_diagram).
   * Entity-referencing UI state can't detect a swap by existence checks — the
   * new document may reuse the same ids in a single set (#76).
   */
  docVersion: number;
  /**
   * Bumped only when a different document is opened (`loadDoc` — a project,
   * a file, the blank behind Home). Edits inside one document never change it,
   * set_diagram included: it is how a chat turn knows the diagram
   * it was asked about is still the one open (#167).
   */
  docSession: number;
  /** node id that should open its inline label editor (Enter key / double-click) */
  editRequestId: string | null;
  /**
   * Left by every wholesale document swap (loadDoc / set_diagram / clear) for
   * `ViewportReveal` to act on — the store cannot move the viewport itself.
   */
  revealRequest: RevealRequest | null;
  /** clears the request once it has been acted on; a newer request survives */
  consumeReveal: (key: number) => void;
  /** node/edge ids recently edited by an AI agent → timestamp (for highlight) */
  touched: Record<string, number>;
  past: HistoryFrame[];
  future: HistoryFrame[];

  onNodesChange: (changes: NodeChange<DiagramNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<DiagramEdge>[]) => void;
  /**
   * Adds an edge. `at` is where the user put an end down (a drop, a stroke's
   * end) — the end sits there on its side; an end without one is spread (#204).
   */
  onConnect: (
    connection: Connection,
    at?: { source?: { x: number; y: number }; target?: { x: number; y: number } },
  ) => void;
  /** Deselects everything — the chat's selection chip clears it this way. */
  clearSelection: () => void;
  selectForContextMenu: (nodeId: string) => void;

  commit: () => void;
  undo: () => void;
  redo: () => void;

  setTitle: (title: string) => void;
  setFilePath: (path: string | null) => void;
  addNode: (
    shape: ShapeKind,
    position: { x: number; y: number },
    options?: { icon?: IconId },
  ) => string;
  /** Adds a free-standing arrow (two draggable anchor points + an edge). */
  addFreeArrow: (position: { x: number; y: number }) => void;
  /** Adds a free arrow between two explicit points (arrow draw tool). */
  addFreeArrowBetween: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  /**
   * Arrow draw tool: connects whatever lies under the start/end points —
   * node↔node, node↔empty (anchor), or a fully free arrow.
   */
  drawArrow: (start: { x: number; y: number }, end: { x: number; y: number }) => void;
  /** Creates a same-style node next to `sourceId` and connects them. */
  addAdjacentNode: (sourceId: string, side: "top" | "right" | "bottom" | "left") => string | null;
  /**
   * Completes a connection dropped on empty canvas: creates a new node (or a
   * bare anchor point) at `position` and connects it to the source.
   */
  connectToNew: (
    fromId: string,
    fromHandle: string | null,
    position: { x: number; y: number },
    shape: ShapeKind | "arrow-only",
  ) => void;
  updateNodeData: (id: string, patch: Partial<DiagramNode["data"]>) => void;
  updateEdgeData: (id: string, patch: Partial<NonNullable<DiagramEdge["data"]>>) => void;
  /** Like updateEdgeData but without a history commit (for live dragging). */
  updateEdgeDataLive: (id: string, patch: Partial<NonNullable<DiagramEdge["data"]>>) => void;
  /** Swaps source/target (and handles, endpoint markers/labels, waypoints). */
  reverseEdge: (id: string) => void;
  /** Moves one endpoint of an edge to a different node/handle. */
  reconnectEdge: (
    edgeId: string,
    connection: {
      source: string;
      target: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => void;
  /**
   * Attaches every edge touching an anchor to a real node, then removes the
   * anchor. `handle` pins the connection point; omitted = nearest side.
   */
  rewireAnchorToNode: (anchorId: string, nodeId: string, handle?: string) => void;
  /** Moves nodes by a delta without a history commit (for live dragging). */
  translateNodesLive: (ids: string[], dx: number, dy: number) => void;
  /** Places a node at an absolute position without a history commit. */
  setNodePositionLive: (id: string, x: number, y: number) => void;
  /**
   * Detaches one endpoint of an edge from its node, replacing it with a
   * draggable anchor at `pos`. Returns the new anchor's id.
   */
  detachEndpointToAnchor: (
    edgeId: string,
    end: "source" | "target",
    pos: { x: number; y: number },
  ) => string | null;
  /** Moves a lifeline message edge to absolute y, keeping it horizontal (no history commit). */
  setMessageYLive: (edgeId: string, y: number) => void;
  /**
   * Moves one end of a lifeline self-message to absolute y, leaving the other
   * end where it is — this is what changes the loop's height (#99). Live.
   */
  setSelfMessageEndYLive: (edgeId: string, end: "source" | "target", y: number) => void;
  /**
   * Slides an unbent edge sideways by moving both attachment points along the
   * sides they already sit on. Sides stay fixed; only the `-<pct>` changes.
   * Live — no history commit (callers commit at drag start).
   */
  slideEdgeLine: (edgeId: string, to: { x: number; y: number }) => void;
  /**
   * Updates one activation bar's span (node-relative y), clamped to the line
   * and a minimum height. Live — no history commit (commit at drag start).
   */
  setActivationLive: (nodeId: string, index: number, y0: number, y1: number) => void;
  /** Re-snaps messages touching the given lifelines to horizontal (after drag/resize). */
  resnapMessages: (nodeIds: string[]) => void;
  /**
   * Aligns the given lifelines (non-lifelines are ignored) and re-snaps their
   * messages. One history frame; a no-op when nothing would move.
   */
  alignLifelines: (nodeIds: string[], mode: "tops" | "distribute") => void;
  /**
   * Moves nodes to the front or back of the paint order, keeping their relative
   * order. One history frame; a no-op for an empty selection.
   */
  setNodeZ: (nodeIds: string[], to: "front" | "back") => void;
  /** recolours every listed node in one undo step (#159) */
  setNodesColor: (nodeIds: string[], color: PaletteColor) => void;
  /**
   * Adds an image node (#8) with an already-validated data URL, at `position`
   * (top-left) and `size`, linked to `original` — the file it came from — when
   * there is one. One history frame; returns the new id.
   */
  addImage: (
    src: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
    original?: string,
  ) => string;
  /**
   * Arranges shapes with dagre (#3) — the given ids, or every shape that is
   * not part of a sequence diagram (the toolbar always passes the selection,
   * #182). Reports how many moved. Nothing moves, and no history frame is
   * left, below two shapes or when they are already arranged.
   */
  autoLayout: (
    direction: LayoutDirection,
    ids?: string[],
  ) => {
    moved: number;
    /** frames grown or moved to keep holding the arranged shapes (#182) */
    framesAdjusted?: number;
    reason?: "too-few" | "unchanged";
  };
  /**
   * Re-derives a node's React Flow `style` from its shape. Frames are
   * click-through; every other shape must not be. No history frame — callers
   * pair it with the shape change that already committed.
   */
  setNodeStyleForShape: (nodeId: string, shape: ShapeKind) => void;
  deleteElements: (nodeIds: string[], edgeIds: string[]) => void;

  /**
   * Shapes held by the last copy. App-internal and value-based, not a set of
   * ids: the originals may be deleted — or a whole other file opened — before
   * the paste. Never reaches a snapshot or a `.dosik` file; both only carry
   * title/nodes/edges.
   */
  clipboard: ClipboardFragment | null;
  /**
   * Offset steps consumed by paste *and* duplicate so far. Drives the cascade;
   * reset on copy. Duplicate advances it even though it never routes through
   * the buffer — the two measure from different origins, so the shared counter
   * is what keeps a paste from landing exactly on a duplicate.
   */
  pasteCount: number;
  /**
   * Shapes riding along with the frames being dragged, fixed when the drag
   * started (#170 D4) — `null` while nothing is being dragged.
   */
  dragRiders: Record<string, string[]> | null;
  /**
   * A group resize in progress (#179): the group's members and edges as they
   * were when the handle was grabbed — every step scales from these, so the
   * rounding of one step never feeds the next. `null` while none.
   */
  groupResizing: {
    ids: string[];
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    committed: boolean;
  } | null;
  /** a handle of group `groupId`'s box was grabbed */
  beginGroupResize: (groupId: string) => void;
  /** the members' box is now `to` (flow units) — the first step opens the undo frame */
  resizeGroup: (to: Box) => void;
  endGroupResize: () => void;
  /** a drag of `ids` is starting — fix what rides on the frames among them */
  beginNodeDrag: (ids: string[]) => void;
  endNodeDrag: () => void;
  /**
   * The group the user has stepped into (#171) — its shapes are picked one by
   * one instead of selecting the whole group. `null`: none.
   */
  enteredGroup: string | null;
  enterGroup: (groupId: string | null) => void;
  /** binds the selected shapes into one group (folding in groups they touch); false: fewer than two */
  groupSelection: () => boolean;
  /** releases every group the selection touches; false: none */
  ungroupSelection: () => boolean;
  /**
   * Steps into the group of `nodeId` and picks that shape alone — a second
   * click on a selected group, or a double-click (#171). No-op outside a group.
   */
  pickInGroup: (nodeId: string) => void;
  /** Copies the selection into `clipboard`. False when it held nothing to copy. */
  copySelection: () => boolean;
  /**
   * Drops a copy of the buffer, offset from the original and cascading on
   * repeat, then selects it. One history frame — undo takes the whole paste.
   * False when the buffer was empty and nothing happened.
   */
  paste: () => boolean;
  /**
   * Lands a piece of document built elsewhere — a pasted Mermaid diagram
   * (#200) — moved by `delta`, with fresh ids, as the selection; the view is
   * asked to show it. One history frame. Returns the new node ids (none, and
   * no frame, for an empty piece).
   */
  insertFragment: (fragment: ClipboardFragment, delta: { dx: number; dy: number }) => string[];
  /**
   * Copy, then delete the selection — exactly what Cmd+C and Delete each do.
   * One history frame. False when nothing was selected.
   *
   * When the copy captures nothing the buffer is cleared rather than kept: a
   * cut changed the document, so a stale buffer would make the next paste drop
   * something the user never cut.
   */
  cutSelection: () => boolean;
  /**
   * Drops a copy of the selection next to it and selects the copy, without
   * touching the buffer's *contents*. Repeats cascade on their own: each run
   * reads the *current* selection, which is the previous copy. It does advance
   * `pasteCount`, so a following paste cannot land on the copy. False when
   * there was nothing to duplicate.
   */
  duplicateSelection: () => boolean;

  /** last used edge style, applied to newly created edges */
  lastEdgeStyle: EdgeStylePatch;

  requestEditLabel: (id: string | null) => void;
  applyOps: (ops: AgentOp[], fromAgent?: boolean) => { applied: number; errors: string[] };
  /**
   * Opens a document: checked (a multi-page one throws `MULTI_PAGE_ERROR`,
   * #229 D2; a broken one "Invalid diagram file"), normalized, history
   * cleared, `docSession` moved on. Nothing changes when it throws.
   */
  loadDoc: (doc: DiagramDoc, filePath: string | null) => void;
  /** opens a library project — `loadDoc` (docVersion, reveal) plus the project binding */
  openProject: (id: string, doc: DiagramDoc) => void;
  /** the document as a file — always v1 (#229 D1) */
  toDoc: () => DiagramDoc;
  clearTouched: (before: number) => void;
}

export type StoreSet = StoreApi<DiagramState>["setState"];
export type StoreGet = StoreApi<DiagramState>["getState"];
