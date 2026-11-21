import { alignFacingEnds, type EdgeEndpoint, type Rect, type SideSpan } from "./edgeGeometry";
import { handlePointOnNode, nodeBounds } from "./edgeUtils";
import { isBackdrop } from "./palette";
import {
  ATTACH_MIN_GAP,
  ATTACH_SPACING,
  attachRange,
  handleRatio,
  parseSide,
  type Side,
  sideHandle,
  sideLength,
} from "./sideAttach";
import type { DiagramEdge, DiagramEdgeData, DiagramNode, ShapeKind } from "./types";

/** one end of one edge */
export interface EdgeEndRef {
  edgeId: string;
  end: "source" | "target";
}

/** Shapes whose ends sit on a side and can be spread along it. */
export const spreadsOnSides = (shape: ShapeKind): boolean =>
  shape !== "anchor" && shape !== "lifeline" && !isBackdrop(shape);

interface Slot {
  edgeIndex: number;
  end: "source" | "target";
  node: DiagramNode;
  side: Side;
  /** where the other end's shape is along this side's axis — the order to keep */
  order: number;
  /** px from the side's start */
  pos: number;
  movable: boolean;
}

const before = (a: Pick<Slot, "order" | "edgeIndex">, b: Pick<Slot, "order" | "edgeIndex">) =>
  a.order < b.order || (a.order === b.order && a.edgeIndex < b.edgeIndex);

/** `n` new ends on a side nobody else uses: 16px apart around the middle, or evenly when that does not fit. */
const spread = (n: number, len: number, range: { min: number; max: number }): number[] => {
  const mid = Math.min(Math.max(len / 2, range.min), range.max);
  if (n === 1) return [mid];
  const total = ATTACH_SPACING * (n - 1);
  if (mid - total / 2 >= range.min && mid + total / 2 <= range.max) {
    return Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * ATTACH_SPACING);
  }
  return Array.from({ length: n }, (_, i) => range.min + ((range.max - range.min) * i) / (n - 1));
};

/** `k` ends in `[lo, hi]`, packed 16px apart as near `mid` as they fit, else spread evenly. */
const packNear = (k: number, lo: number, hi: number, mid: number): number[] => {
  const width = ATTACH_SPACING * (k - 1);
  if (hi - lo >= width) {
    const centre = Math.min(Math.max(mid, lo + width / 2), hi - width / 2);
    return Array.from({ length: k }, (_, i) => centre + (i - (k - 1) / 2) * ATTACH_SPACING);
  }
  if (k === 1) return [(lo + hi) / 2];
  return Array.from({ length: k }, (_, i) => lo + ((hi - lo) * i) / (k - 1));
};

/**
 * New ends joining a side that already holds ends. Those stay where they are
 * (#204 D7). The new ends that fall between the same two neighbours — by the
 * order that keeps lines from crossing — are placed together in that gap, a
 * spacing clear of the neighbours and as near the middle as they fit. A gap
 * with no room left gives up the order: each of its ends goes where it is
 * farthest from the ends already there, never onto a neighbour.
 */
const fitAmong = (
  moving: Slot[],
  fixed: Slot[],
  len: number,
  range: { min: number; max: number },
): number[] => {
  const mid = Math.min(Math.max(len / 2, range.min), range.max);
  const gaps = new Map<string, { lb: number; ub: number; members: number[] }>();
  moving.forEach((m, i) => {
    const lb = Math.max(-Infinity, ...fixed.filter((f) => before(f, m)).map((f) => f.pos));
    const ub = Math.min(Infinity, ...fixed.filter((f) => !before(f, m)).map((f) => f.pos));
    const key = `${lb}\u0000${ub}`;
    const gap = gaps.get(key) ?? { lb, ub, members: [] };
    gap.members.push(i);
    gaps.set(key, gap);
  });
  const out = new Array<number>(moving.length);
  const taken = fixed.map((f) => f.pos);
  const crowded: number[][] = [];
  for (const { lb, ub, members } of gaps.values()) {
    const lo = Math.max(range.min, lb + ATTACH_SPACING);
    const hi = Math.min(range.max, ub - ATTACH_SPACING);
    // a gap that cannot hold its ends apart — none at all, or so narrow they
    // would touch — goes to the crowded rule, which never stacks two ends
    const apart = members.length === 1 || (hi - lo) / (members.length - 1) >= ATTACH_MIN_GAP;
    if (hi < lo || !apart) {
      crowded.push(members);
      continue;
    }
    packNear(members.length, lo, hi, mid).forEach((pos, j) => {
      out[members[j]!] = pos;
      taken.push(pos);
    });
  }
  for (const members of crowded) {
    // one at a time, each where it is farthest from everything already there —
    // between two ends, or at an end of the usable stretch
    for (const index of members) {
      const marks = [...taken].sort((a, b) => a - b);
      const candidates = [range.min, range.max];
      for (let i = 1; i < marks.length; i += 1) candidates.push((marks[i - 1]! + marks[i]!) / 2);
      const clearance = (c: number) => Math.min(...marks.map((m) => Math.abs(c - m)));
      const pos = candidates
        .filter((c) => c >= range.min && c <= range.max)
        .reduce((best, c) =>
          clearance(c) > clearance(best) + 1e-6 ||
          (Math.abs(clearance(c) - clearance(best)) <= 1e-6 &&
            Math.abs(c - mid) < Math.abs(best - mid))
            ? c
            : best,
        );
      out[index] = pos;
      taken.push(pos);
    }
  }
  return out;
};

/**
 * Places the given edge ends along their sides (#204 D6–D8) and stores the
 * spots as `side-<pct>` handles. Only the side is read from the handle — the
 * caller has already picked it. Ends that are not listed are never moved.
 * Self-loops, sequence messages and ends on anchors, lifelines and backdrops
 * are left alone.
 */
