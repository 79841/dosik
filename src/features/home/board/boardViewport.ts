/**
 * The library canvas's camera (#221 D10–D12, D20) — pure arithmetic. A board
 * point `b` shows at `b × zoom + (x, y)` in the board's own box (its
 * top-left is 0, 0). The wheel and pinch numbers are React Flow's
 * (`@xyflow/system` 0.0.82 `wheelDelta`, `createPanOnScrollHandler`, the
 * default `panOnScrollSpeed`), so the board's hand matches the editor's.
 */

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Point = { x: number; y: number };

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
/** the board as the design drew it (Hybrid-Home-Canvas is at 70%) */
export const DEFAULT_ZOOM = 0.7;
/** one press of − or + — the editor's zoom island step */
export const ZOOM_STEP = 1.2;
/** below this no new thumbnail is drawn, and the dot grid goes (D19) */
export const THUMB_MIN_ZOOM = 0.4;
/**
 * The room kept clear at the board's edges: what fits and what is revealed
 * stays off them — 60 at the bottom for the hint pill and the zoom island,
 * 24 elsewhere (the top islands went to Home's header row, #231 D12).
 */
export const INSETS = { top: 24, bottom: 60, left: 24, right: 24 } as const;
/** room around a focused frame or diagram (D11, D12) — what its fit counts in the zoom */
export const FOCUS_PAD = 48;
/**
 * How far below the board's top a fit hangs what it shows (#231 D12): the
 * canvas does not centre the board's content down the view — the whole
 * library's topmost frame sits 36 below the board's top
 * (`Hybrid-Home-Canvas`), a focused frame 48 (`Hybrid-Folder-Canvas`).
 */
export const FIT_TOP = { board: 36, focus: 48 } as const;

/** React Flow's `panOnScrollSpeed` default */
const PAN_SPEED = 0.5;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const toWorld = (vp: Viewport, p: Point): Point => ({
  x: (p.x - vp.x) / vp.zoom,
  y: (p.y - vp.y) / vp.zoom,
});

export const toScreen = (vp: Viewport, b: Point): Point => ({
  x: b.x * vp.zoom + vp.x,
  y: b.y * vp.zoom + vp.y,
});

/** `zoom` (clamped) with the board point under screen point `p` kept under it */
export const zoomAt = (vp: Viewport, p: Point, zoom: number): Viewport => {
  const next = clampZoom(zoom);
  const b = toWorld(vp, p);
  return { x: p.x - b.x * next, y: p.y - b.y * next, zoom: next };
};

/** the zoom island's − and + (D10): ×1.2 about the board's centre */
export const stepZoom = (vp: Viewport, size: Size, dir: 1 | -1): Viewport =>
  zoomAt(
    vp,
    { x: size.width / 2, y: size.height / 2 },
    dir > 0 ? vp.zoom * ZOOM_STEP : vp.zoom / ZOOM_STEP,
  );

