import type { ShapeKind } from "./types";

/**
 * Where on a side an edge end may sit (#204).
 *
 * An end is stored as a side handle with a `-<pct>` suffix — the position along
 * that side, 0 at its top/left end — or the bare side for the middle. The side
 * itself is picked once (`pickHandles`); everything here only moves the end
 * *along* it. Pure geometry on a shape kind and its bounds, so the store, the
 * canvas and the vector SVG all ask the same questions.
 */

export type Side = "top" | "right" | "bottom" | "left";

export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** gap between ends placed side by side on one side */
export const ATTACH_SPACING = 16;
/** closer than this, two ends' arrowheads touch — spread ends never get nearer */
export const ATTACH_MIN_GAP = 8;
/** within this of the middle, an end snaps to the middle */
export const ATTACH_SNAP = 8;
/** how far from a corner an end may sit */
export const ATTACH_MARGIN = 8;

/*
 * Silhouette numbers of the shapes whose outline leaves the bounding box.
 * `ShapeSvg` draws with these, and the attach math reads them, so a line ends
 * on the outline the canvas actually paints.
 */
export const parallelogramSkew = (w: number): number => Math.min(24, w * 0.18);
export const hexagonCut = (w: number): number => Math.min(26, w * 0.2);
export const cylinderCapRy = (h: number): number => Math.min(14, h * 0.18);
export const stickyFold = (b: { width: number; height: number }): number =>
  Math.min(22, b.width * 0.3, b.height * 0.36);

export const parseSide = (handle: string | null | undefined): Side | null => {
  const side = (handle ?? "").split("-")[0];
  return (SIDES as readonly string[]).includes(side ?? "") ? (side as Side) : null;
};

/** The 0..1 position a side handle names (the middle when it has no suffix). */
export const handleRatio = (handle: string | null | undefined): number => {
  const raw = (handle ?? "").split("-")[1];
  if (raw === undefined) return 0.5;
  const pct = Number.parseFloat(raw);
  return Number.isFinite(pct) ? Math.min(Math.max(pct / 100, 0), 1) : 0.5;
};

/** The handle id for `side` at `ratio` — the bare side for the middle. */
export const sideHandle = (side: Side, ratio: number): string => {
  const pct = Number((Math.min(Math.max(ratio, 0), 1) * 100).toFixed(2));
  return pct === 50 ? side : `${side}-${pct}`;
};

export const sideLength = (b: Bounds, side: Side): number =>
  side === "left" || side === "right" ? b.height : b.width;

/**
 * The stretch of a side an end may use, in px from the side's start. Away from
 * the corners on every shape; on a slanted or curved side only the middle,
 * where the outline is still close to the box — further out a line would dive
 * deep into the bounding box to reach it.
 */
export const attachRange = (
  shape: ShapeKind,
  b: Bounds,
  side: Side,
): { min: number; max: number } => {
  const len = sideLength(b, side);
  let min = ATTACH_MARGIN;
  let max = len - ATTACH_MARGIN;
  const middleHalf = () => {
    min = Math.max(min, len / 4);
    max = Math.min(max, (len * 3) / 4);
  };
  const vertical = side === "left" || side === "right";
  switch (shape) {
    case "ellipse":
    case "diamond":
      middleHalf();
      break;
    case "hexagon":
      if (vertical) middleHalf();
      else {
        const cut = hexagonCut(b.width);
        min = Math.max(min, cut);
        max = Math.min(max, len - cut);
      }
      break;
    case "parallelogram":
      if (!vertical) {
        const skew = parallelogramSkew(b.width);
        if (side === "top") min = Math.max(min, skew);
        else max = Math.min(max, len - skew);
      }
      break;
    case "cylinder":
      if (vertical) {
        const ry = cylinderCapRy(b.height);
        min = Math.max(min, ry);
        max = Math.min(max, len - ry);
      } else middleHalf();
      break;
    case "sticky":
      // the folded corner cuts the bottom-right off the outline
      if (side === "right" || side === "bottom") max = Math.min(max, len - stickyFold(b));
      break;
    default:
      break;
  }
  // too small to leave anything: the middle is the only place
  if (min > max) return { min: len / 2, max: len / 2 };
  return { min, max };
};