export const placeEnds = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  movable: EdgeEndRef[],
): DiagramEdge[] => {
  if (movable.length === 0) return edges;
  const wanted = new Set(movable.map((m) => `${m.edgeId}\u0000${m.end}`));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map<string, Slot[]>();
  edges.forEach((e, edgeIndex) => {
    if (e.source === e.target) return;
    const source = byId.get(e.source);
    const target = byId.get(e.target);
    // a message's ends are on lifelines or anchors, which `spreadsOnSides` skips
    if (!source || !target) return;
    for (const end of ["source", "target"] as const) {
      const node = end === "source" ? source : target;
      if (!spreadsOnSides(node.data.shape)) continue;
      const handle = end === "source" ? e.sourceHandle : e.targetHandle;
      const side = parseSide(handle);
      if (!side) continue;
      const other = nodeBounds(end === "source" ? target : source);
      const b = nodeBounds(node);
      const vertical = side === "left" || side === "right";
      const slot: Slot = {
        edgeIndex,
        end,
        node,
        side,
        order: vertical ? other.y + other.height / 2 : other.x + other.width / 2,
        pos: handleRatio(handle) * sideLength(b, side),
        movable: wanted.has(`${e.id}\u0000${end}`),
      };
      const key = `${node.id}\u0000${side}`;
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    }
  });

  const out = [...edges];
  let changed = false;
  for (const slots of groups.values()) {
    const moving = slots
      .filter((s) => s.movable)
      .sort((a, b) => a.order - b.order || a.edgeIndex - b.edgeIndex);
    if (moving.length === 0) continue;
    const fixed = slots.filter((s) => !s.movable);
    const { node, side } = moving[0]!;
    const b = nodeBounds(node);
    const len = sideLength(b, side);
    const range = attachRange(node.data.shape, b, side);
    const spots =
      fixed.length === 0 ? spread(moving.length, len, range) : fitAmong(moving, fixed, len, range);
    moving.forEach((slot, i) => {
      const handle = sideHandle(side, len > 0 ? spots[i]! / len : 0.5);
      const edge = out[slot.edgeIndex]!;
      const key = slot.end === "source" ? "sourceHandle" : "targetHandle";
      if (edge[key] === handle) return;
      out[slot.edgeIndex] = { ...edge, [key]: handle };
      changed = true;
    });
  }
  return changed ? out : edges;
};

/** Both ends of each listed edge. */
export const bothEnds = (edgeIds: Iterable<string>): EdgeEndRef[] =>
  [...edgeIds].flatMap((edgeId) => [
    { edgeId, end: "source" as const },
    { edgeId, end: "target" as const },
  ]);

type EdgeEnds = Pick<DiagramEdge, "id" | "source" | "target" | "sourceHandle" | "targetHandle">;

/**
 * Whether each end of `edge` is the only line end on its side of its shape.
 * An end that shares its side is spread along it with the others (D6–D8), so
 * `drawnEnds` never slides it.
 */
export const soleOnSide = (
  edge: EdgeEnds,
  edges: DiagramEdge[],
): { source: boolean; target: boolean } => {
  const alone = (nodeId: string, handle: string | null | undefined): boolean => {
    const side = parseSide(handle);
    if (!side) return false;
    return !edges.some(
      (e) =>
        e.id !== edge.id &&
        ((e.source === nodeId && parseSide(e.sourceHandle) === side) ||
          (e.target === nodeId && parseSide(e.targetHandle) === side)),
    );
  };
  return {
    source: alone(edge.source, edge.sourceHandle),
    target: alone(edge.target, edge.targetHandle),
  };
};

/**
 * The stretch an end may slide along to straighten its line (#257), or
 * undefined where it stays put. Only an auto end slides: the bare side, alone
 * on it. A `-<pct>` end was put where it is — by hand (D3) or spread among
 * others (D6) — and keeps its spot.
 */
const slideSpan = (
  node: DiagramNode,
  handle: string | null | undefined,
  sole: boolean,
): SideSpan | undefined => {
  const side = parseSide(handle);
  if (!sole || !side || handle !== side) return undefined;
  const b = nodeBounds(node);
  const { min, max } = attachRange(node.data.shape, b, side);
  const origin = side === "left" || side === "right" ? b.y : b.x;
  return { min: origin + min, max: origin + max };
};

/**
 * Where a line's two ends are drawn: where their handles put them, except on
 * an orthogonal line with no bends of its own between two shapes whose ends
 * sit on sides. There an auto end slides along its side so two facing sides
 * that overlap are joined by one straight line instead of a short step
 * (#257). Decided at drawing time from the stored handles, which do not
 * change — saved diagrams straighten as well. `obstacles` are the router's.
 */
export const drawnEnds = (
  edge: EdgeEnds & { data?: Partial<DiagramEdgeData> },
  source: DiagramNode,
  target: DiagramNode,
  sole: { source: boolean; target: boolean },
  obstacles: Rect[],
): { source: EdgeEndpoint; target: EdgeEndpoint } => {
  const ends = {
    source: handlePointOnNode(source, edge.sourceHandle),
    target: handlePointOnNode(target, edge.targetHandle),
  };
  if (
    source.id === target.id ||
    (edge.data?.pathStyle ?? "orthogonal") !== "orthogonal" ||
    (edge.data?.waypoints?.length ?? 0) > 0 ||
    !spreadsOnSides(source.data.shape) ||
    !spreadsOnSides(target.data.shape)
  ) {
    return ends;
  }
  return alignFacingEnds(
    ends.source,
    ends.target,
    {
      source: slideSpan(source, edge.sourceHandle, sole.source),
      target: slideSpan(target, edge.targetHandle, sole.target),
    },
    obstacles,
  );
};
