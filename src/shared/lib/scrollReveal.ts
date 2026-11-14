/**
 * A strip that scrolls sideways when what it holds does not fit — the
 * document tabs in the band (#218 D13). Pure, so the arithmetic is testable
 * without layout.
 */

/**
 * The `scrollLeft` that brings an item at `left`…`left + width` into a view
 * `viewWidth` wide, whose first `sticky` px are covered by something pinned
 * there (the Home tab). Only the scroll position moves — `scrollIntoView`
 * would scroll every overflow-hidden ancestor too.
 */
export const revealScroll = (
  scrollLeft: number,
  viewWidth: number,
  left: number,
  width: number,
  sticky = 0,
): number => {
  if (left < scrollLeft + sticky) return Math.max(0, left - sticky);
  if (left + width > scrollLeft + viewWidth) return Math.max(0, left + width - viewWidth);
  return scrollLeft;
};

/** which ends of a scrolled strip are hidden — and fade out */
export type ScrollFade = "none" | "left" | "right" | "both";

export const scrollFade = (
  overflow: boolean,
  scrollLeft: number,
  viewWidth: number,
  contentWidth: number,
): ScrollFade => {
  if (!overflow) return "none";
  const atStart = scrollLeft <= 0;
  // a fractional scroll position a hair short of the end is the end
  const atEnd = scrollLeft + viewWidth >= contentWidth - 1;
  if (atStart) return "right";
  return atEnd ? "left" : "both";
};
