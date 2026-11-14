/**
 * Corner radius, in diagram px, of the shapes drawn with rounded corners. The
 * canvas, the palette previews and the vector SVG all read it, so an export is
 * no rounder than the canvas. Studio tiles (#210): a rect softens to 6, a
 * rounded box to 14 (never past half its height), frames and fragments to 10.
 */
export const CORNER_RADIUS = {
  rect: 6,
  rounded: 14,
  sticky: 4,
  fragment: 10,
  lifeline: 6,
  frame: 10,
  /** a class or entity card */
  card: 6,
} as const;
