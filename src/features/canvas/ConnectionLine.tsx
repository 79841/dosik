import { getSmoothStepPath, type ConnectionLineComponentProps, Position } from "@xyflow/react";
import { useEffect, useMemo } from "react";

import { connectionEndShape, DEFAULT_EDGE_WIDTH } from "../../shared/lib/edgeUtils";
import { canvasInk, THEME_COLOR_TOKENS, THEME_EDGE_STROKE } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { pickHandles } from "../../shared/lib/store/nodeFactory";
import { parseSide, type Side } from "../../shared/lib/sideAttach";
import { connectDrag, useCanvasUiStore } from "./canvasUiStore";
import { layoutEdge } from "./edgeLayout";
import { EdgeMarkerDef } from "./edgeMarkers";

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * In-progress connection preview, styled identically to a finished edge
 * (same orthogonal routing, stroke width, arrow head, and remembered style).
 */
export const ConnectionLine = ({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  fromNode,
  fromHandle,
  toNode,
}: ConnectionLineComponentProps) => {
  const lastStyle = useDiagramStore((s) => s.lastEdgeStyle);
  const stroke = lastStyle.color
    ? canvasInk(lastStyle.color, THEME_COLOR_TOKENS)
    : THEME_EDGE_STROKE;
  // the end the line will get — a message's filled arrow between two lifelines,
  // the open chevron otherwise, unless one was chosen (#210 D24)
  const endShape = connectionEndShape(
    lastStyle,
    fromNode?.data?.shape === "lifeline" && toNode?.data?.shape === "lifeline",
  );
  const width = lastStyle.width ?? DEFAULT_EDGE_WIDTH;
  // over a box, the line already ends where the drop would land (#204 D3)
  const landing = useCanvasUiStore((s) => s.snapTarget);
  const landingSide = parseSide(landing?.handle);
  const end =
    landing && landingSide
      ? { x: landing.point.x, y: landing.point.y, position: SIDE_POSITION[landingSide] }
      : { x: toX, y: toY, position: toPosition };

  // Track the drag for lifeline message placement (see connectDrag docs).
  useEffect(() => {
    connectDrag.point = { x: toX, y: toY };
  }, [toX, toY]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: capture only the first from-position per drag
  useEffect(() => {
    if (!connectDrag.start) connectDrag.start = { x: fromX, y: fromY };
    return () => {
      connectDrag.start = null;
      connectDrag.point = null;
    };
  }, []);

  // over a shape the line is the route the connection will take — the same
  // router as the finished line, stub and outline included (#210); out
  // in the open, a plain step line to the pointer
  const nodes = useDiagramStore((s) => s.nodes);
  const fromId = fromNode?.id;
  const fromHandleId = fromHandle?.id ?? null;
  const landingNode = landing?.nodeId;
  const landingHandle = landing?.handle;
  const pathStyle = lastStyle.pathStyle;
  const landed = useMemo(() => {
    const from = nodes.find((n) => n.id === fromId);
    const to = nodes.find((n) => n.id === landingNode);
    if (!from || !to || !landingHandle) return null;
    // a start on a shape's body or a lifeline's strip is placed the way
    // `onConnect` places it — facing the other shape
    const fromBody = !fromHandleId || fromHandleId === "body" || fromHandleId === "line";
    return layoutEdge(
      {
        id: "connection-preview",
        source: from.id,
        target: to.id,
        sourceHandle: fromBody ? pickHandles(from, to).sourceHandle : fromHandleId,
        targetHandle: landingHandle,
        data: { pathStyle },
      },
      nodes,
      { edges: [] },
    );
  }, [nodes, fromId, fromHandleId, landingNode, landingHandle, pathStyle]);
  const [stepPath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: end.x,
    targetY: end.y,
    sourcePosition: fromPosition,
    targetPosition: end.position,
    borderRadius: 6,
    offset: 16,
  });
  const path = landed?.d ?? stepPath;

  return (
    <g>
      <defs>
        <EdgeMarkerDef id="md-connection-arrow" shape={endShape} color={stroke} size="md" />
      </defs>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        markerEnd={endShape === "none" ? undefined : "url(#md-connection-arrow)"}
      />
    </g>
  );
};