export interface WheelLike {
  /** the pointer, in the board's box */
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * One wheel event (D10). A pinch (macOS sends it as a wheel with `ctrlKey`)
 * and ⌘+wheel zoom about the pointer; anything else pans — two fingers on a
 * trackpad, a mouse wheel, Shift+wheel sideways off macOS.
 */
export const applyWheel = (vp: Viewport, e: WheelLike, isMac: boolean): Viewport => {
  if (e.ctrlKey || e.metaKey) {
    const factor = e.ctrlKey && isMac ? 10 : 1;
    const step = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
    return zoomAt(vp, e, vp.zoom * 2 ** (-e.deltaY * step * factor));
  }
  const normalize = e.deltaMode === 1 ? 20 : 1;
  let dx = e.deltaX * normalize;
  let dy = e.deltaY * normalize;
  if (!isMac && e.shiftKey) {
    dx = e.deltaY * normalize;
    dy = 0;
  }
  return { x: vp.x - dx * PAN_SPEED, y: vp.y - dy * PAN_SPEED, zoom: vp.zoom };
};

/** the board's box less the islands' room */
const area = (size: Size): Rect => ({
  x: INSETS.left,
  y: INSETS.top,
  w: Math.max(1, size.width - INSETS.left - INSETS.right),
  h: Math.max(1, size.height - INSETS.top - INSETS.bottom),
});

/**
 * Where something `h` tall starts down the clear area `room` when it hangs
 * `top` below the board's top (#231 D12): lifted only as far as it must to
 * end in the area, and at the area's top when it is taller than that.
 */
const hangAt = (room: Rect, top: number, h: number): number =>
  Math.max(room.y, Math.min(top, room.y + room.h - h));

/**
 * `rect` with `pad` all round as large as fits the islands' clear area,
 * between `min` and `max`; `rect` centred across, and hung `top` below the
 * board's top (`hangAt`, #231 D12).
 */
export const fitRect = (
  rect: Rect,
  size: Size,
  { min, max, pad = 0, top }: { min: number; max: number; pad?: number; top: number },
): Viewport => {
  const room = area(size);
  const zoom = Math.min(
    max,
    Math.max(
      min,
      Math.min(room.w / Math.max(rect.w + 2 * pad, 1), room.h / Math.max(rect.h + 2 * pad, 1)),
    ),
  );
  return {
    x: room.x + (room.w - rect.w * zoom) / 2 - rect.x * zoom,
    y: hangAt(room, top, rect.h * zoom) - rect.y * zoom,
    zoom,
  };
};

/**
 * The board when it first shows in a run of the app (D10): 70%, every frame
 * centred across and the topmost 36 below the board's top when they fit
 * (#231 D12), else the top-left frame corner at (24, 24). An empty board
 * centres its origin.
 */
export const initialViewport = (bounds: Rect | null, size: Size): Viewport => {
  const room = area(size);
  const zoom = DEFAULT_ZOOM;
  if (!bounds) return { x: room.x + room.w / 2, y: room.y + room.h / 2, zoom };
  if (bounds.w * zoom <= room.w && bounds.h * zoom <= room.h) {
    return fitRect(bounds, size, { min: zoom, max: zoom, top: FIT_TOP.board });
  }
  return { x: room.x - bounds.x * zoom, y: room.y - bounds.y * zoom, zoom };
};

const inside = (vp: Viewport, rect: Rect, size: Size): boolean => {
  const room = area(size);
  const a = toScreen(vp, rect);
  return (
    a.x >= room.x &&
    a.y >= room.y &&
    a.x + rect.w * vp.zoom <= room.x + room.w &&
    a.y + rect.h * vp.zoom <= room.y + room.h
  );
};

/**
 * The least pan that brings `rect` into the clear area (D20) — the zoom
 * stays. Larger than the area, its top-left lines up with the area's.
 */
export const revealPan = (vp: Viewport, rect: Rect, size: Size): Viewport => {
  if (inside(vp, rect, size)) return vp;
  const room = area(size);
  const axis = (at: number, extent: number, from: number, span: number): number => {
    if (extent > span || at < from) return from - at;
    if (at + extent > from + span) return from + span - (at + extent);
    return 0;
  };
  const a = toScreen(vp, rect);
  return {
    x: vp.x + axis(a.x, rect.w * vp.zoom, room.x, room.w),
    y: vp.y + axis(a.y, rect.h * vp.zoom, room.y, room.h),
    zoom: vp.zoom,
  };
};

/**
 * The camera on a focus (D11): `rect` with 48 around it, left as it is when
 * that is all in view at `min` or more, else fitted between `min` and `max`
 * — its top 48 below the board's top (#231 D12). Given `hang` — the project
 * frame a folder is opened in — that frame's top goes 48 down instead, as
 * the canvas hangs the frame around the sub-frame (#231 D14,
 * Hybrid-Folder-Canvas); lifted only as far as `rect` must to end in view.
 */
export const focusViewport = (
  vp: Viewport,
  rect: Rect,
  size: Size,
  bounds: { min: number; max: number },
  hang?: Rect,
): Viewport => {
  const padded = {
    x: rect.x - FOCUS_PAD,
    y: rect.y - FOCUS_PAD,
    w: rect.w + 2 * FOCUS_PAD,
    h: rect.h + 2 * FOCUS_PAD,
  };
  if (vp.zoom >= bounds.min && inside(vp, padded, size)) return vp;
  const fitted = fitRect(rect, size, { ...bounds, pad: FOCUS_PAD, top: FIT_TOP.focus });
  if (!hang) return fitted;
  const { zoom } = fitted;
  const at = hangAt(area(size), FIT_TOP.focus + (rect.y - hang.y) * zoom, rect.h * zoom);
  return { ...fitted, y: at - rect.y * zoom };
};
