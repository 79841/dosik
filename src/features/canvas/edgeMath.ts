import type { Point } from "../../shared/lib/edgeGeometry";
import type { EdgeVariant } from "../../shared/lib/types";

export const DASH: Record<EdgeVariant, string | undefined> = {
  solid: undefined,
  dashed: "6 5",
  dotted: "1.5 5",
  dashdot: "9 4 1.5 4",
};

export const polylineLength = (points: Point[]): number => {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
  }
  return total;
};

/** Index of the chain segment closest to a point. */
export const nearestSegmentIndex = (chain: Point[], p: Point): number => {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t =
      lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
    const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
};
