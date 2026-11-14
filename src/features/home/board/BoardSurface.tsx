import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePointerDrag } from "../../../shared/lib/pointerDrag";
import { isMacPlatform } from "../../../shared/lib/windowChrome";
import { NO_SCROLL, unscroll } from "./boardParts";
import { useBoardStore } from "./boardStore";
import {
  applyWheel,
  DEFAULT_ZOOM,
  THUMB_MIN_ZOOM,
  type Viewport,
  type WheelLike,
  zoomAt,
} from "./boardViewport";

/** what a press starts on without panning the board: its items, the islands, controls */
export const NOT_EMPTY =
  "[data-board-item], [data-board-island], button, input, textarea, a, [role=menu], [role=dialog]";

/** `will-change` comes off this long after the board stops, so WebKit redraws text sharp (D19 ⑤) */
export const SETTLE_MS = 150;

const RESTING: Viewport = { x: 0, y: 0, zoom: DEFAULT_ZOOM };

/** WebKit's GestureEvent: `scale` runs from 1 at gesturestart; the pointer in client space */
type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number };

/**
 * The library board's surface (#221 D3, D10, D19): the dot grid in screen
 * space and one transformed layer in board space — frames and cards go in
 * `children`. Wheel and pinch go through `applyWheel` once per animation
 * frame (a non-passive listener, so the page itself never scrolls or
 * zooms). A trackpad pinch in WebKit is a GestureEvent first, and its
 * default is blocked (no page zoom). The editor's React Flow, which blocks
 * nothing, zooms by the ctrl-wheel WebKit makes of it; the board, which
 * blocks it, did not zoom well in the app (#236 verification) — so the board
 * zooms by the gesture's own `scale` (the zoom at gesturestart times it,
 * about the pointer) and drops a ctrl-wheel that comes during the gesture
 * anyway, so a pinch never counts twice. Dragging empty space or a frame's
 * body pans, the middle button pans from anywhere. `will-change` is on only while it moves; a move the
 * program makes (a focus, Fit, the buttons) glides. Only this subscribes to
 * the camera — the frames inside do not draw again when it moves.
 */
export const BoardSurface = ({
  children,
  onEmptyContextMenu,
}: {
  children: ReactNode;
  /** a right-click on empty board, at this client point */
  onEmptyContextMenu?: (client: { x: number; y: number }) => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useBoardStore((s) => s.viewport) ?? RESTING;
  const animate = useBoardStore((s) => s.animate);
  const [moving, setMoving] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** a pan — dropped, window listeners and all, if the surface goes mid-pan */
  const startPan = usePointerDrag();

  const moved = useCallback(() => {
    setMoving(true);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setMoving(false), SETTLE_MS);
  }, []);
  useEffect(() => () => clearTimeout(settle.current), []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const mac = isMacPlatform();
    const pending: WheelLike[] = [];
    /** the zoom a pinch under way started from — null while none is */
    let pinchFrom: number | null = null;
    /** where the last gesturechange put the zoom, for the next frame */
    let pinchTo: { x: number; y: number; zoom: number } | null = null;
    let frame = 0;
    const flush = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const board = useBoardStore.getState();
        let next = board.viewport ?? RESTING;
        if (pinchTo) {
          next = zoomAt(next, pinchTo, pinchTo.zoom);
          pinchTo = null;
        }
        for (const w of pending.splice(0)) next = applyWheel(next, w, mac);
        board.setViewport(next);
        moved();
      });
    };
    const onWheel = (e: WheelEvent) => {
      // the page must neither scroll nor zoom (a pinch is a ctrl-wheel)
      e.preventDefault();
      // the gesture already zooms by its scale
      if (pinchFrom !== null && e.ctrlKey) return;
      const box = el.getBoundingClientRect();
      pending.push({
        x: e.clientX - box.left,
        y: e.clientY - box.top,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
      flush();
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      pinchFrom = (useBoardStore.getState().viewport ?? RESTING).zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const { scale, clientX, clientY } = e as GestureLike;
      if (pinchFrom === null || typeof scale !== "number" || !Number.isFinite(scale)) return;
      const box = el.getBoundingClientRect();
      // no pointer given: the board's centre
      const pointer = typeof clientX === "number" && typeof clientY === "number";
      pinchTo = {
        x: pointer ? clientX - box.left : box.width / 2,
        y: pointer ? clientY - box.top : box.height / 2,
        zoom: pinchFrom * scale,
      };
      flush();
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      pinchFrom = null;
    };
    // a gestureend lost to the window losing focus must not hold off the ctrl-wheel
    const onBlur = () => {
      pinchFrom = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    window.addEventListener("blur", onBlur);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
      window.removeEventListener("blur", onBlur);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [moved]);

  const onPointerDown = (e: React.PointerEvent) => {
    const middle = e.button === 1;
    if (!middle && (e.button !== 0 || (e.target as Element).closest(NOT_EMPTY))) return;
    // the middle button would start the browser's autoscroll
    if (middle) e.preventDefault();
    startPan(
      e,
      (p) => p,
      {
        onMove: (_p, d) => {
          const board = useBoardStore.getState();
          const now = board.viewport ?? RESTING;
          board.setViewport({ ...now, x: now.x + d.dx, y: now.y + d.dy });
          moved();
        },
        // Escape, pointercancel or the window losing focus end it — the pointer
        // may have let go where this window never heard (#221); the
        // board stays where the pan left it
        onCancel: () => undefined,
      },
      { buttons: [e.button] },
    );
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if ((e.target as Element).closest(NOT_EMPTY)) return;
    e.preventDefault();
    onEmptyContextMenu?.({ x: e.clientX, y: e.clientY });
  };

  const grid = viewport.zoom >= THUMB_MIN_ZOOM;
  const gridAt = {
    "--grid-x": `${viewport.x}px`,
    "--grid-y": `${viewport.y}px`,
    "--grid-size": `${20 * viewport.zoom}px`,
  } as CSSProperties;

  return (
    // panning is the pointer's; the keyboard moves through the items instead (D20)
    <div
      ref={root}
      data-board-surface=""
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      // never a scroll box — focus cannot shift the board (#221)
      onScroll={unscroll}
      style={gridAt}
      className={`absolute inset-0 touch-none ${NO_SCROLL} bg-surface select-none ${
        grid
          ? "bg-[radial-gradient(var(--dot)_1px,transparent_1.2px)] bg-[length:var(--grid-size)_var(--grid-size)] bg-[position:var(--grid-x)_var(--grid-y)]"
          : ""
      }`}
    >
      <div
        data-board-layer=""
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
        className={`absolute top-0 left-0 origin-top-left ${moving ? "will-change-transform" : ""} ${
          animate
            ? "motion-safe:transition-transform motion-safe:duration-240 motion-safe:ease-out"
            : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
};
