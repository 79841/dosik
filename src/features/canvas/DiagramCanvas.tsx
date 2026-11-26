import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStoreApi,
  type FinalConnectionState,
  type NodeChange,
  type Node,
} from "@xyflow/react";
import { type DragEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef } from "react";
import { isIconId } from "../../shared/lib/iconIds";

import {
  clampToAttach,
  findSnapTarget,
  lifelineAttachRange,
  messageHandles,
  nodeBounds,
  SELF_MESSAGE_GAP,
} from "../../shared/lib/edgeUtils";
import { spreadsOnSides } from "../../shared/lib/placeEnds";
import { parseSide } from "../../shared/lib/sideAttach";
import { DEFAULT_NODE_SIZE, isBackdrop, THEME_CANVAS_DOT } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { withoutTouchedBackdrops } from "../../shared/lib/store/frames";
import { liveGroups, withBoxGroupSelection } from "../../shared/lib/store/groups";
import { GroupOutlines } from "./GroupOutlines";
import type { DiagramNode, ShapeKind } from "../../shared/lib/types";
import { ArrowDrawOverlay } from "./ArrowDrawOverlay";
import { connectDrag, useCanvasUiStore } from "./canvasUiStore";
import { liftForView } from "./canvasLifts";
import { ConnectionLine } from "./ConnectionLine";
import { connectionLanding, isDot } from "./connectionLanding";
import { alignDragMoves, inAutoPanZone, snapDropAligned } from "./dragSnap";
import { DropNodeMenu } from "./DropNodeMenu";
import { EdgeContextMenu } from "./EdgeContextMenu";
import { NodeContextMenu } from "./NodeContextMenu";
import { openShapeMenu } from "./selectionMenu";
import { LabeledEdge } from "./LabeledEdge";
import { ShapeNode } from "./ShapeNode";
import { registerPointerAt, registerViewportCenter, registerViewportRead } from "./canvasViewport";
import { droppedImageFiles } from "./imageFiles";
import { placeBlobs, useImageFileDrop } from "./useImageFileDrop";

export const SHAPE_DRAG_MIME = "application/modern-diagram-shape";

const nodeTypes = { shape: ShapeNode };

