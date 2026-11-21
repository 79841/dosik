import { Position } from "@xyflow/react";

import type { EdgePathStyle, EdgeWaypoint } from "./types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeEndpoint extends Point {
  position: Position;
}

export interface BuildPathOptions {
  pathStyle: EdgePathStyle;
  waypoints: EdgeWaypoint[];
  /** signed perpendicular offset used to separate parallel edges */
  parallelOffset: number;
  /** obstacle rects (node bounds) the orthogonal router should avoid */
  obstacles: Rect[];
  /** the two endpoint nodes' own rects — see `EndpointBounds` (#96) */
  endpointBounds?: EndpointBounds;
  /** index among self-loop edges of the same node */
  selfLoopIndex?: number;
  /** explicit self-loop reach in px; overrides the stacked default (#99) */
  selfLoopWidth?: number;
  /**
   * Whether each endpoint gets a 16px stub along its handle direction.
   * Free endpoints (anchors) have no meaningful side — disable their stub so
   * the path (and the arrowhead) follows the drawn direction exactly.
   */
  stubs?: { source: boolean; target: boolean };
  /**
   * Where the drawn line meets each end shape's outline, when that lies inside
   * the bounding box (an ellipse off its side's middle, #204 D10). The route
   * is still planned from the box side; only the drawn ends reach in, straight
   * along the side's normal.
   */
  reach?: { source?: Point; target?: Point };
}

/** Side of `from` facing `to` — used as the direction of a free endpoint. */
export const facingPosition = (from: Point, to: Point): Position => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? Position.Right : Position.Left;
  }
  return dy >= 0 ? Position.Bottom : Position.Top;
};

export interface BuiltPath {
  d: string;
  /** polyline approximation of the path, used for hit tests and handles */
  points: Point[];
}

/**
 * Merge threshold: points closer than this collapse into one. `dedupe` tests
 * it per axis, the landing band (#85) as a distance — the same on the
 * axis-aligned chains both run on.
 */
const COLLAPSE_EPS = 0.5;
const CORNER_RADIUS = 6;
const STUB = 16;
const OBSTACLE_MARGIN = 12;

const dir = (position: Position): Point => {
  switch (position) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
  }
};

const dedupe = (points: Point[]): Point[] => {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > COLLAPSE_EPS || Math.abs(last.y - p.y) > COLLAPSE_EPS) {
      out.push(p);
    }
  }
  return out;
};

/**
 * Removes interior points that sit on a straight line between neighbours.
 * Spikes (collinear but doubling back) are kept — they are intentional
 * waypoint detours, not redundancy.
 */
const simplify = (points: Point[]): Point[] => {
  const out = dedupe(points);
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.5 && dot >= 0) out.splice(i, 1);
  }
  return out;
};

/** Builds an SVG path through the polyline with rounded corners. */
export const roundedPolylinePath = (points: Point[], radius = CORNER_RADIUS): string => {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${inX} ${inY} Q ${cur.x} ${cur.y} ${outX} ${outY}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
};

const segmentIntersectsRect = (a: Point, b: Point, rect: Rect): boolean => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    minX < rect.x + rect.width && maxX > rect.x && minY < rect.y + rect.height && maxY > rect.y
  );
};

/**
 * `bends` is how many times the line turns where it is drawn. The router's
 * own points leave out the two stubs, and a route can look straight between
 * the stub ends yet turn where it meets them — counting there picked a
 * three-bend step over a one-bend ┐ for a right-side to top-side edge.
 */
const routeScore = (points: Point[], obstacles: Rect[], bends = points.length - 2): number => {
  let crossings = 0;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (const rect of obstacles) {
      if (segmentIntersectsRect(a, b, rect)) crossings += 1;
    }
  }
  return crossings * 10000 + bends * 30 + length;
};

/**
 * Orthogonal route between two stub points. Tries a set of candidate
 * H-V-H / V-H-V routes (including detours around obstacle bounds) and picks
 * the one with the fewest obstacle crossings, then fewest bends.
 */
