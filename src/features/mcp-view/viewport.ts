/**
 * Zoom and pan for the chat view (#202), as a viewBox: the SVG is vector, so
 * changing what part of it the frame shows keeps every line sharp, where a CSS
 * transform would scale a raster. Every box here has the frame's aspect
 * ratio, so one number — `scaleOf` — is the zoom on both axes.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/** frame pixels per diagram unit */
export const scaleOf = (view: Box, frame: Size): number => frame.width / view.width;

const clampScale = (scale: number, floor = MIN_SCALE): number =>
  Math.min(MAX_SCALE, Math.max(floor, scale));

/** a box of `scale` centred on (cx, cy) */
const around = (cx: number, cy: number, scale: number, frame: Size): Box => {
  const width = frame.width / scale;
  const height = frame.height / scale;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
};

/**
 * The whole drawing, centred. Never larger than actual size: a three-shape
 * diagram blown up to fill a wide chat reads worse than at 1:1. No floor —
 * "the whole drawing" is the definition, however far out that is (#202). The drawing's own viewBox already carries its margin.
 */
export const fitView = (content: Box, frame: Size): Box => {
  const scale = Math.min(1, frame.width / content.width, frame.height / content.height);
  return around(content.x + content.width / 2, content.y + content.height / 2, scale, frame);
};

/**
 * Zooms by `factor`, keeping the diagram point under `point` (frame pixels)
 * where it is. `floor` lowers the zoom-out limit — to the drawing's fit, so a
 * drawing larger than `MIN_SCALE` allows can still be seen whole.
 */
export const zoomAt = (
  view: Box,
  frame: Size,
  point: { x: number; y: number },
  factor: number,
  floor = MIN_SCALE,
): Box => {
  const scale = scaleOf(view, frame);
  const next = clampScale(scale * factor, Math.min(MIN_SCALE, floor));
  const px = view.x + point.x / scale;
  const py = view.y + point.y / scale;
  return {
    x: px - point.x / next,
    y: py - point.y / next,
    width: frame.width / next,
    height: frame.height / next,
  };
};

/** follows a drag of (dx, dy) frame pixels — the drawing moves with the pointer */
export const panBy = (view: Box, frame: Size, dx: number, dy: number): Box => {
  const scale = scaleOf(view, frame);
  return { ...view, x: view.x - dx / scale, y: view.y - dy / scale };
};

/** the share of the frame (or of a smaller drawing) that stays on the drawing */
const IN_SIGHT = 0.2;

/**
 * `view` moved back just far enough that part of `content` stays in it: a
 * drag or arrow key can't push the drawing out to an empty frame, the only
 * way back from which was Fit (#202).
 */
export const keepInSight = (view: Box, content: Box): Box => {
  const clampAxis = (at: number, size: number, start: number, length: number) => {
    const margin = Math.min(size, length) * IN_SIGHT;
    return Math.min(start + length - margin, Math.max(start + margin - size, at));
  };
  return {
    ...view,
    x: clampAxis(view.x, view.width, content.x, content.width),
    y: clampAxis(view.y, view.height, content.y, content.height),
  };
};
