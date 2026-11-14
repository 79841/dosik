import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  ViewportPortal,
  type EdgeProps,
} from "@xyflow/react";
import { useMemo, useRef, useState } from "react";

import {
  middleSegmentIndices,
  polylineProjectT,
  SELF_LOOP_MIN_WIDTH,
  slideSegment,
  stubPoints,
} from "../../shared/lib/edgeGeometry";
import { findSnapTarget } from "../../shared/lib/edgeUtils";
import { THEME_COLOR_TOKENS, THEME_PRIMARY, THEME_EDGE_STROKE } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import type { DiagramEdge, EdgeWaypoint } from "../../shared/lib/types";
import { useCanvasUiStore } from "./canvasUiStore";
import { EdgeMarkerDef } from "./edgeMarkers";
import { edgePaint, edgeSiblings, landedEdge, layoutEdge, routingData } from "./edgeLayout";
import { nearestSegmentIndex } from "./edgeMath";
import { LabelPill } from "./LabelPill";
import { startPointerDrag, type PointerDragHandlers } from "../../shared/lib/pointerDrag";

// the selected line takes the accent (#158), whatever its own colour
const ACTIVE_STROKE = THEME_PRIMARY;
const EDGE_HIT_AREA = 24;

export const LabeledEdge = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  selected,
  data,
}: EdgeProps<DiagramEdge>) => {
  const touchedAt = useDiagramStore((s) => s.touched[id]);
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const editState = useCanvasUiStore((s) =>
    s.edgeLabelEdit?.edgeId === id ? s.edgeLabelEdit : null,
  );
  const setEdgeLabelEdit = useCanvasUiStore((s) => s.setEdgeLabelEdit);
  const { screenToFlowPosition } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [, forceRender] = useState(0);
  const draggingEndpoint = useRef(false);

  const agentTouched = touchedAt !== undefined && Date.now() - touchedAt < 2000;
  const pathStyle = data?.pathStyle ?? "orthogonal";
  const waypoints = useMemo(() => data?.waypoints ?? [], [data?.waypoints]);
  const isSelfLoop = source === target;

  const drag = (e: React.PointerEvent, handlers: PointerDragHandlers): void => {
    startPointerDrag(e, screenToFlowPosition, handlers);
  };

  // One layout for the canvas and the windowless SVG export — see `edgeLayout`
  // (#148). Two memos, as before the move: the sibling numbers follow every
  // edge change (cheap), and routing follows only this edge's own path fields
  // and those numbers — a drag on another edge's label must not reroute this
  // one (#152). The measured `sourceX/sourceY` only stand in while an
  // endpoint node is missing from the store.
  const siblings = useMemo(
    () =>
      edgeSiblings(
        { id, source, target, sourceHandle: sourceHandleId, targetHandle: targetHandleId },
        nodes,
        edges,
      ),
    [id, source, target, sourceHandleId, targetHandleId, nodes, edges],
  );
  const { parallelOffset, selfLoopIndex } = siblings;
  const selfLoopWidth = data?.selfLoopWidth;
  const labelT = data?.labelT;
  // an end of this line dragged onto a shape: draw the line it lands as, not one
  // run to the free end along the shape's face (#210)
  // (selected per edge: a snap for another line's drag re-renders nothing here)
  const ownSnap = (s: { snapFor: string | null }) =>
    s.snapFor !== null && (s.snapFor === source || s.snapFor === target);
  const landingAnchor = useCanvasUiStore((s) => (ownSnap(s) ? s.snapFor : null));
  const snapNode = useCanvasUiStore((s) => (ownSnap(s) ? s.snapTarget?.nodeId : undefined));
  const snapHandle = useCanvasUiStore((s) => (ownSnap(s) ? s.snapTarget?.handle : undefined));
  const layout = useMemo(() => {
    const routed = {
      id,
      source,
      target,
      sourceHandle: sourceHandleId,
      targetHandle: targetHandleId,
      data: routingData({ pathStyle, waypoints, selfLoopWidth, labelT }),
    };
    return layoutEdge(
      landingAnchor && snapNode && snapHandle
        ? landedEdge(routed, landingAnchor, { nodeId: snapNode, handle: snapHandle })
        : routed,
      nodes,
      {
        siblings: { parallelOffset, selfLoopIndex },
        fallback: {
          source: { x: sourceX, y: sourceY, position: sourcePosition },
          target: { x: targetX, y: targetY, position: targetPosition },
        },
      },
    );
  }, [
    id,
    source,
    target,
    sourceHandleId,
    targetHandleId,
    pathStyle,
    waypoints,
    selfLoopWidth,
    labelT,
    nodes,
    parallelOffset,
    selfLoopIndex,
    landingAnchor,
    snapNode,
    snapHandle,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  ]);
  // cannot happen while a fallback is passed; if it ever does, draw nothing
  // rather than let a cast carry a null into `layout.d` (#152). No hook
  // follows this line, so the early return keeps the hook order.
  if (!layout) return null;
  const { endpoints, endpointBounds, isMessage, isFreeArrow, sourceIsAnchor, targetIsAnchor } =
    layout;
  const built = { d: layout.d, points: layout.points };
  /**
   * The line as the drag gestures see it. A curve with no bends of its own is
   * drawn from many samples (#204), but it has no segments to slide — only its
   * two ends, so a body drag moves the whole line, as it did when a curve was
   * three points.
   */
  const chain =
    pathStyle === "curved" && waypoints.length === 0
      ? [built.points[0]!, built.points[built.points.length - 1]!]
      : built.points;

  const paint = edgePaint(data, { tokens: THEME_COLOR_TOKENS, stroke: THEME_EDGE_STROKE });
  const { strokeWidth, opacity, animated, markerSize, dasharray } = paint;
  const active = selected === true || agentTouched;
  const stroke = active ? ACTIVE_STROKE : paint.stroke;
  const labelColor = paint.labelColor;
  const markerStartShape = paint.markerStart;
  const markerEndShape = paint.markerEnd;
  const msId = `${id}-ms`;
  const meId = `${id}-me`;

  const setWaypoints = (next: EdgeWaypoint[]): void =>
    useDiagramStore.getState().updateEdgeDataLive(id, { waypoints: next });

  /**
   * Dragging the edge body: messages move vertically (staying horizontal),
   * free arrows move whole, connected edges slide a segment or move whole.
   */
  const onBodyPointerDown = (e: React.PointerEvent): void => {
    if (isMessage) {
      drag(e, {
        onStart: () => useDiagramStore.getState().commit(),
        onMove: (p) => useDiagramStore.getState().setMessageYLive(id, p.y),
      });
      return;
    }
    if (isSelfLoop) return;
    if (isFreeArrow) {
      drag(e, {
        onStart: () => useDiagramStore.getState().commit(),
        onMove: (_p, { dx, dy }) => {
          const store = useDiagramStore.getState();
          store.translateNodesLive([source, target], dx, dy);
          const wps = store.edges.find((edge) => edge.id === id)?.data?.waypoints;
          if (wps?.length) {
            store.updateEdgeDataLive(id, {
              waypoints: wps.map((w) => ({ x: w.x + dx, y: w.y + dy })),
            });
          }
        },
      });
      return;
    }
    startSegmentDrag(e, null);
  };

  /**
   * True when the line has no bend to grab, so the gesture moves it whole.
   *
   * Point count alone can't decide this: curved edges and parallel siblings get
   * a synthetic midpoint from the router, rendering 3 points with no real bend.
   * Judging by that made them answer to neither branch — no grips, no drag.
   * The last clause catches user bends that have collapsed onto the straight
   * line, which the router draws as 2 points.
   */
  const movesWholeLine =
    middleSegmentIndices(chain).length === 0 && (waypoints.length === 0 || chain.length === 2);

  /**
   * Slides one segment of the rendered polyline. The chain is frozen at drag
   * start so every move is computed from the same shape — recomputing off the
   * live path would let rounding feed back into the next frame.
   *
   * A segment holding an endpoint can't bend, so an unbent line moves whole
   * (both attachments slide along their fixed sides) and an end segment of a
   * bent line is inert. The bend count never changes either way.
   *
   * `index` is null for a body drag, which picks the segment under the pointer;
   * a grip passes its own index.
   */
  const startSegmentDrag = (e: React.PointerEvent, index: number | null): void => {
    const frozen = chain;
    // frozen with the chain: the slide may not push a segment inside these,
    // which would make the line double back over itself (#53). Stubs are an
    // orthogonal-routing notion — straight/curved draw waypoints verbatim, so
    // clamping there would stop the drag at a line nothing renders.
    const stubEnds =
      pathStyle === "orthogonal"
        ? stubPoints(endpoints.source, endpoints.target, endpoints.stubs, endpointBounds)
        : undefined;
    let seg = index ?? -1;
    drag(e, {
      onStart: (p) => {
        if (index === null) seg = nearestSegmentIndex(frozen, p);
        if (movesWholeLine) {
          // an anchor end has no side to slide along, so nothing would happen —
          // committing anyway would leave an undo frame that changes nothing
          if (sourceIsAnchor || targetIsAnchor) {
            seg = -1;
            return;
          }
        } else if (!middleSegmentIndices(frozen).includes(seg)) {
          seg = -1;
          return;
        }
        useDiagramStore.getState().commit();
      },
      onMove: (p) => {
        if (seg < 0) return;
        if (movesWholeLine) {
          useDiagramStore.getState().slideEdgeLine(id, p);
          return;
        }
        setWaypoints(slideSegment(frozen, seg, p, stubEnds).slice(1, -1));
      },
    });
  };

  /**
   * Dragging an endpoint: detach to a free anchor; near a box, the box shows
   * its connection points and the endpoint snaps magnetically to the nearest
   * one — release to attach there.
   */
  const onEndpointPointerDown = (e: React.PointerEvent, end: "source" | "target"): void => {
    e.stopPropagation();
    let anchorId: string | null = null;
    const setSnapTarget = useCanvasUiStore.getState().setSnapTarget;
    // the end being dragged faces the line's other end on a lifeline (#210)
    const otherEnd = end === "source" ? endpoints.target : endpoints.source;
    drag(e, {
      onStart: (p) => {
        draggingEndpoint.current = true;
        const store = useDiagramStore.getState();
        const nodeId = end === "source" ? source : target;
        const node = store.nodes.find((n) => n.id === nodeId);
        if (node?.data.shape === "anchor") {
          store.commit();
          anchorId = node.id;
          store.setNodePositionLive(node.id, p.x - 6, p.y - 6);
        } else {
          anchorId = store.detachEndpointToAnchor(id, end, p);
        }
      },
      onMove: (p) => {
        if (!anchorId) return;
        const store = useDiagramStore.getState();
        const snap = findSnapTarget(store.nodes, p, [anchorId], undefined, otherEnd);
        setSnapTarget(snap, anchorId);
        // magnetic: sit on the connection point while in range
        const pos = snap ? snap.point : p;
        store.setNodePositionLive(anchorId, pos.x - 6, pos.y - 6);
      },
      onEnd: (p) => {
        draggingEndpoint.current = false;
        setSnapTarget(null);
        if (!anchorId) return;
        const store = useDiagramStore.getState();
        const snap = findSnapTarget(store.nodes, p, [anchorId], undefined, otherEnd);
        if (snap) store.rewireAnchorToNode(anchorId, snap.nodeId, snap.handle);
      },
    });
  };

  // label anchor points
  const centerPoint = layout.labelPoints.center;
  const startPoint = layout.labelPoints.start;
  const endPoint = layout.labelPoints.end;
  const tipStart = built.points[0]!;
  const tipEnd = built.points[built.points.length - 1]!;

  const labelKey = (which: "center" | "start" | "end") =>
    which === "center" ? "label" : which === "start" ? "labelStart" : "labelEnd";
  const commitLabel = (which: "center" | "start" | "end", value: string): void => {
    useDiagramStore.getState().updateEdgeData(id, { [labelKey(which)]: value.trim() || undefined });
    setEdgeLabelEdit(null);
    forceRender((v) => v + 1);
  };
  /** Save's write (#219): the text so far, the editor stays open */
  const writeLabel = (which: "center" | "start" | "end", value: string): void => {
    const key = labelKey(which);
    const next = value.trim() || undefined;
    const edge = useDiagramStore.getState().edges.find((e) => e.id === id);
    if (edge && edge.data?.[key] !== next) {
      useDiagramStore.getState().updateEdgeData(id, { [key]: next });
    }
  };

  // while a label is being edited the handles would overlap the input —
  // hide them until the edit commits (#74)
  const editingLabel = editState !== null;
  const showEndpoints =
    (hovered || selected === true) && !draggingEndpoint.current && !editingLabel;

  /**
   * The grips on the line's two ends (#204 D15). They ride `ViewportPortal`,
   * above the nodes: drawn in the edge layer, half of each sat under its box,
   * and an end at a side's middle sat under that side's connection dot, so a
   * press there started a new line instead of moving this one. The grip is a
   * 12px ring in a 22px target. Free ends already have the anchor dot itself
   * as their grip — a second ring there would duplicate it.
   */
  const endGrips = showEndpoints
    ? (["source", "target"] as const).filter((end) =>
        end === "source" ? !sourceIsAnchor : !targetIsAnchor,
      )
    : [];

  /**
   * The three label anchors, in one shape so the editor can be split out of
   * the layer the other two render into (see `ViewportPortal` below).
   */
  const slots = (
    [
      { which: "center", point: centerPoint, text: data?.label ?? "", draggable: true },
      { which: "start", point: startPoint, text: data?.labelStart ?? "", draggable: false },
      { which: "end", point: endPoint, text: data?.labelEnd ?? "", draggable: false },
    ] as const
  )
    .map((slot) => ({ ...slot, editing: editState?.which === slot.which }))
    .filter((slot) => slot.text || slot.editing);
  /**
   * A self-message's whole edge is lifted over its lifeline (`canvasLifts`,
   * #99), and its label has to travel with it. Left in `EdgeLabelRenderer` the
   * pill stays in the layer isolated *behind* the nodes, so the lifted line
   * paints straight over its own text. `ViewportPortal` is not isolated, so the
   * pill's `z-30` reaches the viewport's stacking context and clears the edge.
   */
  const isSelfMessage = isSelfLoop && isMessage;
  const portalSlots = slots.filter((slot) => slot.editing || isSelfMessage);

  /**
   * Midpoint of the loop's outer leg — the only draggable part of a
   * self-message. The chain is [attach, out, out, attach], so a 4-point shape
   * is what tells us the loop actually rendered.
   */
  const selfLoopGrip =
    isSelfMessage && selected && !editingLabel && built.points.length === 4
      ? {
          /** outer leg midpoint — drag sideways for the loop's reach */
          width: { x: built.points[1]!.x, y: (built.points[1]!.y + built.points[2]!.y) / 2 },
          /**
           * The two horizontal legs, each dragged vertically to move its own
           * end. Height needs a target of its own: the legs are part of the
           * body stroke, and body drag already means "move the whole loop"
           * (`setMessageYLive` keeps the height while moving). A grip sits on
           * top of the line and takes the pointer first, which is how segment
           * slides already share a stroke with body drag (#43).
           */
          ends: [
            {
              end: "source" as const,
              x: (built.points[0]!.x + built.points[1]!.x) / 2,
              y: built.points[0]!.y,
            },
            {
              end: "target" as const,
              x: (built.points[2]!.x + built.points[3]!.x) / 2,
              y: built.points[3]!.y,
            },
          ],
        }
      : null;

  const renderPill = (slot: (typeof slots)[number]) => (
    <LabelPill
      key={slot.which}
      point={slot.point}
      text={slot.text}
      color={labelColor}
      editing={slot.editing}
      draggable={slot.draggable}
      onStartDrag={
        slot.draggable
          ? (e) =>
              drag(e, {
                onStart: () => useDiagramStore.getState().commit(),
                onMove: (p) =>
                  useDiagramStore
                    .getState()
                    .updateEdgeDataLive(id, { labelT: polylineProjectT(built.points, p) }),
              })
          : undefined
      }
      onDoubleClick={() => setEdgeLabelEdit({ edgeId: id, which: slot.which })}
      onCommitText={(text) => commitLabel(slot.which, text)}
      onWriteText={(text) => writeLabel(slot.which, text)}
    />
  );

  /**
   * Drags the loop's outer leg sideways to set how far the loop reaches (#99).
   *
   * The default reach is a constant, so a self-message could never be widened —
   * and it is the one edge shape where that matters, because the loop has to
   * clear its own label. `selfLoopWidth` is measured from the attachment point
   * outward, so it does not care which side the handles sit on.
   */
  const startSelfLoopResize = (e: React.PointerEvent): void => {
    // the attachment point, not the drawn start: on an activation bar the line
    // starts at the bar's edge, but the width is measured from the line (#210)
    const base = endpoints.source;
    const outer = built.points[1];
    if (!base || !outer) return;
    const outward = Math.sign(outer.x - base.x) || 1;
    drag(e, {
      onStart: () => useDiagramStore.getState().commit(),
      onMove: (p) =>
        useDiagramStore.getState().updateEdgeDataLive(id, {
          selfLoopWidth: Math.max(SELF_LOOP_MIN_WIDTH, (p.x - base.x) * outward),
        }),
    });
  };

  /** Drags one end of the loop vertically — the other end stays put (#99). */
  const startSelfLoopEndDrag = (e: React.PointerEvent, end: "source" | "target"): void =>
    drag(e, {
      onStart: () => useDiagramStore.getState().commit(),
      onMove: (p) => useDiagramStore.getState().setSelfMessageEndYLive(id, end, p.y),
    });

  return (
    <>
      <defs>
        <EdgeMarkerDef id={msId} shape={markerStartShape} color={stroke} size={markerSize} />
        <EdgeMarkerDef id={meId} shape={markerEndShape} color={stroke} size={markerSize} />
      </defs>
      {selected ? (
        // the line's own colour is the ink now, so the accent alone no longer
        // tells a selected line apart — a soft halo does (#210 D9). Canvas only.
        <path
          className="edge-halo"
          d={built.d}
          fill="none"
          stroke={ACTIVE_STROKE}
          strokeOpacity={0.18}
          strokeWidth={strokeWidth + 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      ) : null}
      <BaseEdge
        id={id}
        path={built.d}
        interactionWidth={0}
        markerStart={markerStartShape !== "none" ? `url(#${msId})` : undefined}
        markerEnd={markerEndShape !== "none" ? `url(#${meId})` : undefined}
        style={{
          stroke,
          strokeWidth: active ? strokeWidth + 0.5 : strokeWidth,
          strokeDasharray: dasharray,
          strokeLinecap: paint.linecap,
          opacity,
          animation: animated ? "md-dash 0.5s linear infinite" : undefined,
        }}
      />
      {/* wide interaction stroke: click selects (bubbles to RF), drag moves/bends */}
      <path
        d={built.d}
        fill="none"
        stroke="transparent"
        strokeWidth={EDGE_HIT_AREA}
        style={{
          pointerEvents: "stroke",
          // The body always *moves* what it grabs, so it gets the move cursor —
          // resize cursors belong to the grips that change a shape (loop width
          // and height, #99). A message used to show `ns-resize` here, which
          // read identically to the height grips sitting on the same line.
          cursor:
            isMessage || isFreeArrow || (movesWholeLine && !sourceIsAnchor && !targetIsAnchor)
              ? "move"
              : "pointer",
        }}
        onPointerDown={onBodyPointerDown}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        {slots.map((slot) => (portalSlots.includes(slot) ? null : renderPill(slot)))}

        {/* One grip per middle segment, pinned to its midpoint — the user can't
            add or remove them; the line's shape decides how many there are.
            Not drawn (user, 2026-10-26): it still takes the pointer and shows
            its cursor, and dragging the line's body slides a segment anyway. */}
        {selected && !editingLabel && !isSelfLoop && !isMessage && !isFreeArrow
          ? middleSegmentIndices(chain).map((i) => {
              const a = chain[i]!;
              const b = chain[i + 1]!;
              const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
              return (
                <div
                  key={`seg-${i}`}
                  className={`nodrag nopan absolute z-20 ${
                    vertical ? "h-5 w-2 cursor-ew-resize" : "h-2 w-5 cursor-ns-resize"
                  }`}
                  style={{
                    transform: `translate(-50%, -50%) translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2}px)`,
                    pointerEvents: "all",
                  }}
                  title="Drag to move this segment"
                  onPointerDown={(e) => startSegmentDrag(e, i)}
                />
              );
            })
          : null}
      </EdgeLabelRenderer>

      {/* The pill being edited renders one layer up. `EdgeLabelRenderer` sits
          before the nodes in the viewport's DOM and is isolated to keep it
          there (#91), so an editor opened on a label that a box covers would be
          focused but invisible — and two of the three ways in (double-clicking
          the line, the context menu's "Edit label") never needed the pill to be
          visible in the first place. `ViewportPortal` renders after the nodes,
          which puts the editor on top of them. A static label otherwise stays
          behind the boxes, which is the whole point of #91 — the one standing
          exception is a self-message, whose line is lifted too (#93, #99). */}
      {portalSlots.length > 0 || selfLoopGrip || endGrips.length > 0 ? (
        <ViewportPortal>
          {portalSlots.map(renderPill)}
          {/* each end's grip: not drawn (user, 2026-10-26) — the 22px spot
              still takes the pointer, shows the grab cursor and drags the end */}
          {endGrips.map((end) => {
            const tip = end === "source" ? tipStart : tipEnd;
            return (
              <div
                key={end}
                data-line-end={end}
                className="nodrag nopan absolute z-30 h-[22px] w-[22px] cursor-grab"
                style={{
                  transform: `translate(-50%, -50%) translate(${tip.x}px, ${tip.y}px)`,
                  pointerEvents: "all",
                }}
                onPointerDown={(e) => onEndpointPointerDown(e, end)}
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
              />
            );
          })}
          {/* The reach handle rides the portal for the same reason the label
              does: the loop is lifted over its lifeline, and a grip left in the
              isolated label layer would sit behind the column — unreachable,
              which is the whole of #99. Not drawn, as a line's other grips
              (user, 2026-10-26): the cursor shows where to drag. */}
          {selfLoopGrip ? (
            <>
              <div
                className="nodrag nopan absolute z-30 h-5 w-2 cursor-ew-resize"
                style={{
                  transform: `translate(-50%, -50%) translate(${selfLoopGrip.width.x}px, ${selfLoopGrip.width.y}px)`,
                  pointerEvents: "all",
                }}
                title="Drag to widen the loop"
                onPointerDown={startSelfLoopResize}
              />
              {selfLoopGrip.ends.map((grip) => (
                <div
                  key={grip.end}
                  className="nodrag nopan absolute z-30 h-2 w-5 cursor-ns-resize"
                  style={{
                    transform: `translate(-50%, -50%) translate(${grip.x}px, ${grip.y}px)`,
                    pointerEvents: "all",
                  }}
                  title="Drag to change the loop height"
                  onPointerDown={(e) => startSelfLoopEndDrag(e, grip.end)}
                />
              ))}
            </>
          ) : null}
        </ViewportPortal>
      ) : null}
    </>
  );
};