const routeOrthogonal = (
  start: Point,
  end: Point,
  startDir: Point,
  endDir: Point,
  obstacles: Rect[],
): Point[] => {
  const candidates: Point[][] = [];

  const midXs = new Set<number>([(start.x + end.x) / 2, start.x, end.x]);
  const midYs = new Set<number>([(start.y + end.y) / 2, start.y, end.y]);
  for (const rect of obstacles) {
    midXs.add(rect.x - OBSTACLE_MARGIN);
    midXs.add(rect.x + rect.width + OBSTACLE_MARGIN);
    midYs.add(rect.y - OBSTACLE_MARGIN);
    midYs.add(rect.y + rect.height + OBSTACLE_MARGIN);
  }

  for (const mx of midXs) {
    candidates.push([start, { x: mx, y: start.y }, { x: mx, y: end.y }, end]);
  }
  for (const my of midYs) {
    candidates.push([start, { x: start.x, y: my }, { x: end.x, y: my }, end]);
  }
  // L-shapes
  candidates.push([start, { x: end.x, y: start.y }, end]);
  candidates.push([start, { x: start.x, y: end.y }, end]);

  // Prefer candidates whose first segment continues the stub direction.
  let best: Point[] | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const cleaned = simplify(candidate);
    // the stubs run into `start` along startDir and out of `end` against
    // endDir — count the turns the drawn line makes, stubs included
    const drawn = [
      { x: start.x - startDir.x, y: start.y - startDir.y },
      ...cleaned,
      { x: end.x - endDir.x, y: end.y - endDir.y },
    ];
    let score = routeScore(cleaned, obstacles, bendCount(drawn));
    const first = cleaned[1];
    if (first) {
      const fx = Math.sign(first.x - start.x);
      const fy = Math.sign(first.y - start.y);
      // leaving the start stub against its outward direction doubles back
      if ((startDir.x !== 0 && fx === -startDir.x) || (startDir.y !== 0 && fy === -startDir.y)) {
        score += 900;
      }
    }
    const last = cleaned[cleaned.length - 2];
    if (last) {
      const lx = Math.sign(end.x - last.x);
      const ly = Math.sign(end.y - last.y);
      // the end stub extends outward along endDir and the final (fixed)
      // segment re-enters the node against it — so arriving at the stub
      // *along* endDir doubles back past the arrowhead (visible spur)
      if ((endDir.x !== 0 && lx === endDir.x) || (endDir.y !== 0 && ly === endDir.y)) {
        score += 900;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = cleaned;
    }
  }
  return best ?? [start, end];
};

/** Interior vertices where the direction changes — the visible bends. */
const bendCount = (points: Point[]): number => {
  let bends = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    if (
      Math.sign(b.x - a.x) !== Math.sign(c.x - b.x) ||
      Math.sign(b.y - a.y) !== Math.sign(c.y - b.y)
    ) {
      bends++;
    }
  }
  return bends;
};

/**
 * The two endpoint nodes' own rects. Only `stubLengths` reads them, and only to
 * tell "boxes pushed together" from "box parked behind its partner" (#96).
 * Optional so a caller that has no node context keeps the older, narrower rule.
 */
export interface EndpointBounds {
  source: Rect;
  target: Rect;
}

/**
 * How two ends on opposite sides face each other: the axis they face along
 * and the gap between them along it (zero when touching, negative once they
 * have crossed). Null when the sides are not opposite.
 */
const facing = (
  s: Point,
  t: Point,
  sd: Point,
  td: Point,
): { axis: "x" | "y"; gap: number } | null => {
  if (sd.x !== 0 && sd.x === -td.x) return { axis: "x", gap: (t.x - s.x) * sd.x };
  if (sd.y !== 0 && sd.y === -td.y) return { axis: "y", gap: (t.y - s.y) * sd.y };
  return null;
};

/** Rect intersection, touching edges included (two flush boxes count). */
const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/**
 * Stub lengths for the orthogonal route. Fixed 16px, except when the two
 * handles face each other closer than two stubs along the facing axis — then
 * both shrink proportionally to meet midway, so the stubs never cross and the
 * router can still draw a minimal route (#69). Touching or overlapping boxes
 * (separation <= 0) shrink to nothing: full stubs would run straight past
 * each other and the router would hook up and over the boxes to reconnect
 * them (#86). See `TOUCHING_NUB` for what that leaves when both handles land
 * on the same point.
 *
 * A stub is the route's only side constraint: it is the one segment guaranteed
 * to leave (or enter) along the handle's own direction. Shrink one to nothing
 * and the router may arrive from any direction, which is how an edge pinned to
 * a `left` handle ended up coming down into the box from above (#96). So the
 * two shrink conditions are kept as narrow as the problems they solve —
 * `across` for the axis they share, `bounds` for boxes that really do overlap.
 */