const anchorDragPoint = (node: Node): { x: number; y: number } => {
  const dragged = useDiagramStore.getState().nodes.find((n) => n.id === node.id);
  if (!dragged) return { x: 0, y: 0 };
  const b = nodeBounds({ ...dragged, position: node.position });
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** where a dragged anchor's line comes from — its end on a lifeline faces it (#210) */
const anchorOtherEnd = (anchorId: string): { x: number; y: number } | undefined => {
  const { nodes, edges } = useDiagramStore.getState();
  const edge = edges.find((e) => e.source === anchorId || e.target === anchorId);
  const other =
    edge && nodes.find((n) => n.id === (edge.source === anchorId ? edge.target : edge.source));
  if (!other) return undefined;
  const b = nodeBounds(other);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** what lining a drag up with its connectors reads (`alignDragMoves`) */
const alignContext = () => {
  const { nodes, edges, dragRiders } = useDiagramStore.getState();
  return { nodes, edges, riders: dragRiders };
};
const edgeTypes = { labeled: LabeledEdge };

/**
 * Resolves a lifeline↔lifeline connection into horizontal message handles at
 * the pointer's y (self-message when both ends are the same lifeline, its loop
 * height taken from the drag). Returns null for anything else — including a
 * lifeline pair with no pointer info, which falls back to the store's
 * mid-line default.
 */
export const resolveMessageConnection = (
  nodes: DiagramNode[],
  connection: { source: string | null; target: string | null },
  drag: { start: { y: number } | null; point: { y: number } | null },
): { sourceHandle: string; targetHandle: string } | null => {
  const source = nodes.find((n) => n.id === connection.source);
  const target = nodes.find((n) => n.id === connection.target);
  if (source?.data.shape !== "lifeline" || target?.data.shape !== "lifeline") return null;
  const rawY = drag.start?.y ?? drag.point?.y;
  if (rawY === undefined) return null;
  // a new attachment never lands below a destroy marker
  const y = clampToAttach(target, clampToAttach(source, rawY));
  if (source.id !== target.id) return messageHandles(source, target, y);
  const dropY = clampToAttach(source, drag.point?.y ?? y + SELF_MESSAGE_GAP);
  const gap = Math.max(16, Math.abs(dropY - y));
  // the loop's return leg must clear the marker too, not just its start
  const top = Math.min(Math.min(y, dropY), lifelineAttachRange(source).max - gap);
  return messageHandles(source, target, top, gap);
};

/**
 * How far the drag must travel vertically before a drop back on the source
 * lifeline counts as a self-message (#99).
 *
 * Without a floor, letting go where the drag began would silently create a
 * zero-height loop — and that gesture is how a user cancels a connection they
 * changed their mind about. Below the floor the drop stays "invalid", which is
 * what makes `onConnectEnd` fall through to the drop menu, exactly as today.
 */
export const SELF_MESSAGE_MIN_DROP = 16;

/**
 * Whether React Flow should treat a pending connection as connectable.
 *
 * Only self-connections are judged here; everything else is already handled by
 * React Flow's own rules. A lifeline dropping on itself is the case #99 opened:
 * the model has supported self-messages all along (`pickHandles`,
 * `resolveMessageConnection`, the bridge's `add_message` with `from == to`) but
 * the gesture could never produce one, because the only handle under the
 * pointer was the one the drag started from.
 *
 * Boxes are left alone (2026-08-23) — they can already self-loop
 * by dropping on a *different* side handle.
 */
export const isConnectionAllowed = (
  nodes: DiagramNode[],
  connection: { source: string | null; target: string | null },
  drag: { start: { y: number } | null; point: { y: number } | null },
): boolean => {
  if (!connection.source || !connection.target) return true;
  if (connection.source !== connection.target) return true;
  const node = nodes.find((n) => n.id === connection.source);
  if (node?.data.shape !== "lifeline") return true;
  const from = drag.start?.y;
  const to = drag.point?.y;
  // no pointer trail means the drag never moved — treat it as a cancel
  if (from === undefined || to === undefined) return false;
  return Math.abs(to - from) >= SELF_MESSAGE_MIN_DROP;
};

/** the parts of a mouse event the menu rules care about */
const pointer = (e: React.MouseEvent) => ({
  target: e.target as HTMLElement | null,
  clientX: e.clientX,
  clientY: e.clientY,
});

/** middle button only — see the note on `panOnDrag` below */
const PAN_BUTTONS = [1];

/** the grid a dragged shape lands on */
const SNAP_GRID: [number, number] = [8, 8];

/**
 * Where a mouse or touch event happened. A touch is read off the finger that
 * changed — on a touchend the one let go, which `touches` no longer lists.
 */
const clientOf = (event: MouseEvent | TouchEvent): { x: number; y: number } | null => {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches[0] ?? event.touches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
};

export const DiagramCanvas = () => {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const editedEdgeId = useCanvasUiStore((s) => s.edgeLabelEdit?.edgeId ?? null);
  const editedNodeId = useCanvasUiStore((s) => s.nodeLabelEdit);
  const onNodesChange = useDiagramStore((s) => s.onNodesChange);
  const onEdgesChange = useDiagramStore((s) => s.onEdgesChange);
  const onConnect = useDiagramStore((s) => s.onConnect);
  const addNode = useDiagramStore((s) => s.addNode);
  const commit = useDiagramStore((s) => s.commit);
  const setDropMenu = useCanvasUiStore((s) => s.setDropMenu);
  const setEdgeMenu = useCanvasUiStore((s) => s.setEdgeMenu);
  const setNodeMenu = useCanvasUiStore((s) => s.setNodeMenu);
  const setEdgeLabelEdit = useCanvasUiStore((s) => s.setEdgeLabelEdit);
  const { screenToFlowPosition, getViewport } = useReactFlow();
  // pictures dropped from Finder (#8), and the view centre ⌘V pastes one at
  useImageFileDrop(screenToFlowPosition);
  useEffect(
    () =>
      registerViewportCenter(() => {
        // the window centre is not the canvas centre — panels float over it
        const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
        return screenToFlowPosition(
          rect && rect.width > 0
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
        );
      }),
    [screenToFlowPosition],
  );
  // where a tab was left, so coming back to it does not fit again (#218 D5)
  useEffect(() => registerViewportRead(getViewport), [getViewport]);
  // where the pointer is over the canvas — ⌘V pastes a picture or Mermaid
  // there (#200); null once it leaves for a panel or the toolbar
  const hoverAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(
    () => registerPointerAt(() => (hoverAt.current ? screenToFlowPosition(hoverAt.current) : null)),
    [screenToFlowPosition],
  );

  // View-only paint order: the label editor (and its line) must not be buried
  // under a box while focused (#93), and a self-message must stay above the
  // lifeline it loops on or it cannot be clicked at all (#99). See `liftForView`.
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => liftForView(nodes, edges, editedEdgeId, editedNodeId),
    [nodes, edges, editedEdgeId, editedNodeId],
  );

  /*
   * A selection box picks what it touches (Partial), but a box drawn inside a
   * frame always touches the frame — dragging the picked shapes would then
   * drag the frame and everything it holds, and Delete would take the frame
   * (#170). A backdrop joins a selection box only when the box holds
   * it whole.
   *
   * The box is tracked here: React Flow sends the first step's selection
   * before it marks the box active, and remembers what it picked, so a frame
   * the box comes to hold whole later is never sent again — the end of the
   * box picks those up.
   */
  const boxStart = useRef<{ x: number; y: number } | null>(null);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const boxTo = useCallback(
    (client: { x: number; y: number }) => {
      const start = boxStart.current;
      if (!start) return null;
      const end = screenToFlowPosition(client);
      return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
    },
    [screenToFlowPosition],
  );
  const rf = useStoreApi();
  /*
   * The node drag in progress, from its start to its end — a fresh token per
   * drag. Every end clears the same state (`endDrag`): the pause in snapping,
   * what rides on the drag, the snap dot an anchor drag shows. Most drags end
   * at React Flow's stop, but one whose shape was deleted mid-drag (Delete,
   * ⌘X, a bridge op) is aborted and gets none — left behind, its riders
   * would steer the next arrow-key nudge and its dot would stay on the box
   * (#228).
   */
  const openDrag = useRef<object | null>(null);
  const handleNodesChange = useCallback(
    (raw: NodeChange<DiagramNode>[]) => {
      // a drag on the grid also lands where a connector to a shape left
      // behind runs straight, a few px off (`alignDragMoves`) — not while
      // snapping is paused at the view's edge. The release turns snapping
      // back on before React Flow's last move, so that one is lined up from
      // off the grid; the stop then puts the drop right (`snapDropAligned`)
      const changes =
        openDrag.current && rf.getState().snapToGrid ? alignDragMoves(raw, alignContext()) : raw;
      const box = boxTo(lastPointer.current);
      if (!box) return onNodesChange(changes);
      const { nodes, enteredGroup } = useDiagramStore.getState();
      // the box decides a group as a whole: touched anywhere, selected whole (#171)
      onNodesChange(
        withBoxGroupSelection(
          withoutTouchedBackdrops(changes, nodes, box),
          nodes,
          enteredGroup,
          box,
        ),
      );
    },
    [boxTo, onNodesChange, rf],
  );
  // the box is anchored where the button went down, as React Flow anchors it
  // — the start event arrives with the first move, already away from there
  const pressedAt = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const onSelectionStart = useCallback(() => {
    boxStart.current = screenToFlowPosition(pressedAt.current);
  }, [screenToFlowPosition]);
  const onSelectionEnd = useCallback(
    (e: React.MouseEvent) => {
      const box = boxTo({ x: e.clientX, y: e.clientY });
      boxStart.current = null;
      if (!box) return;
      const store = useDiagramStore.getState();
      const wanted = store.nodes
        .filter((n) => !n.selected && isBackdrop(n.data.shape))
        .map((n) => ({ type: "select" as const, id: n.id, selected: true }));
      // the backdrops the finished box holds whole
      const whole = withoutTouchedBackdrops(wanted, store.nodes, box);
      if (whole.length > 0) store.onNodesChange(whole);
    },
    [boxTo],
  );

  const handleConnect = useCallback(
    (connection: Parameters<typeof onConnect>[0]) => {
      const handles = resolveMessageConnection(
        useDiagramStore.getState().nodes,
        connection,
        connectDrag,
      );
      connectDrag.start = null;
      useCanvasUiStore.getState().setSnapTarget(null);
      // a drop on the body sits where it was put (#204 D3); a dot gives only
      // its side, and the store finds the free spot on it
      const onBody = !isDot(connection.targetHandle);
      onConnect(
        handles ? { ...connection, ...handles } : connection,
        onBody ? { target: screenToFlowPosition(lastPointer.current) } : undefined,
      );
    },
    [onConnect, screenToFlowPosition],
  );

  /** while a new connection is dragged over a box, show where it would land */
  const previewLanding = useCallback(
    (client: { x: number; y: number }) => {
      const c = rf.getState().connection;
      if (!c.inProgress) return;
      const ui = useCanvasUiStore.getState();
      const { nodes, edges } = useDiagramStore.getState();
      const landing = c.toNode
        ? connectionLanding(
            nodes,
            edges,
            { id: c.fromNode.id, handle: c.fromHandle?.id },
            { id: c.toNode.id, handle: c.toHandle?.id },
            screenToFlowPosition(client),
          )
        : null;
      const now = ui.snapTarget;
      if (now?.nodeId !== landing?.nodeId || now?.handle !== landing?.handle) {
        ui.setSnapTarget(landing);
      }
    },
    [rf, screenToFlowPosition],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // picture files (#8) — reach here on Windows and in a browser; on macOS
      // Tauri takes them first and its drag-drop event carries them instead
      // (useImageFileDrop). Files are this drop's either way: never the
      // webview's to open
      const files = [...event.dataTransfer.files];
      if (files.length > 0) {
        event.preventDefault();
        const pictures = droppedImageFiles(files);
        if (pictures.length > 0) {
          void placeBlobs(
            // a dropped File carries no path: nothing to link
            pictures.map((file) => async () => ({ blob: file })),
            screenToFlowPosition({ x: event.clientX, y: event.clientY }),
          );
        }
        return;
      }
      const payload = event.dataTransfer.getData(SHAPE_DRAG_MIME);
      if (!payload) return;
      event.preventDefault();
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // the icon palette drags "icon:<id>"; every other shape drags its kind
      const iconId = payload.startsWith("icon:") ? payload.slice("icon:".length) : null;
      const shape = iconId !== null ? "icon" : (payload as ShapeKind);
      // centre the new node's own box on the drop point (the palette click does the same)
      const size = DEFAULT_NODE_SIZE[shape] ?? DEFAULT_NODE_SIZE.rounded;
      addNode(
        shape,
        { x: position.x - size.width / 2, y: position.y - size.height / 2 },
        iconId !== null && isIconId(iconId) ? { icon: iconId } : undefined,
      );
    },
    [screenToFlowPosition, addNode],
  );

  const isValidConnection = useCallback(
    (connection: { source: string | null; target: string | null }) =>
      isConnectionAllowed(useDiagramStore.getState().nodes, connection, connectDrag),
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      useCanvasUiStore.getState().setSnapTarget(null);
      if (state.isValid || !state.fromNode) return;
      // React Flow picks the nearest handle by distance alone, so a drop just
      // outside a box can land on a placed end's hidden handle, which takes no
      // connections. It is still a drop on that box — treat it as the body (#204)
      const toNode = state.toNode;
      const toShape = useDiagramStore.getState().nodes.find((n) => n.id === toNode?.id)?.data.shape;
      if (
        toNode &&
        toShape &&
        spreadsOnSides(toShape) &&
        toNode.id !== state.fromNode.id &&
        state.toHandle?.id?.includes("-") &&
        parseSide(state.toHandle.id) !== null
      ) {
        handleConnect({
          source: state.fromNode.id,
          sourceHandle: state.fromHandle?.id ?? null,
          target: toNode.id,
          targetHandle: "body",
        });
        return;
      }
      const client = clientOf(event);
      if (!client) return;
      const flow = screenToFlowPosition(client);
      setDropMenu({
        fromId: state.fromNode.id,
        fromHandle: state.fromHandle?.id ?? null,
        flowX: flow.x,
        flowY: flow.y,
        clientX: client.x,
        clientY: client.y,
      });
    },
    [screenToFlowPosition, setDropMenu, handleConnect],
  );

  /*
   * Grid snapping pauses while a drag sits where React Flow slides the view
   * (#228). There the view moves a fraction of a pixel every frame while a
   * snapped shape moves in 8px steps, so the shape shook under a still
   * pointer. Off the grid it follows the pointer; back away from the edge the
   * grid returns, and a drop made after the pause is put back on it.
   */
  const leftGrid = useRef(false);
  // the pane as it stood when the drag began — React Flow measures it once
  // then (XYDrag's `containerBounds`) and slides by it; no layout read a frame
  const dragPane = useRef<DOMRect | null>(null);
  /*
   * The pause is written to React Flow's store and nowhere else. React Flow
   * reads snapping there on its next mousemove or auto-pan frame, which can
   * come before React renders anything — a frame still snapped is a jump. A
   * prop that followed the pause would reach the store only after a render
   * (StoreUpdater, a passive effect), and a render held up past the next
   * crossing would write the old value over the fresh one; it would also
   * re-render the canvas at every crossing. So the prop stays on (#228) —
   * React Flow writes a prop only when it changes.
   */
  const setSnap = useCallback(
    (on: boolean) => {
      if (rf.getState().snapToGrid !== on) rf.setState({ snapToGrid: on });
    },
    [rf],
  );
  const resumeSnap = useCallback(() => {
    leftGrid.current = false;
    setSnap(true);
  }, [setSnap]);
  /** snapping off while a node drag's pointer is where the view slides */
  const snapAt = useCallback(
    (client: { x: number; y: number } | null) => {
      const pane = dragPane.current;
      if (!pane || !client) return;
      const sliding = inAutoPanZone(client, pane);
      if (sliding) leftGrid.current = true;
      setSnap(!sliding);
    },
    [setSnap],
  );
  const endDrag = useCallback(() => {
    openDrag.current = null;
    dragPane.current = null;
    resumeSnap();
    const store = useDiagramStore.getState();
    if (store.dragRiders) store.endNodeDrag();
    const ui = useCanvasUiStore.getState();
    if (ui.snapTarget) ui.setSnapTarget(null);
  }, [resumeSnap]);
  /*
   * Every pointer step of a node drag counts, not only those React Flow
   * reports: it calls `onNodeDrag` when a shape changes cell, so a step into
   * the zone that kept it in place went unseen until an auto-pan frame bumped
   * it a cell — one jump (#228). Heard on the window: by the edge the
   * pointer is often over a floating panel, out of the canvas's reach.
   *
   * The press ending ends the pause at once, stop or no stop: React Flow's
   * store's snapping also steers screenToFlowPosition, resizing and the
   * arrow-key nudge. The drag's auto-pan goes off with it. React Flow's abort
   * skips its `cancelAnimationFrame`, so an aborted drag in the zone kept
   * sliding the view without end; the loop reads `autoPanOnNodeDrag` each
   * frame and stops itself on false. A drag that ends normally has cancelled
   * it already, and the next drag's start turns it back on. Dosik passes no
   * such prop, so React Flow never writes the field over.
   *
   * The rest of the drag's end waits a turn. A stop that does come follows
   * the release — React Flow ends on the same press's mouseup or touchend —
   * and still needs `leftGrid` to snap the drop and the riders to carry; a
   * drag still open once that has had its turn was aborted.
   *
   * Only the primary pointer counts — a mouse's, a pen's, the first finger's.
   * Another finger touching and lifting mid-drag leaves React Flow dragging,
   * and its release ended the drag state: the riders stopped following
   * (#228).
   */
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.isPrimary) snapAt({ x: e.clientX, y: e.clientY });
    };
    const onRelease = (e: globalThis.PointerEvent) => {
      if (!e.isPrimary) return;
      const drag = openDrag.current;
      if (!drag) return;
      dragPane.current = null;
      setSnap(true);
      rf.setState({ autoPanOnNodeDrag: false });
      setTimeout(() => {
        if (openDrag.current === drag) endDrag();
      }, 0);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onRelease, true);
    window.addEventListener("pointercancel", onRelease, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onRelease, true);
      window.removeEventListener("pointercancel", onRelease, true);
    };
  }, [snapAt, setSnap, rf, endDrag]);

  const onNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: Node) => {
      // auto-pan frames pass the last pointer event — still where the pointer
      // is, and past the window's edge maybe the only word of it
      snapAt(clientOf(event));

      const store = useDiagramStore.getState();
      const dragged = store.nodes.find((n) => n.id === node.id);
      if (dragged?.data.shape !== "anchor") return;
      // show the connection points of a nearby box while dragging an anchor
      const snap = findSnapTarget(
        store.nodes,
        anchorDragPoint(node),
        [node.id],
        undefined,
        anchorOtherEnd(node.id),
      );
      // no `forAnchor`: dragged here the anchor stays under the pointer, not on the
      // spot, so its line keeps running to it rather than to where it would land
      useCanvasUiStore.getState().setSnapTarget(snap);
    },
    [snapAt],
  );

  const onNodeDragStop = useCallback(
    // `node` can be missing: a shape deleted mid-drag and let go without a
    // move is never aborted, and React Flow's stop then has none to pass
    (_: MouseEvent | TouchEvent, node: Node | undefined, dragged: Node[]) => {
      // a drop after a pause in snapping lands on the grid (#228), or where a
      // connector runs straight as on a drag — a plain move, no commit: the
      // drag opened its undo step, and riders still ride
      const moves = leftGrid.current ? snapDropAligned(dragged, SNAP_GRID, alignContext()) : [];
      if (moves.length > 0) {
        useDiagramStore
          .getState()
          .onNodesChange(moves.map((m) => ({ ...m, type: "position", dragging: false })));
      }
      // what rode along moved too — read before the drag state is cleared
      const riders = Object.values(useDiagramStore.getState().dragRiders ?? {}).flat();
      // before anything that may find no shape: a stop for one deleted mid-drag ends the drag too
      endDrag();
      const store = useDiagramStore.getState();
      const draggedNode = node && store.nodes.find((n) => n.id === node.id);
      if (!node || !draggedNode) return;
      if (draggedNode.data.shape === "anchor") {
        // near a box: attach the arrow to the connection point it showed
        const snap = findSnapTarget(
          store.nodes,
          anchorDragPoint(node),
          [node.id],
          undefined,
          anchorOtherEnd(node.id),
        );
        if (snap) store.rewireAnchorToNode(draggedNode.id, snap.nodeId, snap.handle);
      }
      // moving lifelines (or found/lost anchors) tilts their messages — snap
      // them level again. Covers multi-select drags where either end co-moves,
      // and what a frame carried
      const movedMessageEnds = [...dragged.map((n) => n.id), ...riders].filter((id) => {
        const shape = store.nodes.find((sn) => sn.id === id)?.data.shape;
        return shape === "lifeline" || shape === "anchor";
      });
      if (movedMessageEnds.length > 0) store.resnapMessages(movedMessageEnds);
    },
    [endDrag],
  );

  /*
   * Groups (#171): a click on a grouped shape selects the group; a second
   * click on a group already selected steps into it and picks that shape.
   * Whether it was already selected has to be read before React Flow applies
   * the click's own selection — hence the capture phase. A click on anything
   * outside the group the user stepped into steps back out first, so that
   * click selects whole groups again.
   */
  const stepIn = useRef<string | null>(null);
  const onPointerDownCapture = useCallback((e: PointerEvent) => {
    stepIn.current = null;
    const target = e.target as Element;
    const id = target.closest?.(".react-flow__node")?.getAttribute("data-id");
    const store = useDiagramStore.getState();
    const g = id ? store.nodes.find((n) => n.id === id)?.data.groupId : undefined;
    // anything on the canvas but the stepped-into group steps out — a line,
    // the empty canvas a selection box starts on, another shape (#171)
    if (
      store.enteredGroup &&
      g !== store.enteredGroup &&
      target.closest?.(".react-flow__renderer")
    ) {
      store.enterGroup(null);
    }
    if (!id) return;
    const members = g ? liveGroups(store.nodes).get(g) : undefined;
    if (
      members &&
      g !== useDiagramStore.getState().enteredGroup &&
      members.every((m) => store.nodes.find((n) => n.id === m)?.selected)
    ) {
      stepIn.current = id;
    }
  }, []);

  return (
    <div
      className="relative h-full w-full"
      onPointerDownCapture={(e) => {
        pressedAt.current = { x: e.clientX, y: e.clientY };
        onPointerDownCapture(e);
      }}
      onPointerMoveCapture={(e) => {
        lastPointer.current = { x: e.clientX, y: e.clientY };
        hoverAt.current = { x: e.clientX, y: e.clientY };
      }}
      // React Flow moves the connection on the document's mousemove, which
      // fires after this pointermove — the preview trails it by one event
      onPointerMove={(e) => previewLanding({ x: e.clientX, y: e.clientY })}
      onPointerLeave={() => {
        hoverAt.current = null;
      }}
      // the box closes on every way a press ends — React Flow skips
      // onSelectionEnd on a cancel, and a box left open would filter every
      // later selection (#172). Bubble phase: onSelectionEnd reads the box
      // first. A node drag's end is the window's release (`endDrag`)
      onPointerUp={() => {
        boxStart.current = null;
      }}
      onPointerCancel={() => {
        boxStart.current = null;
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // a clicked shape is picked where it sits in the stack — React Flow
        // would otherwise lift a selected node above everything (+1000), and
        // a frame picked up that way would cover what it holds (#170 D7)
        elevateNodesOnSelect={false}
        onNodesChange={handleNodesChange}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStart={(event, __, dragged) => {
          // a press that turns into a drag moves the group, it does not step in
          stepIn.current = null;
          // whatever the last drag left — its release never came — goes first
          endDrag();
          openDrag.current = {};
          dragPane.current = rf.getState().domNode?.getBoundingClientRect() ?? null;
          // unless it starts where the view slides
          snapAt(clientOf(event));
          // the last release turned auto-pan off — see the window listeners
          if (!rf.getState().autoPanOnNodeDrag) rf.setState({ autoPanOnNodeDrag: true });
          commit();
          useDiagramStore.getState().beginNodeDrag(dragged.map((n) => n.id));
        }}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onEdgeDoubleClick={(e, edge) => {
          e.stopPropagation();
          setEdgeLabelEdit({ edgeId: edge.id, which: "center" });
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          setEdgeMenu({ edgeId: edge.id, clientX: e.clientX, clientY: e.clientY });
        }}
        /*
         * Dragging empty canvas draws a selection box; it used to pan (#145).
         *
         * Picking several shapes needed Shift+drag, which nobody finds — a
         * user dragged, got a pan, right-clicked and reported the menu as
         * broken. Panning moves to the places it can be found: space+drag
         * (React Flow's `panActivationKeyCode`, which flips `panOnDrag` to
         * true and so turns selection back off), the middle button, and the
         * wheel/trackpad.
         *
         * `panOnDrag` must never contain 2. React Flow's pane swallows
         * `onPaneContextMenu` when the right button is a pan button, which
         * would take the right-click menus (#139) with it.
         */
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={PAN_BUTTONS}
        panOnScroll
        onNodeContextMenu={(e, node) => {
          if (openShapeMenu({ ...pointer(e), nodeId: node.id, settle: true })) e.preventDefault();
        }}
        // React Flow lays a transparent rectangle over a rubber-band selection
        // (`.react-flow__nodesselection-rect`, z-index 3 above the viewport's
        // 2) and it swallows the right-click before any node sees it. Without
        // this the menu never opened on the very selections it exists for
        // (#139). Getting here means the selection is already settled.
        onSelectionContextMenu={(e, nodes) => {
          const id = nodes[0]?.id;
          if (id && openShapeMenu({ ...pointer(e), nodeId: id, settle: false })) e.preventDefault();
        }}
        onNodeClick={(e, node) => {
          // a click, not a drag: step into the group that was already selected
          if (stepIn.current === node.id && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            useDiagramStore.getState().pickInGroup(node.id);
          }
          stepIn.current = null;
        }}
        onPaneClick={() => {
          useDiagramStore.getState().enterGroup(null);
          setEdgeMenu(null);
          setNodeMenu(null);
          setEdgeLabelEdit(null);
        }}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        connectionLineComponent={ConnectionLine}
        connectionMode={ConnectionMode.Loose}
        // on: a drag's pause near the edge goes to React Flow's store alone (`setSnap`)
        snapToGrid
        snapGrid={SNAP_GRID}
        // no fitView: the app always mounts with an empty canvas, so the
        // prop's deferred one-shot fit would fire on the FIRST added shape
        // and yank the viewport (#58). The viewport follows document swaps
        // through the store's revealRequest → ViewportReveal (#81, #117).
        minZoom={0.2}
        maxZoom={2.5}
        // deletion is handled in canvasKeymap — React Flow's own path splits the
        // node and edge changes into two commits, costing a second Cmd+Z (#110).
        // Do not restore this: both paths would then run, and React Flow's
        // listener (its own, on document — `preventDefault` does not reach it)
        // would push `remove` changes for elements the keymap already deleted,
        // stacking empty history frames on top of the real one.
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        // the diagram is set in IBM Plex Mono — labels, line labels, badges and
        // their editors inherit it; the menus beside the flow stay in the
        // interface face (#216). Label sizes assume it (textLayout.ts).
        className="bg-[var(--dsk-canvas-bg,#FFFFFF)] font-mono"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color={THEME_CANVAS_DOT} />
        {/* zoom is the canvas column's own island (ZoomIsland); no minimap (#219 D10·D11) */}
        <GroupOutlines />
      </ReactFlow>
      <ArrowDrawOverlay />
      <EdgeContextMenu />
      <NodeContextMenu />
      <DropNodeMenu />
    </div>
  );
};