/**
 * How far inside the bounding box the outline is at `ratio` along `side`. The
 * route is planned from the box side (stubs, obstacles and the slide clamp all
 * judge from there); the drawn line then runs this much further in, straight
 * along the side's normal, to touch the outline.
 */
export const outlineInset = (shape: ShapeKind, b: Bounds, side: Side, ratio: number): number => {
  const vertical = side === "left" || side === "right";
  const len = sideLength(b, side);
  const depth = vertical ? b.width : b.height;
  // signed offset from the side's middle, -1..1
  const u = len > 0 ? (ratio * len - len / 2) / (len / 2) : 0;
  const along = ratio * len;
  switch (shape) {
    case "ellipse":
      return (depth / 2) * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
    case "diamond":
      return (depth / 2) * Math.abs(u);
    case "hexagon": {
      const cut = hexagonCut(b.width);
      if (vertical) return cut * Math.abs(u);
      // the slanted ends of the top/bottom edges
      if (along < cut) return (b.height / 2) * (1 - along / cut);
      if (along > len - cut) return (b.height / 2) * (1 - (len - along) / cut);
      return 0;
    }
    case "parallelogram": {
      const skew = parallelogramSkew(b.width);
      if (side === "left") return skew * (1 - ratio);
      if (side === "right") return skew * ratio;
      // the slanted sides cut the top-left and bottom-right corners
      if (side === "top" && along < skew) return b.height * (1 - along / skew);
      if (side === "bottom" && along > len - skew) return b.height * (1 - (len - along) / skew);
      return 0;
    }
    case "cylinder": {
      if (vertical) return 0;
      const ry = cylinderCapRy(b.height);
      // the top cap's near rim; the bottom's far rim is the outline
      return ry * (1 - Math.sqrt(Math.max(0, 1 - u * u)));
    }
    case "sticky": {
      // the folded corner: an end slid onto it (#43) still reaches the outline
      if (side !== "right" && side !== "bottom") return 0;
      return Math.max(0, along - (len - stickyFold(b)));
    }
    default:
      return 0;
  }
};

/** The side of `b` nearest to `p` (distance to each side's segment). */
export const nearestSide = (b: Bounds, p: { x: number; y: number }): Side => {
  const cx = Math.min(Math.max(p.x, b.x), b.x + b.width);
  const cy = Math.min(Math.max(p.y, b.y), b.y + b.height);
  const dist: Record<Side, number> = {
    top: Math.hypot(p.x - cx, p.y - b.y),
    bottom: Math.hypot(p.x - cx, p.y - (b.y + b.height)),
    left: Math.hypot(p.x - b.x, p.y - cy),
    right: Math.hypot(p.x - (b.x + b.width), p.y - cy),
  };
  // inside the box every side is a straight drop away
  if (p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height) {
    dist.top = p.y - b.y;
    dist.bottom = b.y + b.height - p.y;
    dist.left = p.x - b.x;
    dist.right = b.x + b.width - p.x;
  }
  return SIDES.reduce((best, s) => (dist[s] < dist[best] ? s : best), "top" as Side);
};

/**
 * Where a pointer lands on `side`: its projection onto the side, pulled into
 * the usable stretch, snapped to the middle when close to it. Returns 0..1.
 */
export const projectToSide = (
  shape: ShapeKind,
  b: Bounds,
  side: Side,
  p: { x: number; y: number },
): number => {
  const len = sideLength(b, side);
  if (len <= 0) return 0.5;
  const raw = side === "left" || side === "right" ? p.y - b.y : p.x - b.x;
  if (Math.abs(raw - len / 2) <= ATTACH_SNAP) return 0.5;
  const { min, max } = attachRange(shape, b, side);
  return Math.min(Math.max(raw, min), max) / len;
};