const stubLengths = (
  s: Point,
  t: Point,
  sd: Point,
  td: Point,
  sLen: number,
  tLen: number,
  bounds: EndpointBounds | undefined,
): { source: number; target: number } => {
  const total = sLen + tLen;
  if (total === 0) return { source: sLen, target: tLen };
  const faced = facing(s, t, sd, td);
  if (!faced) return { source: sLen, target: tLen };
  const sep = faced.gap;
  if (sep >= total) return { source: sLen, target: tLen };
  // Still approaching each other, just closer than two stubs: shrink both so
  // they meet midway instead of crossing (#69). This branch keeps a non-zero
  // stub, so the route still has its side constraint, and it must not be
  // narrowed by the guards below — a small gap with a large across-offset is a
  // perfectly ordinary diagonal pair (`edgeZigzag.test.ts`, g=4 dy=40).
  if (sep > 0) return { source: (sLen * sep) / total, target: (tLen * sep) / total };

  // Past here the endpoints have crossed, which covers two different pictures:
  // boxes pushed together — the one the collapse is for, where full stubs would
  // run straight past each other and the router would hook up and over the pair
  // to reconnect them (#86) — and a box parked *behind* its partner with the
  // handles pointing away, where collapsing throws away the route's only side
  // constraint and the line arrives from whatever direction it likes (#96).
  //
  // The node rects are what tell them apart. Nothing derivable from the two
  // handle points can: each sits on the near edge of its own box and says
  // nothing about where the far edge is.
  if (bounds) {
    return rectsOverlap(bounds.source, bounds.target)
      ? { source: 0, target: 0 }
      : { source: sLen, target: tLen };
  }
  // No node context. Fall back to the offset across the facing axis — two stubs
  // further apart than a stub pair across their shared line cannot collide, so
  // there is nothing to collapse for. It gets the common cases right and is
  // what every caller without bounds used to get.
  const across = faced.axis === "x" ? Math.abs(t.y - s.y) : Math.abs(t.x - s.x);
  return across > total ? { source: sLen, target: tLen } : { source: 0, target: 0 };
};

/**
 * Where each endpoint's stub ends — the first point the path may bend at.
 * Shared by the router, the waypoint verdict, and the slide clamp so all
 * three agree on what "past the stub" means (#53).
 */
export const stubPoints = (
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  stubs?: { source: boolean; target: boolean },
  bounds?: EndpointBounds,
): { source: Point; target: Point } => {
  const s: Point = { x: source.x, y: source.y };
  const t: Point = { x: target.x, y: target.y };
  const sd = dir(source.position);
  const td = dir(target.position);
  const len = stubLengths(
    s,
    t,
    sd,
    td,
    (stubs?.source ?? true) ? STUB : 0,
    (stubs?.target ?? true) ? STUB : 0,
    bounds,
  );
  return {
    source: { x: s.x + sd.x * len.source, y: s.y + sd.y * len.source },
    target: { x: t.x + td.x * len.target, y: t.y + td.y * len.target },
  };
};

/**
 * The stretch of a side an end may slide along, in canvas units: y for a left
 * or right side, x for a top or bottom one.
 */
export interface SideSpan {
  min: number;
  max: number;
}

/**
 * Two ends on facing sides whose stretches overlap are joined by one straight
 * line instead of a short step (#257). An end with a span may slide within
 * it; an end without one stays put. The line runs level with the end that has
 * the shorter stretch (the source on a tie) — so the end with the longer
 * usable stretch is the one that slides — or, when that spot is out of the
 * other end's reach, along the nearest edge of the overlap. Moving a shape
 * therefore moves the line smoothly, never in a jump.
 *
 * Everything else comes back unchanged and the router bends as before: ends
 * that do not face each other across a gap (touching and crossed pairs are
 * the stub rules' business, #86 #96), stretches that do not overlap, and a
 * straight line that would run through a shape in `obstacles` other than the
 * two ends' own — the route would bend around it anyway.
 */
