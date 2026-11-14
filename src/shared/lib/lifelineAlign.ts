import { nodeBounds } from "./edgeUtils";
import type { DiagramNode } from "./types";

/** Position patches an align action should apply; only nodes that move appear. */
export interface AlignPatch {
  id: string;
  x?: number;
  y?: number;
}

/**
 * Pulls every lifeline's header up to the topmost one.
 *
 * Pure so the rule is testable without a store — the caller applies the patches
 * and re-snaps messages afterwards.
 */
export const alignTops = (nodes: DiagramNode[]): AlignPatch[] => {
  if (nodes.length < 2) return [];
  const top = Math.min(...nodes.map((n) => n.position.y));
  return nodes.filter((n) => n.position.y !== top).map((n) => ({ id: n.id, y: top }));
};

/**
 * Spreads the middle lifelines evenly between the outermost two, measuring gaps
 * edge-to-edge so differing widths don't bunch them up. The two ends stay put.
 */
export const distributeEvenly = (nodes: DiagramNode[]): AlignPatch[] => {
  if (nodes.length < 3) return [];
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [];

  const totalWidth = sorted.reduce((sum, n) => sum + nodeBounds(n).width, 0);
  const span = last.position.x + nodeBounds(last).width - first.position.x;
  const gap = (span - totalWidth) / (sorted.length - 1);

  const patches: AlignPatch[] = [];
  let cursor = first.position.x + nodeBounds(first).width + gap;
  for (const n of sorted.slice(1, -1)) {
    const x = Math.round(cursor);
    if (n.position.x !== x) patches.push({ id: n.id, x });
    cursor += nodeBounds(n).width + gap;
  }
  return patches;
};
