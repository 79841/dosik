import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import {
  connectionEndShape,
  DEFAULT_EDGE_WIDTH,
  findSnapTarget,
  type SnapTarget,
} from "../../shared/lib/edgeUtils";
import { canvasInk, THEME_COLOR_TOKENS, THEME_EDGE_STROKE } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import { NOTICE_BOTTOM } from "../../shared/ui/Toaster";
import { useCanvasUiStore } from "./canvasUiStore";
import { EdgeMarkerDef } from "./edgeMarkers";

interface Point {
  x: number;
  y: number;
}

/** one end of the arrow being drawn: where it shows, and the shape it lands on */
interface DrawEnd {
  /** overlay-local screen point — the landing spot when snapped */
  at: Point;
  /** where the pointer really is, for the store */
  client: Point;
  snap: SnapTarget | null;
}

/**
 * Full-canvas overlay for the arrow draw tool: drag anywhere to draw an
 * arrow. An end within 32px of a shape lands on it, at the nearest side's
 * spot under the pointer — the same rule as dragging a line's end, and the
 * same `findSnapTarget` the store's `drawArrow` uses, so what shows is what
 * is made (#204 D17). The spot shows as a dot from hover on; an end out in
 * the open shows as a small hollow ring — a free arrow end. Esc exits.
 */
export const ArrowDrawOverlay = () => {
  const arrowMode = useCanvasUiStore((s) => s.arrowMode);
  const setArrowMode = useCanvasUiStore((s) => s.setArrowMode);
  const lastStyle = useDiagramStore((s) => s.lastEdgeStyle);
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const [start, setStart] = useState<DrawEnd | null>(null);
  const [pointer, setPointer] = useState<DrawEnd | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!arrowMode) return;
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setArrowMode(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [arrowMode, setArrowMode]);

  if (!arrowMode) return null;

  const stroke = lastStyle.color
    ? canvasInk(lastStyle.color, THEME_COLOR_TOKENS)
    : THEME_EDGE_STROKE;
  // the end the line will get — a message's filled arrow between two lifelines,
  // the open chevron otherwise, unless one was chosen (#210 D24)
  const onLifeline = (end: DrawEnd | null) =>
    end?.snap != null &&
    useDiagramStore.getState().nodes.find((n) => n.id === end.snap?.nodeId)?.data.shape ===
      "lifeline";
  const endShape = connectionEndShape(lastStyle, onLifeline(start) && onLifeline(pointer));
  const endAt = (clientX: number, clientY: number): DrawEnd => {
    const rect = ref.current?.getBoundingClientRect();
    // the end being drawn faces the start, as `drawArrow` will attach it
    const snap = findSnapTarget(
      useDiagramStore.getState().nodes,
      screenToFlowPosition({ x: clientX, y: clientY }),
      [],
      undefined,
      start ? screenToFlowPosition(start.client) : undefined,
    );
    const screen = snap ? flowToScreenPosition(snap.point) : { x: clientX, y: clientY };
    return {
      at: { x: screen.x - (rect?.left ?? 0), y: screen.y - (rect?.top ?? 0) },
      client: { x: clientX, y: clientY },
      snap,
    };
  };
  const marks = start ? [start, pointer] : [pointer];

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30 cursor-crosshair"
      onPointerDown={(e) => {
        e.preventDefault();
        const here = endAt(e.clientX, e.clientY);
        setStart(here);
        setPointer(here);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => setPointer(endAt(e.clientX, e.clientY))}
      onPointerLeave={() => {
        if (!start) setPointer(null);
      }}
      onPointerUp={(e) => {
        if (!start) return;
        useDiagramStore
          .getState()
          .drawArrow(
            screenToFlowPosition(start.client),
            screenToFlowPosition({ x: e.clientX, y: e.clientY }),
          );
        setStart(null);
        if (!e.shiftKey) setArrowMode(false);
      }}
    >
      <svg className="h-full w-full">
        <defs>
          <EdgeMarkerDef id="md-draw-arrow" shape={endShape} color={stroke} size="md" />
        </defs>
        {start && pointer ? (
          <line
            x1={start.at.x}
            y1={start.at.y}
            x2={pointer.at.x}
            y2={pointer.at.y}
            stroke={stroke}
            strokeWidth={lastStyle.width ?? DEFAULT_EDGE_WIDTH}
            markerEnd={endShape === "none" ? undefined : "url(#md-draw-arrow)"}
          />
        ) : null}
        {marks.map((end, i) =>
          !end ? null : end.snap ? (
            // lands on a shape: the same dot the line-end drag shows
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: start and pointer, fixed order
              key={i}
              cx={end.at.x}
              cy={end.at.y}
              r={7}
              strokeWidth={2}
              className="fill-surface stroke-primary"
            />
          ) : (
            // out in the open: a free arrow end
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: start and pointer, fixed order
              key={i}
              cx={end.at.x}
              cy={end.at.y}
              r={4}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
            />
          ),
        )}
      </svg>
      {/* bottom centre, where notices go — at the top it covered the toolbar
          (#204). It rests on the row above the editor's bottom islands, and
          over a raised edit bar, the way toasts do (#231 D18) */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-ink-surface/90 px-3.5 py-1.5 text-[11.5px] font-medium text-surface shadow-popover"
        style={{ bottom: NOTICE_BOTTOM }}
      >
        Drag to draw an arrow · Shift keeps the tool · Esc to exit
      </div>
    </div>
  );
};