export const alignFacingEnds = (
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  spans: { source?: SideSpan; target?: SideSpan },
  obstacles: Rect[] = [],
): { source: EdgeEndpoint; target: EdgeEndpoint } => {
  const unchanged = { source, target };
  const faced = facing(source, target, dir(source.position), dir(target.position));
  if (!faced || faced.gap <= 0) return unchanged;
  const facingX = faced.axis === "x";
  const ps = facingX ? source.y : source.x;
  const pt = facingX ? target.y : target.x;
  if (ps === pt) return unchanged;
  const s = spans.source ?? { min: ps, max: ps };
  const t = spans.target ?? { min: pt, max: pt };
  const lo = Math.max(s.min, t.min);
  const hi = Math.min(s.max, t.max);
  if (lo > hi) return unchanged;
  const level = s.max - s.min <= t.max - t.min ? ps : pt;
  const at = Math.min(Math.max(level, lo), hi);
  const aligned = {
    source: facingX ? { ...source, y: at } : { ...source, x: at },
    target: facingX ? { ...target, y: at } : { ...target, x: at },
  };
  const contains = (r: Rect, p: Point) =>
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  const blocked = obstacles.some(
    (r) =>
      !contains(r, aligned.source) &&
      !contains(r, aligned.target) &&
      segmentIntersectsRect(aligned.source, aligned.target, r),
  );
  return blocked ? unchanged : aligned;
};

/** Inserts a corner between consecutive points so all segments are axis-aligned. */
const orthogonalizeChain = (points: Point[]): Point[] => {
  const out: Point[] = [points[0]!];
  let prevDir: Point = { x: 0, y: 0 };
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const needsX = Math.abs(cur.x - prev.x) > 0.5;
    const needsY = Math.abs(cur.y - prev.y) > 0.5;
    if (needsX && needsY) {
      // choose the corner that avoids doubling back on the previous segment
      let horizontalFirst: boolean;
      if (prevDir.x !== 0) {
        horizontalFirst = Math.sign(cur.x - prev.x) === Math.sign(prevDir.x);
      } else if (prevDir.y !== 0) {
        horizontalFirst = Math.sign(cur.y - prev.y) !== Math.sign(prevDir.y);
      } else {
        horizontalFirst = true;
      }
      const corner = horizontalFirst ? { x: cur.x, y: prev.y } : { x: prev.x, y: cur.y };
      out.push(corner);
      prevDir = {
        x: Math.sign(cur.x - corner.x),
        y: Math.sign(cur.y - corner.y),
      };
      out.push(cur);
    } else {
      prevDir = { x: Math.sign(cur.x - prev.x), y: Math.sign(cur.y - prev.y) };
      out.push(cur);
    }
  }
  return simplify(out);
};

/**
 * True when forcing the orthogonal path through `waypoints` bends more than
 * rerouting from scratch would. Waypoints are absolute coordinates left by a
 * segment slide; once an endpoint node moves they can twist the path into
 * doubling back (#69). The baseline routes with the same `obstacles` the
 * renderer would use, so a slide detouring around an obstacle keeps its extra
 * bends — equal counts mean the waypoints still carry the user's intent,
 * more means they are spent.
 *
 * `fresh` is where the ends would be drawn once the waypoints are gone, when
 * that differs from `source`/`target` — an auto end slides to straighten a
 * line with no bends of its own (#257), so the baseline is routed from there.
 */
export const waypointsWorsenPath = (
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  waypoints: EdgeWaypoint[],
  obstacles: Rect[],
  bounds?: EndpointBounds,
  fresh: { source: EdgeEndpoint; target: EdgeEndpoint } = { source, target },
): boolean => {
  if (waypoints.length === 0) return false;
  // same stub math as buildEdgePath, so the verdict matches what would render
  const route = (from: EdgeEndpoint, to: EdgeEndpoint, through: EdgeWaypoint[]) => {
    const { source: sStub, target: tStub } = stubPoints(from, to, undefined, bounds);
    const inner =
      through.length > 0
        ? orthogonalizeChain([sStub, ...through, tStub])
        : routeOrthogonal(sStub, tStub, dir(from.position), dir(to.position), obstacles);
    return simplify([{ x: from.x, y: from.y }, ...inner, { x: to.x, y: to.y }]);
  };
  return (
    bendCount(route(source, target, waypoints)) > bendCount(route(fresh.source, fresh.target, []))
  );
};

const catmullRomPath = (points: Point[]): string => {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
};

const offsetInterior = (points: Point[], offset: number): Point[] => {
  if (offset === 0 || points.length < 2) return points;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const nx = -(end.y - start.y) / len;
  const ny = (end.x - start.x) / len;
  return points.map((p, i) =>
    i === 0 || i === points.length - 1 ? p : { x: p.x + nx * offset, y: p.y + ny * offset },
  );
};

