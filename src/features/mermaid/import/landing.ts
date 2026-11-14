import { boxAround, clearOf, type LayoutDirection } from "../../../shared/lib/autoLayout";
import { nodeBounds } from "../../../shared/lib/edgeUtils";
import type { ClipboardFragment } from "../../../shared/lib/store/clipboard";
import type { DiagramNode } from "../../../shared/lib/types";

/**
 * How far to move a built diagram so it lands where the user is looking
 * (#200 D5): centred on the view, then pushed along its axis — down for a
 * vertical diagram (TB, BT), right for a horizontal one — until its whole box touches
 * nothing already on the page. The whole box, not each shape: a shape left in
 * a gap of the new diagram ends up wired through by its lines. A frame is an
 * obstacle too: landing inside one would make the new shapes its contents.
 */
export const landingDelta = (
  fragment: ClipboardFragment,
  center: { x: number; y: number },
  page: DiagramNode[],
  direction: LayoutDirection,
): { dx: number; dy: number } => {
  if (fragment.nodes.length === 0) return { dx: 0, dy: 0 };
  const block = boxAround(fragment.nodes.map(nodeBounds));
  const dx = Math.round(center.x - (block.x + block.width / 2));
  const dy = Math.round(center.y - (block.y + block.height / 2));
  const avoid = page.filter((n) => n.data.shape !== "anchor").map(nodeBounds);
  const shift = clearOf(
    [{ box: { ...block, x: block.x + dx, y: block.y + dy }, avoid }],
    direction,
  );
  return { dx: dx + shift.x, dy: dy + shift.y };
};
