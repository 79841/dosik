import { type RefObject, useLayoutEffect, useState } from "react";

/** breathing room between a popup and the window edge */
export const POPUP_MARGIN = 8;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * Where a popup opened at `anchor` goes so it stays on screen (#142).
 *
 * Per axis: open at the anchor when it fits; otherwise flip to the other side
 * of the anchor, the way native context menus do, so the menu never lands on
 * top of the point that opened it; and when neither side fits, push it inside
 * the window. A popup larger than the window pins to the top/left edge — its
 * first items are the ones that must stay reachable.
 */
export const placePopup = (
  anchor: Point,
  size: Size,
  view: Size,
): { left: number; top: number } => {
  const axis = (at: number, extent: number, room: number): number => {
    if (at + extent + POPUP_MARGIN <= room) return Math.max(at, POPUP_MARGIN);
    if (at - extent >= POPUP_MARGIN) return at - extent;
    return Math.max(POPUP_MARGIN, room - extent - POPUP_MARGIN);
  };
  return {
    left: axis(anchor.x, size.width, view.width),
    top: axis(anchor.y, size.height, view.height),
  };
};

/**
 * The `left/top` for a `fixed` popup anchored at a client point.
 *
 * Every cursor-anchored popup shares this, the same way they share
 * `useOutsideDismiss`: the three menus each set `left/top` from the raw point,
 * so each one overflowed the window on its own (#142). The measurement runs in
 * a layout effect, so the corrected position lands before the first paint —
 * the menu never flashes at the unclamped spot.
 */
export const usePopupPosition = (
  ref: RefObject<HTMLElement | null>,
  /** `null` while the popup is closed — hooks run on every render either way */
  anchor: Point | null,
): { left: number; top: number } => {
  const open = anchor !== null;
  const x = anchor?.x ?? 0;
  const y = anchor?.y ?? 0;
  const [placed, setPlaced] = useState({ left: x, top: y });

  // `open` is a dependency of its own: reopening at the very same point must
  // measure again, because the element is new
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const el = ref.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const next = placePopup(
        { x, y },
        { width, height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPlaced((prev) => (prev.left === next.left && prev.top === next.top ? prev : next));
    };
    place();
    // A resize moves the shape under the anchor, so the point no longer means
    // what it did — a native menu would close. Re-placing keeps the menu usable
    // instead of cut off, which is the defect this hook exists for (#142).
    window.addEventListener("resize", place);
    // content can grow after opening (a submenu, a late-loading label)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [ref, open, x, y]);

  return placed;
};