/** Self-loop: exits the source side, loops around the node corner, re-enters. */
/** A self-loop narrower than this has no room for its own corners. */
export const SELF_LOOP_MIN_WIDTH = 16;

const selfLoopPath = (
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  loopIndex: number,
  width?: number,
): BuiltPath => {
  // the default fans stacked loops apart; an explicit width is the user's
  // drag and must not be re-spread by the index
  const grow = width === undefined ? 36 + loopIndex * 22 : Math.max(SELF_LOOP_MIN_WIDTH, width);
  const sd = dir(source.position);
  const td = dir(target.position);
  const p1 = { x: source.x + sd.x * grow, y: source.y + sd.y * grow };
  const p4 = { x: target.x + td.x * grow, y: target.y + td.y * grow };
  const s = { x: source.x, y: source.y };
  const t = { x: target.x, y: target.y };

  let points: Point[];
  const sameSide = sd.x === td.x && sd.y === td.y;
  const separation = sd.x !== 0 ? Math.abs(t.y - s.y) : Math.abs(t.x - s.x);
  if (sameSide && separation >= 8) {
    // same side with separated endpoints (sequence self-message): a simple
    // rectangular loop out the shared side — out, across, back
    points = simplify([s, p1, p4, t]);
  } else if (sd.x * td.x + sd.y * td.y !== 0) {
    // same-axis handles (same or opposite side): loop around via two
    // perpendicular corners so the path never collapses into a line
    const perp = sd.x !== 0 ? { x: 0, y: -1 } : { x: -1, y: 0 };
    const c1 = { x: p1.x + perp.x * grow, y: p1.y + perp.y * grow };
    const c2 = { x: p4.x + perp.x * grow, y: p4.y + perp.y * grow };
    points = simplify([s, p1, c1, c2, p4, t]);
  } else {
    // perpendicular handles: single corner between the two extended stubs
    const corner = sd.x !== 0 ? { x: p1.x, y: p4.y } : { x: p4.x, y: p1.y };
    points = simplify([s, p1, corner, p4, t]);
  }
  return { d: roundedPolylinePath(points, 10), points };
};

/** how far a curve's control point reaches out of its side, for `along` px towards the other end */
const curveReach = (along: number): number =>
  along >= 0 ? along * 0.5 : 0.25 * 25 * Math.sqrt(-along);

/** samples taken along a curve for labels, hit tests and drop targets */
const CURVE_SAMPLES = 24;

/**
 * A curved line with no bends of its own: a cubic that leaves each end
 * straight out of its side and bends between them — the curve diagram tools
 * draw. Through three points on one line (the old way), a Catmull-Rom curve
 * is a straight line, so "Curved" looked exactly like "Straight" (#204).
 * Parallel lines bow apart by `offset`. `points` samples the curve.
 */
