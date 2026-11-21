import { entityNodeHeight, entityNodeWidth, sanitizeEntityColumns } from "./entityShape";
import { fitDecorToShape } from "./nodeDecor";
import { applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { DEFAULT_ICON, isIconId } from "./iconIds";
import { create, createStore, type StateCreator } from "zustand";

import {
  classNodeHeight,
  classNodeWidth,
  sanitizeClassMembers,
  sanitizeStereotype,
} from "./classShape";
import { slideSegment } from "./edgeGeometry";
import {
  effectiveMarkerEnd,
  effectiveMarkerStart,
  handlePointOnNode,
  handleSlidTo,
  isSequenceMessage,
  clampToAttach,
  lifelineAttachRange,
  SELF_MESSAGE_MIN_GAP,
  lifelineHandleAtY,
  messageHandles,
  mixedMessageHandle,
  newMessageMarkerEnd,
  nodeBounds,
  pickEdgeStyle,
  pruneSpentWaypoints,
  routingObstacles,
  sideHandleAt,
  findSnapTarget,
  type SnapTarget,
} from "./edgeUtils";
import { alignTops, distributeEvenly } from "./lifelineAlign";
import { BACKDROP_STYLE, DEFAULT_NODE_SIZE, isBackdrop } from "./palette";
import { createApplyOps, resnapAllMessages } from "./store/agentOps";
import { carryBends, dragRiders, withFrameRiders } from "./store/frames";
import { canGroup, groupNodes, liveGroups, ungroupNodes, withGroupSelection } from "./store/groups";
import { scaleGroup } from "./store/groupResize";
import { boxAround } from "./autoLayout";
import { revealBounds, revealRequestFor } from "./store/reveal";
import {
  collectFragment,
  instantiateFragment,
  landFragment,
  PASTE_OFFSET,
} from "./store/clipboard";
import {
  bothEnds,
  drawnEnds,
  type EdgeEndRef,
  placeEnds,
  soleOnSide,
  spreadsOnSides,
} from "./placeEnds";
import { parseSide } from "./sideAttach";
import { makeEdge } from "./store/edgeFactory";
import { cloneSnapshot, HISTORY_LIMIT, restoreSnapshot } from "./store/history";
import { clampActivation } from "./store/opValidation";
import {
  createShapeNode,
  pickHandles,
  pruneOrphanAnchors,
  sizeAfterShapeChange,
} from "./store/nodeFactory";
import {
  docErrors,
  documentFile,
  isMultiPage,
  MULTI_PAGE_ERROR,
  normalizeDoc,
} from "./store/document";
import { applyLayout, layoutPositions, planLayout } from "./store/layout";
import type { DiagramState } from "./store/state";
import type { DiagramEdge, DiagramNode } from "./types";

export type { DiagramState, HistoryFrame, Snapshot } from "./store/state";
export { createShapeNode, pickHandles } from "./store/nodeFactory";

/** Handle for an endpoint slid to `p`, honoring the lifeline attach range. */
const slidHandle = (
  node: DiagramNode,
  handle: string | null | undefined,
  p: { x: number; y: number },
): string | null => {
  const side = (handle ?? "").split("-")[0];
  if (node.data.shape === "lifeline" && (side === "left" || side === "right")) {
    return lifelineHandleAtY(node, clampToAttach(node, p.y), side);
  }
  return handleSlidTo(node, handle, p);
};

const diagramState: StateCreator<DiagramState> = (set, get) => ({
  title: "Untitled Diagram",
  nodes: [],
  edges: [],
  filePath: null,
  projectId: null,
  docVersion: 0,
  docSession: 0,
  editRequestId: null,
  revealRequest: null,
  touched: {},
  past: [],
  future: [],
  lastEdgeStyle: {},
  clipboard: null,
  dragRiders: null,
  // what rides on a drag: a frame's contents (#170), the rest of a group (#171)
  beginNodeDrag: (ids) => {
    const { nodes, enteredGroup } = get();
    set({ dragRiders: dragRiders(nodes, ids, enteredGroup) });
  },
  endNodeDrag: () =>
    // nothing may stay mid-drag once the drag is over — React Flow treats a
    // `dragging` node as inside every selection box (#170)
    set((state) => ({
      dragRiders: null,
      nodes: state.nodes.some((n) => n.dragging)
        ? state.nodes.map((n) => (n.dragging ? { ...n, dragging: false } : n))
        : state.nodes,
    })),
  groupResizing: null,
  beginGroupResize: (groupId) => {
    const { nodes, edges } = get();
    const ids = liveGroups(nodes).get(groupId);
    set({ groupResizing: ids ? { ids, nodes, edges, committed: false } : null });
  },
  resizeGroup: (to) => {
    const resizing = get().groupResizing;
    if (!resizing) return;
    // the undo frame opens on the first real step — a grab without a drag leaves none
    if (!resizing.committed) {
      get().commit();
      set({ groupResizing: { ...resizing, committed: true } });
    }
    const scaled = scaleGroup(resizing.nodes, resizing.edges, resizing.ids, to);
    const members = new Set(resizing.ids);
    const nodeById = new Map(scaled.nodes.filter((n) => members.has(n.id)).map((n) => [n.id, n]));
    const edgeById = new Map(scaled.edges.map((e) => [e.id, e]));
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const next = nodeById.get(n.id);
        return next ? { ...n, position: next.position, width: next.width, height: next.height } : n;
      }),
      edges: state.edges.map((e): DiagramEdge => {
        const bends = edgeById.get(e.id)?.data?.waypoints;
        return bends && e.data && bends !== e.data.waypoints
          ? { ...e, data: { ...e.data, waypoints: bends } }
          : e;
      }),
    }));
  },
  endGroupResize: () => {
    const resizing = get().groupResizing;
    set({ groupResizing: null });
    if (!resizing?.committed) return;
    // a lifeline's messages hang at a share of its height — put them back level
    const lifelines = get()
      .nodes.filter((n) => resizing.ids.includes(n.id) && n.data.shape === "lifeline")
      .map((n) => n.id);
    if (lifelines.length > 0) get().resnapMessages(lifelines);
    // a member that grew or moved can strand the bends of an edge leaving the
    // group — drop them as a single shape's resize does (#69, #179). Once
    // at the end: a bend dropped mid-drag would not come back on the way back.
    const moved = new Set(resizing.ids);
    set((state) => {
      const pruned = pruneSpentWaypoints(state.edges, state.nodes, moved);
      if (pruned === state.edges) return {};
      return {
        // an edge between two members had its bends scaled with them (D14) —
        // they are not spent, whatever their absolute length now
        edges: pruned.map((e, i) =>
          moved.has(e.source) && moved.has(e.target) ? state.edges[i]! : e,
        ),
      };
    });
  },
  enteredGroup: null,
  enterGroup: (groupId) => {
    const { enteredGroup, nodes } = get();
    if (enteredGroup === groupId) return;
    // stepping out with part of the group picked (⌘-click on a shape outside
    // it): the group joins the selection whole — never half selected (#173)
    const leaving = enteredGroup ? liveGroups(nodes).get(enteredGroup) : undefined;
    const picked = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    const whole = leaving?.some((id) => picked.has(id)) ? new Set(leaving) : null;
    set({
      enteredGroup: groupId,
      ...(whole
        ? {
            nodes: nodes.map((n) =>
              whole.has(n.id) && !n.selected ? { ...n, selected: true } : n,
            ),
          }
        : {}),
    });
  },
  groupSelection: () => {
    const { nodes } = get();
    // already exactly one group: nothing to do, and no empty undo step (#171)
    if (!canGroup(nodes)) return false;
    const next = groupNodes(
      nodes,
      nodes.filter((n) => n.selected).map((n) => n.id),
    );
    if (!next) return false;
    get().commit();
    set({ nodes: next, enteredGroup: null });
    return true;
  },
  pickInGroup: (nodeId) => {
    const { nodes } = get();
    const g = nodes.find((n) => n.id === nodeId)?.data.groupId;
    if (!g || !liveGroups(nodes).has(g)) return;
    set((state) => ({
      enteredGroup: g,
      nodes: state.nodes.map((n) =>
        n.selected === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId },
      ),
      edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    }));
  },
  ungroupSelection: () => {
    const { nodes } = get();
    const next = ungroupNodes(
      nodes,
      nodes.filter((n) => n.selected).map((n) => n.id),
    );
    if (!next) return false;
    get().commit();
    set({ nodes: next, enteredGroup: null });
    return true;
  },
  pasteCount: 0,

  onNodesChange: (changes) => {
    const hasRemove = changes.some((c) => c.type === "remove");
    if (hasRemove) get().commit();
    set((state) => {
      // a grouped shape brings its group into the selection (#171), and a
      // moving frame or group member carries the rest along (#170, #171)
      const all = withFrameRiders(
        withGroupSelection(changes, state.nodes, state.enteredGroup),
        state.nodes,
        state.dragRiders,
        state.enteredGroup,
      );
      const nodes = applyNodeChanges(all, state.nodes);
      // a line carried whole by a frame keeps its bends, moved along with it
      const own = new Set(changes.flatMap((c) => (c.type === "position" ? [c.id] : [])));
      const riderIds = new Set(
        all.flatMap((c) => (c.type === "position" && !own.has(c.id) ? [c.id] : [])),
      );
      const carried = carryBends(state.edges, state.nodes, nodes, riderIds);
      const kept = new Set(carried.filter((e, i) => e !== state.edges[i]).map((e) => e.id));
      // moving or resizing an endpoint leaves slide waypoints at their old
      // absolute coords — drop the ones that now twist the path (#69). A
      // carried line is not one of them: its bends moved with its ends
      const moved = new Set(
        all.filter((c) => c.type === "position" || c.type === "dimensions").map((c) => c.id),
      );
      const pruned = moved.size > 0 ? pruneSpentWaypoints(carried, nodes, moved) : carried;
      return {
        nodes,
        edges: kept.size === 0 ? pruned : pruned.map((e, i) => (kept.has(e.id) ? carried[i]! : e)),
      };
    });
  },

  onEdgesChange: (changes) => {
    const hasRemove = changes.some((c) => c.type === "remove");
    if (hasRemove) get().commit();
    set((state) => {
      const edges = applyEdgeChanges(changes, state.edges);
      return {
        edges,
        nodes: hasRemove ? pruneOrphanAnchors(state.nodes, edges) : state.nodes,
      };
    });
  },

  clearSelection: () => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    }));
  },

  /**
   * What a right-click does to the selection before its menu opens (#139).
   *
   * A shape outside the selection becomes the selection, the way every desktop
   * app behaves. A shape already inside it leaves the selection untouched, so a
   * menu opened on one of five picked shapes still acts on all five — the
   * alternative silently narrows an export to whichever shape was clicked.
   */
  selectForContextMenu: (nodeId) => {
    if (get().nodes.some((n) => n.id === nodeId && n.selected)) return;
    // a grouped shape brings its group, as a click does (#171)
    const { nodes, enteredGroup } = get();
    const g = nodes.find((n) => n.id === nodeId)?.data.groupId;
    const picked = new Set(
      g && g !== enteredGroup ? (liveGroups(nodes).get(g) ?? [nodeId]) : [nodeId],
    );
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.selected === picked.has(n.id) ? n : { ...n, selected: picked.has(n.id) },
      ),
      edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    }));
  },

  onConnect: (connection, at) => {
    if (!connection.source || !connection.target) return;
    get().commit();
    const { nodes, lastEdgeStyle } = get();
    const source = nodes.find((n) => n.id === connection.source);
    const target = nodes.find((n) => n.id === connection.target);
    const isMessage = source?.data.shape === "lifeline" && target?.data.shape === "lifeline";
    const fallback = source && target ? pickHandles(source, target) : null;
    // "line" is the lifeline strip handle's DOM id — never persisted; the
    // canvas resolves it to a `-<pct>` id before calling onConnect, so seeing
    // it here means no pointer info was available → fall back to mid-line.
    const isBody = (h: string | null | undefined): boolean => !h || h === "body" || h === "line";
    const edge = makeEdge(
      {
        source: connection.source,
        target: connection.target,
        sourceHandle: isBody(connection.sourceHandle)
          ? fallback?.sourceHandle
          : connection.sourceHandle,
        targetHandle: isBody(connection.targetHandle)
          ? fallback?.targetHandle
          : connection.targetHandle,
      },
      lastEdgeStyle,
      // messages are horizontal straight lines regardless of the last style, and
      // a call keeps UML's filled arrow unless an arrowhead was chosen (#210 D24)
      isMessage
        ? {
            pathStyle: "straight",
            waypoints: undefined,
            markerEnd: newMessageMarkerEnd(lastEdgeStyle),
          }
        : {},
    );
    // An end put down at a point sits where it was put (#204 D3); one that
    // came with only a side — a connection dot, or no handle at all — gets a
    // free spot on that side (D6). A `-<pct>` handle is already a spot.
    const auto: EdgeEndRef[] = [];
    const spot = (end: "source" | "target", node: DiagramNode | undefined) => {
      const handle = end === "source" ? edge.sourceHandle : edge.targetHandle;
      const side = parseSide(handle);
      // a self-loop's two sides make its shape; it has no spot to pick
      if (connection.source === connection.target) return handle;
      if (!node || !side || handle !== side || !spreadsOnSides(node.data.shape)) return handle;
      const p = at?.[end];
      if (p) return sideHandleAt(node, side, p);
      auto.push({ edgeId: edge.id, end });
      return handle;
    };
    const placed = {
      ...edge,
      sourceHandle: spot("source", source),
      targetHandle: spot("target", target),
    };
    set((state) => ({ edges: placeEnds(state.nodes, [...state.edges, placed], auto) }));
  },

  addFreeArrow: (position) => {
    get().addFreeArrowBetween(position, { x: position.x + 180, y: position.y });
  },

  addFreeArrowBetween: (startPos, endPos) => {
    get().commit();
    const start = createShapeNode("anchor", { x: startPos.x - 6, y: startPos.y - 6 });
    const end = createShapeNode("anchor", { x: endPos.x - 6, y: endPos.y - 6 });
    const edge = makeEdge(
      { source: start.id, target: end.id, sourceHandle: "center", targetHandle: "center" },
      get().lastEdgeStyle,
    );
    set((state) => ({
      nodes: [...state.nodes, start, end],
      edges: [...state.edges, edge],
    }));
  },

  drawArrow: (start, end) => {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return;
    const { nodes, lastEdgeStyle } = get();
    // An end lands on a shape the way a dragged line end does (#204 D17):
    // within 32px of it, at the nearest side's spot under the pointer — what
    // the arrow tool showed while drawing. Backdrops and anchors take none.
    const startSnap = findSnapTarget(nodes, start, [], undefined, end);
    const endSnap = findSnapTarget(nodes, end, [], undefined, start);
    const nodeOf = (snap: SnapTarget | null) =>
      snap ? nodes.find((n) => n.id === snap.nodeId) : undefined;
    const sourceNode = nodeOf(startSnap);
    const targetNode = nodeOf(endSnap);
    /** the snapped spot on a box; a lifeline end is a height, decided below */
    const boxHandle = (node: DiagramNode, snap: SnapTarget | null): string | null =>
      snap && spreadsOnSides(node.data.shape) ? snap.handle : null;

    if (
      sourceNode &&
      sourceNode.id === targetNode?.id &&
      sourceNode.data.shape === "lifeline" &&
      Math.abs(end.y - start.y) >= 8
    ) {
      // stroke down (or up) the same lifeline: self-message, loop height from the
      // stroke. a new attachment never lands below the destroy marker
      const endY = clampToAttach(sourceNode, Math.max(start.y, end.y));
      const gap = Math.max(16, endY - clampToAttach(sourceNode, Math.min(start.y, end.y)));
      // the loop's *return* leg must clear the marker too, not just its start
      const y = Math.min(
        clampToAttach(sourceNode, Math.min(start.y, end.y)),
        lifelineAttachRange(sourceNode).max - gap,
      );
      const handles = messageHandles(sourceNode, sourceNode, y, gap);
      get().onConnect({
        source: sourceNode.id,
        target: sourceNode.id,
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
      });
      return;
    }

    if (sourceNode && targetNode && sourceNode.id !== targetNode.id) {
      const isMessage =
        sourceNode.data.shape === "lifeline" && targetNode.data.shape === "lifeline";
      // message: anchor the horizontal y where the stroke started
      const handles = isMessage
        ? messageHandles(
            sourceNode,
            targetNode,
            clampToAttach(targetNode, clampToAttach(sourceNode, start.y)),
          )
        : {
            sourceHandle: boxHandle(sourceNode, startSnap),
            targetHandle: boxHandle(targetNode, endSnap),
          };
      // the stroke's two ends are where the user put the line (#204 D3)
      get().onConnect(
        {
          source: sourceNode.id,
          target: targetNode.id,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
        },
        { source: start, target: end },
      );
      return;
    }
    if (sourceNode && !targetNode && !spreadsOnSides(sourceNode.data.shape)) {
      get().connectToNew(sourceNode.id, null, end, "arrow-only");
      return;
    }
    if (sourceNode !== targetNode) {
      // one end on a shape, the other a free point
      get().commit();
      const onShape = (sourceNode ?? targetNode)!;
      const snap = sourceNode ? startSnap : endSnap;
      const free = sourceNode ? end : start;
      const anchor = createShapeNode("anchor", { x: free.x - 6, y: free.y - 6 });
      // a lifeline end is a message's height, not a spot on a side — and a
      // stroke ending on one stays a free arrow on its plain side (#36, #204)
      const shapeHandle =
        boxHandle(onShape, snap) ??
        (sourceNode
          ? pickHandles(onShape, anchor).sourceHandle
          : pickHandles(anchor, onShape).targetHandle);
      const edge = makeEdge(
        sourceNode
          ? {
              source: onShape.id,
              target: anchor.id,
              sourceHandle: shapeHandle,
              targetHandle: "center",
            }
          : {
              source: anchor.id,
              target: onShape.id,
              sourceHandle: "center",
              targetHandle: shapeHandle,
            },
        lastEdgeStyle,
      );
      set((state) => ({
        nodes: [...state.nodes, anchor],
        edges: [...state.edges, edge],
      }));
      return;
    }
    get().addFreeArrowBetween(start, end);
  },

  addAdjacentNode: (sourceId, side) => {
    const { nodes, lastEdgeStyle } = get();
    const source = nodes.find((n) => n.id === sourceId);
    if (!source || source.data.shape === "anchor") return null;
    get().commit();
    const b = nodeBounds(source);
    const size = DEFAULT_NODE_SIZE[source.data.shape];
    const gap = 90;
    // the neighbour of an icon is usually another service: keep shape, colour and glyph
    // only an icon node hands down its glyph — a box's icon is that box's own (#160)
    const icon =
      source.data.shape === "icon" && isIconId(source.data.icon) ? { icon: source.data.icon } : {};
    const position =
      side === "right"
        ? { x: b.x + b.width + gap, y: b.y + (b.height - size.height) / 2 }
        : side === "left"
          ? { x: b.x - gap - size.width, y: b.y + (b.height - size.height) / 2 }
          : side === "bottom"
            ? { x: b.x + (b.width - size.width) / 2, y: b.y + b.height + gap }
            : { x: b.x + (b.width - size.width) / 2, y: b.y - gap - size.height };
    const node = createShapeNode(source.data.shape, position, {
      color: source.data.color,
      ...icon,
    });
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
    const edge = makeEdge(
      { source: sourceId, target: node.id, sourceHandle: side, targetHandle: opposite[side] },
      lastEdgeStyle,
    );
    set((state) => {
      const nextNodes = [
        ...state.nodes.map((n) => ({ ...n, selected: false })),
        { ...node, selected: true },
      ];
      // the side was the user's, the spot on it was not (#204 D6)
      return {
        nodes: nextNodes,
        edges: placeEnds(nextNodes, [...state.edges, edge], bothEnds([edge.id])),
      };
    });
    return node.id;
  },

  connectToNew: (fromId, fromHandle, position, shape) => {
    const { nodes, lastEdgeStyle } = get();
    const source = nodes.find((n) => n.id === fromId);
    if (!source) return;
    get().commit();
    if (shape === "arrow-only") {
      const anchor = createShapeNode("anchor", { x: position.x - 6, y: position.y - 6 });
      const handles = pickHandles(source, anchor);
      const edge = makeEdge(
        {
          source: fromId,
          target: anchor.id,
          sourceHandle: fromHandle && fromHandle !== "body" ? fromHandle : handles.sourceHandle,
          targetHandle: "center",
        },
        lastEdgeStyle,
      );
      set((state) => {
        const nextNodes = [...state.nodes, anchor];
        return {
          nodes: nextNodes,
          edges: placeEnds(nextNodes, [...state.edges, edge], bothEnds([edge.id])),
        };
      });
      return;
    }
    const size = DEFAULT_NODE_SIZE[shape];
    const node = createShapeNode(shape, {
      x: position.x - size.width / 2,
      y: position.y - size.height / 2,
    });
    const handles = pickHandles(source, node);
    const edge = makeEdge(
      {
        source: fromId,
        target: node.id,
        sourceHandle: fromHandle && fromHandle !== "body" ? fromHandle : handles.sourceHandle,
        targetHandle: handles.targetHandle,
      },
      lastEdgeStyle,
    );
    set((state) => {
      const nextNodes = [
        ...state.nodes.map((n) => ({ ...n, selected: false })),
        { ...node, selected: true },
      ];
      return {
        nodes: nextNodes,
        edges: placeEnds(nextNodes, [...state.edges, edge], bothEnds([edge.id])),
      };
    });
  },

  commit: () => {
    const { title, nodes, edges, past } = get();
    const snapshot = cloneSnapshot({ title, nodes, edges });
    set({ past: [...past.slice(-HISTORY_LIMIT + 1), snapshot], future: [] });
  },

  undo: () => {
    const { past, future, title, nodes, edges } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    const current = cloneSnapshot({ title, nodes, edges });
    set({
      ...restoreSnapshot(previous, { nodes, edges }),
      past: past.slice(0, -1),
      future: [...future, current],
      // the shapes were swapped out: no group is still stepped into (#173),
      // and a resize in flight would rescale shapes that are no longer there (#179)
      enteredGroup: null,
      groupResizing: null,
    });
  },

  redo: () => {
    const { past, future, title, nodes, edges } = get();
    const next = future[future.length - 1];
    if (!next) return;
    const current = cloneSnapshot({ title, nodes, edges });
    set({
      ...restoreSnapshot(next, { nodes, edges }),
      future: future.slice(0, -1),
      past: [...past, current],
      enteredGroup: null,
      groupResizing: null,
    });
  },

  setTitle: (title) => set({ title }),
  setFilePath: (filePath) => set({ filePath }),
  requestEditLabel: (editRequestId) => set({ editRequestId }),
  consumeReveal: (key) =>
    set((state) => (state.revealRequest?.key === key ? { revealRequest: null } : {})),

  addImage: (src, position, size) => {
    get().commit();
    const node = createShapeNode("image", position, { src, ...size });
    set((state) => ({ nodes: [...state.nodes, node] }));
    return node.id;
  },

  addNode: (shape, position, options) => {
    get().commit();
    const node = createShapeNode(shape, position, options);
    set((state) => ({ nodes: [...state.nodes, node] }));
    return node.id;
  },

  updateNodeData: (id, patch) => {
    get().commit();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== id) return n;
        const data = { ...n.data, ...patch };
        // the glyph and the box decorations follow the shape, same rule as
        // the bridge (#9, #160)
        fitDecorToShape(data, DEFAULT_ICON);
        // the picture belongs to the image shape (#8) — a node turned away drops it
        if (data.shape !== "image" && "src" in data) delete data.src;
        // entering or leaving the icon footprint starts from the new shape's size
        const base = sizeAfterShapeChange(n.data.shape, data.shape, {
          width: n.width,
          height: n.height,
        });
        // the rows belong to the entity shape (#5); cleaned like class members,
        // and the box never ends up smaller than them
        if (data.shape !== "entity" && "columns" in data) delete data.columns;
        if (data.shape === "entity") {
          const cleaned = {
            ...data,
            columns: "columns" in patch ? sanitizeEntityColumns(data.columns) : data.columns,
          };
          if (cleaned.columns === undefined) delete cleaned.columns;
          return {
            ...n,
            data: cleaned,
            width: entityNodeWidth(cleaned, base.width ?? 0),
            height: Math.max(base.height ?? 0, entityNodeHeight(cleaned.columns)),
          };
        }
        if (data.shape !== "class") {
          // members written to a node that is no longer a class (a field
          // committing as an agent's edit turned it into a box) have nowhere
          // to live — dropped like columns off a non-entity, never stored raw
          for (const key of ["stereotype", "isAbstract", "attributes", "methods"] as const) {
            if (key in patch) delete data[key];
          }
          return { ...n, data, ...base };
        }
        // the inspector hands over raw split lines, and an agent can send
        // anything — clean here so nothing unrenderable reaches the store
        const cleaned = {
          ...data,
          stereotype: "stereotype" in patch ? sanitizeStereotype(data.stereotype) : data.stereotype,
          attributes:
            "attributes" in patch ? sanitizeClassMembers(data.attributes) : data.attributes,
          methods: "methods" in patch ? sanitizeClassMembers(data.methods) : data.methods,
        };
        // the box must not end up smaller than the members it now holds
        return {
          ...n,
          data: cleaned,
          width: classNodeWidth(cleaned, base.width ?? 0),
          height: Math.max(base.height ?? 0, classNodeHeight(cleaned)),
        };
      }),
    }));
  },

  updateEdgeData: (id, patch) => {
    get().commit();
    get().updateEdgeDataLive(id, patch);
  },

  updateEdgeDataLive: (id, patch) => {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === id ? { ...e, data: { variant: "solid", arrow: true, ...e.data, ...patch } } : e,
      ),
      lastEdgeStyle: { ...state.lastEdgeStyle, ...pickEdgeStyle(patch) },
    }));
  },

  // Reverse turns the line around: the arrowhead (and any start marker) moves
  // to the other end, while what is written at each end stays where it is.
  // Swapping the markers along with the ends — as this once did — redraws the
  // same picture, so the button looked dead (#204)
  reverseEdge: (id) => {
    get().commit();
    set((state) => ({
      edges: state.edges.map((e) => {
        if (e.id !== id) return e;
        const data = e.data;
        return {
          ...e,
          source: e.target,
          target: e.source,
          sourceHandle: e.targetHandle,
          targetHandle: e.sourceHandle,
          data: data
            ? {
                ...data,
                markerStart: effectiveMarkerStart(data),
                markerEnd: effectiveMarkerEnd(data),
                labelStart: data.labelEnd,
                labelEnd: data.labelStart,
                labelT: data.labelT !== undefined ? 1 - data.labelT : undefined,
                waypoints: data.waypoints ? [...data.waypoints].reverse() : undefined,
              }
            : data,
        };
      }),
    }));
  },

  reconnectEdge: (edgeId, connection) => {
    get().commit();
    const { nodes } = get();
    const source = nodes.find((n) => n.id === connection.source);
    const target = nodes.find((n) => n.id === connection.target);
    const fallback = source && target ? pickHandles(source, target) : null;
    const isBody = (h: string | null | undefined): boolean => !h || h === "body";
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              source: connection.source,
              target: connection.target,
              sourceHandle: isBody(connection.sourceHandle)
                ? fallback?.sourceHandle
                : connection.sourceHandle,
              targetHandle: isBody(connection.targetHandle)
                ? fallback?.targetHandle
                : connection.targetHandle,
              data: e.data ? { ...e.data, waypoints: undefined } : e.data,
            }
          : e,
      ),
    }));
  },

  rewireAnchorToNode: (anchorId, nodeId, handle) => {
    const { nodes } = get();
    const anchor = nodes.find((n) => n.id === anchorId);
    const node = nodes.find((n) => n.id === nodeId);
    if (!anchor || !node || anchor.data.shape !== "anchor" || node.data.shape === "anchor") {
      return;
    }
    get().commit();
    // only the edges this rewire actually touches get leveled — the loop below
    // walks every sequence edge on the lifeline, and moving someone else's
    // found/lost message would break the "existing attachments stay put" rule
    const rewiredIds = new Set(
      get()
        .edges.filter((e) => e.source === anchorId || e.target === anchorId)
        .map((e) => e.id),
    );
    // a line's end on a lifeline faces the line's other end: the side picks
    // which edge of an activation bar it ends on (#210). Both ends — the
    // one put down and the one that stayed, which may now face the other way.
    // The height is kept; a self-message keeps its sides.
    const facing = (
      end: DiagramNode | undefined,
      h: string | null | undefined,
      other: DiagramNode | undefined,
    ) => {
      const side = parseSide(h);
      if (end?.data.shape !== "lifeline" || !h || !other || other.id === end.id) return h;
      if (side !== "left" && side !== "right") return h;
      const toward = nodeBounds(other);
      const at = nodeBounds(end);
      const want = toward.x + toward.width / 2 < at.x + at.width / 2 ? "left" : "right";
      return want === side ? h : `${want}${h.slice(side.length)}`;
    };
    set((state) => {
      const edges = state.edges.map((e) => {
        if (e.source === anchorId) {
          const other = state.nodes.find((n) => n.id === e.target);
          const handles = other ? pickHandles(node, other) : null;
          return {
            ...e,
            source: nodeId,
            sourceHandle: facing(node, handle, other) ?? handles?.sourceHandle ?? "top",
            targetHandle: facing(other, e.targetHandle, node) ?? e.targetHandle,
            data: e.data ? { ...e.data, waypoints: undefined } : e.data,
          };
        }
        if (e.target === anchorId) {
          const other = state.nodes.find((n) => n.id === e.source);
          const handles = other ? pickHandles(other, node) : null;
          return {
            ...e,
            target: nodeId,
            targetHandle: facing(node, handle, other) ?? handles?.targetHandle ?? "top",
            sourceHandle: facing(other, e.sourceHandle, node) ?? e.sourceHandle,
            data: e.data ? { ...e.data, waypoints: undefined } : e.data,
          };
        }
        return e;
      });
      return {
        edges,
        nodes: state.nodes.filter((n) => n.id !== anchorId),
      };
    });
    if (node.data.shape === "lifeline") {
      // snapping the free end of an anchor arrow onto the lifeline's line makes
      // it a found/lost message — normalize to straight and level it with the
      // remaining anchor (both-lifeline rewires keep their existing behavior)
      set((state) => {
        // the anchor has to move with the handle. resnap treats the anchor's y
        // as the truth, so leaving the two disagreeing would (a) render the
        // message tilted right away and (b) let the next resnap pull the handle
        // back down to the anchor — the destroy cap would last one gesture
        const movedAnchors = new Map<string, DiagramNode>();
        const edges = state.edges.map((e) => {
          if (!rewiredIds.has(e.id)) return e;
          if (e.source !== nodeId && e.target !== nodeId) return e;
          if (!isSequenceMessage(e, state.nodes)) return e;
          const otherId = e.source === nodeId ? e.target : e.source;
          const other = state.nodes.find((n) => n.id === otherId);
          if (other?.data.shape !== "anchor") return e;
          const lifeline = state.nodes.find((n) => n.id === nodeId);
          if (!lifeline) return e;
          const ob = nodeBounds(other);
          const lb = nodeBounds(lifeline);
          // a fresh attachment, so the destroy cap applies — mixedMessageHandle
          // only clamps geometrically and is shared with resnap, so cap here
          const y = clampToAttach(lifeline, ob.y + ob.height / 2);
          const h = lifelineHandleAtY(
            lifeline,
            y,
            ob.x + ob.width / 2 < lb.x + lb.width / 2 ? "left" : "right",
          );
          movedAnchors.set(other.id, {
            ...other,
            position: { x: other.position.x, y: y - ob.height / 2 },
          });
          const leveled =
            e.source === nodeId ? { ...e, sourceHandle: h } : { ...e, targetHandle: h };
          return {
            ...leveled,
            data: leveled.data
              ? { ...leveled.data, pathStyle: "straight" as const, waypoints: undefined }
              : leveled.data,
          };
        });
        return {
          edges,
          nodes: state.nodes.map((n) => movedAnchors.get(n.id) ?? n),
        };
      });
    }
  },

  setNodePositionLive: (id, x, y) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, position: { x, y } } : n)),
    }));
  },

  translateNodesLive: (ids, dx, dy) => {
    const idSet = new Set(ids);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        idSet.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
      ),
    }));
  },

  detachEndpointToAnchor: (edgeId, end, pos) => {
    const edge = get().edges.find((e) => e.id === edgeId);
    if (!edge) return null;
    const nodeId = end === "source" ? edge.source : edge.target;
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    if (node.data.shape === "anchor") return node.id; // already free
    get().commit();
    const anchor = createShapeNode("anchor", { x: pos.x - 6, y: pos.y - 6 });
    set((state) => ({
      nodes: [...state.nodes, anchor],
      edges: state.edges.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              ...(end === "source"
                ? { source: anchor.id, sourceHandle: "center" }
                : { target: anchor.id, targetHandle: "center" }),
            }
          : e,
      ),
    }));
    return anchor.id;
  },

  // A lifeline attaches on its centre line below the header, and never below a
  // destroy marker — the rule is that every user-initiated placement respects
  // the cap, and a body drag is one. A box↔lifeline edge isn't a message, so it
  // reaches here rather than the message path.
  slideEdgeLine: (edgeId, to) => {
    set((state) => {
      const edge = state.edges.find((e) => e.id === edgeId);
      if (!edge) return {};
      const source = state.nodes.find((n) => n.id === edge.source);
      const target = state.nodes.find((n) => n.id === edge.target);
      if (!source || !target) return {};
      // from where the line is drawn: an auto end may sit off its handle (#257)
      const ends = drawnEnds(
        edge,
        source,
        target,
        soleOnSide(edge, state.edges),
        routingObstacles(state.nodes),
      );
      const moved = slideSegment([ends.source, ends.target], 0, to);
      const sourceHandle = slidHandle(source, edge.sourceHandle, moved[0]!);
      const targetHandle = slidHandle(target, edge.targetHandle, moved[1]!);
      // an anchor endpoint has no side to slide along — leave the edge alone
      if (!sourceHandle || !targetHandle) return {};
      return {
        edges: state.edges.map((e) =>
          e.id === edgeId
            ? // the line renders straight, so any stored bends are visually
              // spent — keeping them would spring them back on the next drag
              {
                ...e,
                sourceHandle,
                targetHandle,
                data: e.data ? { ...e.data, waypoints: undefined } : e.data,
              }
            : e,
        ),
      };
    });
  },

  setSelfMessageEndYLive: (edgeId, end, y) => {
    set((state) => {
      const edge = state.edges.find((e) => e.id === edgeId);
      if (!edge || edge.source !== edge.target) return {};
      const node = state.nodes.find((n) => n.id === edge.source);
      if (node?.data.shape !== "lifeline") return {};
      const range = lifelineAttachRange(node);
      const y0 = handlePointOnNode(node, edge.sourceHandle).y;
      const y1 = handlePointOnNode(node, edge.targetHandle).y;
      // clampToAttach caps at the destroy marker; the min gap keeps the loop
      // from collapsing onto itself, and the other end never moves
      const wanted = clampToAttach(node, y);
      const handles =
        end === "source"
          ? (() => {
              const top = Math.max(range.min, Math.min(wanted, y1 - SELF_MESSAGE_MIN_GAP));
              return messageHandles(node, node, top, y1 - top);
            })()
          : (() => {
              const bottom = Math.min(Math.max(wanted, y0 + SELF_MESSAGE_MIN_GAP), range.max);
              return messageHandles(node, node, y0, bottom - y0);
            })();
      return { edges: state.edges.map((e) => (e.id === edgeId ? { ...e, ...handles } : e)) };
    });
  },

  setMessageYLive: (edgeId, y) => {
    set((state) => {
      const edge = state.edges.find((e) => e.id === edgeId);
      if (!edge) return {};
      const source = state.nodes.find((n) => n.id === edge.source);
      const target = state.nodes.find((n) => n.id === edge.target);
      if (!source || !target) return {};
      if (source.data.shape === "lifeline" && target.data.shape === "lifeline") {
        let handles: { sourceHandle: string; targetHandle: string };
        if (edge.source === edge.target) {
          // preserve the loop height while moving; the whole loop stays above
          // the destroy marker, so cap by the gap like add_message does
          const y0 = handlePointOnNode(source, edge.sourceHandle).y;
          const y1 = handlePointOnNode(target, edge.targetHandle).y;
          const gap = Math.max(SELF_MESSAGE_MIN_GAP, y1 - y0);
          handles = messageHandles(
            source,
            target,
            Math.min(clampToAttach(source, y), lifelineAttachRange(source).max - gap),
            gap,
          );
        } else {
          handles = messageHandles(source, target, clampToAttach(target, clampToAttach(source, y)));
        }
        return { edges: state.edges.map((e) => (e.id === edgeId ? { ...e, ...handles } : e)) };
      }
      if (!isSequenceMessage(edge, state.nodes)) return {};
      // found/lost message: the anchor and the lifeline handle move together
      const anchor = source.data.shape === "anchor" ? source : target;
      const lifeline = anchor === source ? target : source;
      const range = lifelineAttachRange(lifeline);
      const clamped = Math.min(Math.max(y, range.min), range.max);
      const ab = nodeBounds(anchor);
      const movedAnchor = {
        ...anchor,
        position: { x: anchor.position.x, y: clamped - ab.height / 2 },
      };
      const handle = mixedMessageHandle(lifeline, movedAnchor);
      return {
        nodes: state.nodes.map((n) => (n.id === anchor.id ? movedAnchor : n)),
        edges: state.edges.map((e) =>
          e.id === edgeId
            ? anchor === source
              ? { ...e, targetHandle: handle }
              : { ...e, sourceHandle: handle }
            : e,
        ),
      };
    });
  },

  setActivationLive: (nodeId, index, y0, y1) => {
    // clampActivation propagates NaN, and every path that stores activations is
    // supposed to be sanitized — keep that invariant at the action boundary
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) return;
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId);
      if (node?.data.shape !== "lifeline") return {};
      const acts = node.data.activations;
      if (!acts || index < 0 || index >= acts.length) return {};
      const h = node.height ?? DEFAULT_NODE_SIZE.lifeline.height;
      const clamped = clampActivation(y0, y1, h);
      const next = acts.map((a, i) => (i === index ? clamped : a));
      return {
        nodes: state.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, activations: next } } : n,
        ),
      };
    });
  },

  resnapMessages: (nodeIds) => {
    const moved = new Set(nodeIds);
    set((state) => ({
      edges: state.edges.map((e) => {
        if (!moved.has(e.source) && !moved.has(e.target)) return e;
        const source = state.nodes.find((n) => n.id === e.source);
        const target = state.nodes.find((n) => n.id === e.target);
        if (!source || !target) return e;
        if (source.data.shape === "lifeline" && target.data.shape === "lifeline") {
          // the source endpoint's absolute y is the message's y of truth
          const y = handlePointOnNode(source, e.sourceHandle).y;
          if (e.source === e.target) {
            const y1 = handlePointOnNode(target, e.targetHandle).y;
            return { ...e, ...messageHandles(source, target, y, Math.max(16, y1 - y)) };
          }
          return { ...e, ...messageHandles(source, target, y) };
        }
        if (!isSequenceMessage(e, state.nodes)) return e;
        // found/lost message: the anchor's y is the truth — re-aim the lifeline handle
        const anchor = source.data.shape === "anchor" ? source : target;
        const lifeline = anchor === source ? target : source;
        const handle = mixedMessageHandle(lifeline, anchor);
        return anchor === source ? { ...e, targetHandle: handle } : { ...e, sourceHandle: handle };
      }),
    }));
  },

  alignLifelines: (nodeIds, mode) => {
    const wanted = new Set(nodeIds);
    const targets = get().nodes.filter((n) => wanted.has(n.id) && n.data.shape === "lifeline");
    const patches = mode === "tops" ? alignTops(targets) : distributeEvenly(targets);
    if (patches.length === 0) return;
    get().commit();
    const byId = new Map(patches.map((p) => [p.id, p]));
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const p = byId.get(n.id);
        return p ? { ...n, position: { x: p.x ?? n.position.x, y: p.y ?? n.position.y } } : n;
      }),
    }));
    // moving a lifeline tilts its messages — same rule as a canvas drag
    get().resnapMessages(targets.map((n) => n.id));
    // and can strand slide waypoints on orthogonal box↔lifeline edges (#69)
    const moved = new Set(targets.map((n) => n.id));
    set((state) => ({ edges: pruneSpentWaypoints(state.edges, state.nodes, moved) }));
  },

  setNodeStyleForShape: (nodeId, shape) => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const { style: _stale, ...keep } = n;
        return isBackdrop(shape) ? { ...keep, style: BACKDROP_STYLE } : keep;
      }),
    }));
  },

  setNodesColor: (nodeIds, color) => {
    const wanted = new Set(nodeIds);
    // nothing to change leaves no undo step
    if (!get().nodes.some((n) => wanted.has(n.id) && n.data.color !== color)) return;
    get().commit();
    set((state) => ({
      nodes: state.nodes.map((n) => (wanted.has(n.id) ? { ...n, data: { ...n.data, color } } : n)),
    }));
  },

  setNodeZ: (nodeIds, to) => {
    if (nodeIds.length === 0) return;
    const { nodes } = get();
    const wanted = new Set(nodeIds);
    const targets = nodes.filter((n) => wanted.has(n.id));
    if (targets.length === 0) return;
    const others = nodes.filter((n) => !wanted.has(n.id));
    // already at that end — don't grow z without bound or leave a no-op undo frame
    if (others.length === 0) return;
    const targetZs = targets.map((n) => n.zIndex ?? 0);
    const otherZs = others.map((n) => n.zIndex ?? 0);
    if (to === "front" && Math.min(...targetZs) > Math.max(...otherZs)) return;
    if (to === "back" && Math.max(...targetZs) < Math.min(...otherZs)) return;
    const base = to === "front" ? Math.max(...otherZs) + 1 : Math.min(...otherZs) - targets.length;
    // keep the moved nodes' order relative to each other
    const order = new Map(
      [...targets]
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((n, i) => [n.id, base + i]),
    );
    get().commit();
    set((state) => ({
      nodes: state.nodes.map((n) => {
        const z = order.get(n.id);
        return z === undefined ? n : { ...n, zIndex: z };
      }),
    }));
  },

  autoLayout: (direction, ids) => {
    const arrangement = layoutPositions(get, direction, ids);
    // the toolbar only offers two or more shapes; this guards the store's own contract
    if (arrangement.positions.size < 2) return { moved: 0, reason: "too-few" };
    // pressing Layout twice must not leave a frame whose undo changes nothing
    const planned = planLayout(get, arrangement);
    if (!planned) return { moved: 0, reason: "unchanged" };
    get().commit();
    applyLayout(get, set, arrangement, planned);
    return { moved: arrangement.positions.size, framesAdjusted: arrangement.frames.size };
  },

  deleteElements: (nodeIds, edgeIds) => {
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    get().commit();
    const nodeSet = new Set(nodeIds);
    const edgeSet = new Set(edgeIds);
    set((state) => {
      const edges = state.edges.filter(
        (e) => !edgeSet.has(e.id) && !nodeSet.has(e.source) && !nodeSet.has(e.target),
      );
      return {
        nodes: pruneOrphanAnchors(
          state.nodes.filter((n) => !nodeSet.has(n.id)),
          edges,
        ),
        edges,
      };
    });
  },

  copySelection: () => {
    const { nodes, edges } = get();
    const fragment = collectFragment(nodes, edges);
    // nothing worth holding — leave the previous copy in place rather than
    // clobbering it with an empty one
    if (!fragment) return false;
    set({ clipboard: fragment, pasteCount: 0 });
    return true;
  },

  paste: () => {
    const { clipboard, pasteCount } = get();
    // no buffer — return before commit() so Cmd+Z isn't left an empty frame
    if (!clipboard) return false;
    const repeat = pasteCount + 1;
    const step = PASTE_OFFSET * repeat;
    const fresh = instantiateFragment(clipboard, { dx: step, dy: step });
    get().commit();
    set((state) => ({ ...landFragment(state, fresh), pasteCount: repeat }));
    return true;
  },

  insertFragment: (fragment, delta) => {
    if (fragment.nodes.length === 0) return [];
    const fresh = instantiateFragment(fragment, delta);
    get().commit();
    set((state) => ({
      ...landFragment(state, fresh),
      revealRequest: revealBounds(boxAround(fresh.nodes.map(nodeBounds))),
    }));
    return fresh.nodes.map((n) => n.id);
  },

  cutSelection: () => {
    const { nodes, edges } = get();
    const nodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const edgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    if (nodeIds.length === 0 && edgeIds.length === 0) return false;
    // exactly Cmd+C then Delete. The copy may hold less than the delete removes
    // — a boundary edge is not copyable but still goes when its node does — so
    // the two rules stay separate rather than one constraining the other.
    //
    // When the copy captures nothing the buffer is cleared rather than kept.
    // "an empty copy keeps the buffer" is a rule for a Cmd+C that changed
    // nothing; a cut *did* change the document, and leaving a stale buffer
    // would make the next Cmd+V paste something the user never cut.
    if (!get().copySelection()) set({ clipboard: null, pasteCount: 0 });
    get().deleteElements(nodeIds, edgeIds);
    return true;
  },

  duplicateSelection: () => {
    const { nodes, edges } = get();
    const fragment = collectFragment(nodes, edges);
    if (!fragment) return false;
    const fresh = instantiateFragment(fragment, { dx: PASTE_OFFSET, dy: PASTE_OFFSET });
    get().commit();
    // The offset stays a flat +16: duplicate measures from the *current*
    // selection, which is the previous copy, so repeats cascade on their own.
    //
    // The paste counter still advances, though. Paste measures from the buffer's
    // original instead, so leaving it alone would land Cmd+C → Cmd+D → Cmd+V's
    // copy exactly on top of the duplicate. The buffer's *contents* stay
    // untouched — duplicate never routes through the clipboard.
    set((state) => ({ ...landFragment(state, fresh), pasteCount: get().pasteCount + 1 }));
    return true;
  },

  applyOps: createApplyOps(set, get),

  loadDoc: (doc, filePath) => {
    // Malformed files must surface as a catchable error, not crash the app
    // half-loaded — and nothing changes before the throw. A document with
    // pages was never shipped: it is refused, not migrated (#229 D2)
    if (isMultiPage(doc)) throw new Error(MULTI_PAGE_ERROR);
    const errors = docErrors(doc);
    if (errors.length > 0) {
      throw new Error(`Invalid diagram file: ${errors[0]}`);
    }
    // messages leveled now: handles from a file may encode a tilted one, and
    // levelling on first touch would change the file on a mere click
    set(normalizeDoc(doc.nodes ?? [], doc.edges ?? []));
    resnapAllMessages(get);
    set({
      title: doc.title ?? "Untitled Diagram",
      // history starts over with the document
      past: [],
      future: [],
      filePath,
      // a load is an external file or a blank; a project binds itself right after
      projectId: null,
      // id-keyed state belongs to the document left behind — an open editor,
      // agent highlights (#76); so does a group stepped into (#171)
      touched: {},
      editRequestId: null,
      enteredGroup: null,
      groupResizing: null,
      // the buffer itself survives — pasting across documents is the point —
      // but a fresh document has no copies to cascade past
      pasteCount: 0,
      docVersion: get().docVersion + 1,
      docSession: get().docSession + 1,
      revealRequest: revealRequestFor(get().nodes),
    });
  },

  openProject: (id, doc) => {
    get().loadDoc(doc, null);
    set({ projectId: id });
  },

  // a file that carried `measured` would hand a queued fit-on-open a stale
  // size (#81); load drops it too (normalizeNode)
  toDoc: () => documentFile(get()),

  clearTouched: (before) => {
    set((state) => ({
      touched: Object.fromEntries(Object.entries(state.touched).filter(([, ts]) => ts >= before)),
    }));
  },
});

export const useDiagramStore = create<DiagramState>(diagramState);

/**
 * A throwaway store of the same shape, outside React: a document is read
 * into one before it goes on screen (#218), and a pasted Mermaid diagram is
 * built in one before it lands (#200).
 */
export const scratchDiagramStore = () => createStore(diagramState);