const sideCurve = (
  s: Point,
  t: Point,
  sourcePosition: Position,
  targetPosition: Position,
  offset: number,
): BuiltPath => {
  const sd = dir(sourcePosition);
  const td = dir(targetPosition);
  const sReach = curveReach((t.x - s.x) * sd.x + (t.y - s.y) * sd.y);
  const tReach = curveReach((s.x - t.x) * td.x + (s.y - t.y) * td.y);
  // parallel lines: push both controls the same way, across the line
  const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
  const across = { x: (-(t.y - s.y) / len) * offset * 1.3, y: ((t.x - s.x) / len) * offset * 1.3 };
  const c1 = { x: s.x + sd.x * sReach + across.x, y: s.y + sd.y * sReach + across.y };
  const c2 = { x: t.x + td.x * tReach + across.x, y: t.y + td.y * tReach + across.y };
  const points = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
    const u = i / CURVE_SAMPLES;
    const v = 1 - u;
    return {
      x: v * v * v * s.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * t.x,
      y: v * v * v * s.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * t.y,
    };
  });
  return { d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${t.x} ${t.y}`, points };
};

/**
 * Builds the SVG path and its polyline approximation for an edge.
 * Pure function of geometry — safe to unit test.
 */
export const buildEdgePath = (
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  options: BuildPathOptions,
): BuiltPath => {
  const { pathStyle, waypoints, parallelOffset, obstacles, reach } = options;

  if (options.selfLoopIndex !== undefined) {
    const loop = selfLoopPath(source, target, options.selfLoopIndex, options.selfLoopWidth);
    if (!reach?.source && !reach?.target) return loop;
    const points = reachIn(loop.points, source, target, reach);
    return { d: roundedPolylinePath(points, 10), points };
  }

  // a straight or curved line has no stub to keep: it simply starts on the outline
  const s: Point =
    pathStyle !== "orthogonal" && reach?.source ? reach.source : { x: source.x, y: source.y };
  const t: Point =
    pathStyle !== "orthogonal" && reach?.target ? reach.target : { x: target.x, y: target.y };

  if (pathStyle === "straight") {
    let points = dedupe([s, ...waypoints, t]);
    if (waypoints.length === 0 && parallelOffset !== 0) {
      const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
      points = offsetInterior([s, mid, t], parallelOffset);
    }
    const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
    return { d, points };
  }

  if (pathStyle === "curved") {
    if (waypoints.length === 0)
      return sideCurve(s, t, source.position, target.position, parallelOffset);
    const points = dedupe([s, ...waypoints, t]);
    return { d: catmullRomPath(points), points };
  }

  // orthogonal
  const sd = dir(source.position);
  const td = dir(target.position);
  const { source: sStub, target: tStub } = stubPoints(
    source,
    target,
    options.stubs,
    options.endpointBounds,
  );

  let interior: Point[];
  if (waypoints.length > 0) {
    interior = orthogonalizeChain([sStub, ...waypoints, tStub]);
  } else {
    interior = routeOrthogonal(sStub, tStub, sd, td, obstacles);
    if (parallelOffset !== 0) {
      // a straight route has no interior points to shift — give it one
      if (interior.length === 2) {
        interior = [
          interior[0]!,
          {
            x: (interior[0]!.x + interior[1]!.x) / 2,
            y: (interior[0]!.y + interior[1]!.y) / 2,
          },
          interior[1]!,
        ];
      }
      interior = offsetInterior(interior, parallelOffset);
      interior = orthogonalizeChain(interior);
    }
  }
  const routed = withTouchingNub(simplify([s, ...interior, t]), sd);
  const points = reach ? reachIn(routed, source, target, reach) : routed;
  return { d: roundedPolylinePath(points), points };
};

/**
 * Carries an orthogonal chain's ends in to the outline points. The first and
 * last segments leave along the side's normal, so the outline point lies on
 * their line and simply lengthens them; where they do not (a touching nub),
 * the outline point is added in front instead.
 */
const reachIn = (
  points: Point[],
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  reach: { source?: Point; target?: Point },
): Point[] => {
  const out = [...points];
  const along = (from: Point, to: Point, d: Point) =>
    Math.abs((to.x - from.x) * d.y - (to.y - from.y) * d.x) < 0.5;
  if (reach.source && out.length > 1) {
    if (along(out[0]!, out[1]!, dir(source.position))) out[0] = reach.source;
    else out.unshift(reach.source);
  }
  if (reach.target && out.length > 1) {
    const n = out.length;
    if (along(out[n - 1]!, out[n - 2]!, dir(target.position))) out[n - 1] = reach.target;
    else out.push(reach.target);
  }
  return out;
};

/** Half-length of the tick drawn where two handles land on the same point. */
const TOUCHING_NUB = 3;

/**
 * Two boxes pushed until their facing handles coincide leave nothing to draw.
 * A short tick along the source's outward axis keeps the invariant every
 * consumer of `points` assumes: **the chain has at least one segment** (#86).
 * They walk segments, not points, so a one-point chain degrades silently, and
 * the tick is what brings each back: `distanceToPolyline` Infinity → 0,
 * `segmentMidpoints` `[]` → one midpoint, and the hit path built from `d` from
 * no stroke geometry at all → a grabbable 6px stroke. (Infinity also broke
 * drop-a-node-to-split-an-edge, gone as of #91.) `slideStubClamp.test.ts` pins
 * the tick. `middleSegmentIndices` stays empty either way — it only grips
 * *interior* segments, and a two-point chain has none.
 *
 * It does not make the edge usable. The chain collapses to one point when the
 * handles face each other, and then the tick lands inside both boxes while
 * nodes paint over the edge layer and take the pointer; label anchors stay
 * within 0.6px of each other because `endInset` clamps at 0.45 on a 6px chain.
 * Pulling a box away brings the edge back, which is the recovery path — being
 * unable to grab a fully overlapped edge is accepted behaviour (user,
 * 2026-08-18). Same-side handles keep their full 16px stubs (`stubLengths`
 * never shrinks a same-side pair), so the chain stays 3 points and the tick
 * never fires there. The one non-facing case that reaches it is both endpoints
 * being anchors (stubs off) — a zero-length free arrow, where there is no box
 * to hide the tick and it is what makes the arrow grabbable.
 */
const withTouchingNub = (points: Point[], sd: Point): Point[] => {
  if (points.length > 1) return points;
  const p = points[0];
  if (!p) return points;
  return [
    { x: p.x - sd.x * TOUCHING_NUB, y: p.y - sd.y * TOUCHING_NUB },
    { x: p.x + sd.x * TOUCHING_NUB, y: p.y + sd.y * TOUCHING_NUB },
  ];
};

/** Distance from a point to the closest segment of a polyline. */
export const distanceToPolyline = (point: Point, points: Point[]): number => {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lenSq));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    best = Math.min(best, Math.hypot(point.x - px, point.y - py));
  }
  return best;
};

/** Point at arc-length ratio t (0..1) along a polyline. */
export const polylinePointAtT = (points: Point[], t: number): Point => {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
    lengths.push(len);
    total += len;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]! || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : target / lengths[i]!;
      return {
        x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * f,
        y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * f,
      };
    }
    target -= lengths[i]!;
  }
  return points[points.length - 1]!;
};

/** Arc-length ratio (0..1) of the polyline point closest to `p`. */
export const polylineProjectT = (points: Point[], p: Point): number => {
  if (points.length < 2) return 0.5;
  let bestDist = Infinity;
  let bestLen = 0;
  let walked = 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLen = Math.hypot(abx, aby);
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = Math.hypot(p.x - px, p.y - py);
    if (d < bestDist) {
      bestDist = d;
      bestLen = walked + segLen * t;
    }
    walked += segLen;
    total += segLen;
  }
  return total === 0 ? 0.5 : bestLen / total;
};

/**
 * Segments touching neither endpoint — the only ones the user may slide.
 * A segment holding an endpoint would have to drag the attachment with it,
 * which is a different gesture (see the store's `slideEdgeLine`).
 */
export const middleSegmentIndices = (points: Point[]): number[] => {
  const out: number[] = [];
  for (let i = 1; i < points.length - 2; i++) out.push(i);
  return out;
};

/**
 * Slides one segment perpendicular to its own direction so it passes through
 * `to`, carrying both of its vertices. Movement along the segment is ignored,
 * so the bend count never changes — only where the bends sit.
 */
export const slideSegment = (
  points: Point[],
  index: number,
  to: Point,
  stubEnds?: { source: Point; target: Point },
): Point[] => {
  const a = points[index];
  const b = points[index + 1];
  if (!a || !b) return points;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return points;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  let shift = (to.x - (a.x + b.x) / 2) * nx + (to.y - (a.y + b.y) / 2) * ny;
  if (stubEnds) {
    shift = clampShiftToStubs(points, index, { x: nx, y: ny }, shift, stubEnds);
  }
  const next = [...points];
  next[index] = { x: a.x + nx * shift, y: a.y + ny * shift };
  next[index + 1] = { x: b.x + nx * shift, y: b.y + ny * shift };
  return next;
};

/**
 * Keeps a slide from pushing a segment inside either endpoint's stub, which
 * would make the path leave the node and immediately double back over itself
 * (#53). Only the segments touching an endpoint can violate this, and a
 * zero-length stub (a free anchor) has nothing to cross.
 *
 * Each bound is capped at the current position (shift 0), so the clamp only
 * ever stops the segment from going *further* in. A chain that already sits
 * inside a stub — loaded from a file, or set through the bridge — must not be
 * yanked to the boundary the moment it is touched.
 */
const clampShiftToStubs = (
  points: Point[],
  index: number,
  normal: Point,
  shift: number,
  stubEnds: { source: Point; target: Point },
): number => {
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;

  /**
   * Keeps `moved` at least as far out as `stub` along the stub direction.
   * Returns whether it actually produced a bound — sliding across the stub
   * axis (k = 0) constrains nothing, and a stub that constrains nothing must
   * not exempt itself from the landing band below.
   */
  const limit = (moved: Point, end: Point, stub: Point): boolean => {
    const dx = stub.x - end.x;
    const dy = stub.y - end.y;
    const reach = Math.hypot(dx, dy);
    if (reach === 0) return false; // anchor endpoint: no stub to cross
    const ux = dx / reach;
    const uy = dy / reach;
    const k = normal.x * ux + normal.y * uy;
    if (Math.abs(k) < 1e-9) return false; // sliding across the stub, never along it
    const bound = (reach - ((moved.x - end.x) * ux + (moved.y - end.y) * uy)) / k;
    if (k > 0) lo = Math.max(lo, Math.min(bound, 0));
    else hi = Math.min(hi, Math.max(bound, 0));
    return true;
  };

  const sourceGoverned = index === 1 && limit(points[index]!, points[0]!, stubEnds.source);
  const targetGoverned =
    index + 1 === points.length - 2 &&
    limit(points[index + 1]!, points[points.length - 1]!, stubEnds.target);

  const clamped = Math.min(hi, Math.max(lo, shift));
  // Landing *exactly* on the far stub collapses the segment in between, which
  // makes this one adjacent after the fact — and the clamp above, judged on
  // the chain as it was when the drag started, never sees that (#85). Refuse
  // the landing instead. A stub whose adjacency limit is *live* is exempt:
  // settling exactly on it is that limit's intended stop (#53). Adjacency
  // alone isn't enough — a limit that produced no bound protects nothing.
  return avoidStubLanding(points, index, normal, clamped, stubEnds, {
    source: sourceGoverned,
    target: targetGoverned,
    lo,
    hi,
  });
};

/** Gap left when refusing a landing — must exceed COLLAPSE_EPS to stick. */
const LANDING_GAP = 0.6;

/**
 * Nudges `shift` off the value that would drop a moved vertex onto a stub
 * point, keeping a hair of separation so no segment collapses (#85). The gap
 * is sub-pixel, so the line still reads as stopping there.
 */
const avoidStubLanding = (
  points: Point[],
  index: number,
  normal: Point,
  shift: number,
  stubEnds: { source: Point; target: Point },
  governed: { source: boolean; target: boolean; lo: number; hi: number },
): number => {
  // grabbing without moving must not shove a chain that already sits on a
  // landing point — same reason the clamp caps its bounds at the current
  // position. Any real drag, however small, is fair game.
  if (Math.abs(shift) < 1e-9) return shift;
  const moved = [points[index]!, points[index + 1]!];
  let out = shift;
  const ends: [Point | null, Point][] = [
    [governed.source ? null : stubEnds.source, points[0]!],
    [governed.target ? null : stubEnds.target, points[points.length - 1]!],
  ];
  for (const [stub, end] of ends) {
    if (!stub) continue;
    // an anchor's "stub" is the endpoint itself — nothing to collapse onto,
    // and the clamp exempts it too. Touching boxes shrink to zero the same
    // way (#86), so this is no longer an anchors-only path.
    if (Math.hypot(stub.x - end.x, stub.y - end.y) === 0) continue;
    for (const from of moved) {
      // shift that lands `from` exactly on the stub, if one exists: the move
      // is along `normal`, so both axes must agree on it
      const along = (stub.x - from.x) * normal.x + (stub.y - from.y) * normal.y;
      const landed = { x: from.x + normal.x * along, y: from.y + normal.y * along };
      if (Math.hypot(landed.x - stub.x, landed.y - stub.y) > COLLAPSE_EPS) continue;
      if (Math.abs(out - along) > COLLAPSE_EPS) continue;
      // step off the landing point itself — reflecting about anything else
      // can drop the result back inside the collapse window. Prefer the side
      // the drag came from; fall back to the other when a clamp limit blocks
      // it, and to the limit itself when both are blocked.
      const near = along + (out >= along ? LANDING_GAP : -LANDING_GAP);
      const far = along + (out >= along ? -LANDING_GAP : LANDING_GAP);
      out =
        near >= governed.lo && near <= governed.hi
          ? near
          : far >= governed.lo && far <= governed.hi
            ? far
            : out;
    }
  }
  return out;
};

/** Midpoints of each polyline segment (used for waypoint insertion handles). */
export const segmentMidpoints = (points: Point[]): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push({
      x: (points[i]!.x + points[i + 1]!.x) / 2,
      y: (points[i]!.y + points[i + 1]!.y) / 2,
    });
  }
  return out;
};
