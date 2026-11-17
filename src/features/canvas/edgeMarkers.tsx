import { THEME_CANVAS_BG } from "../../shared/lib/palette";
import type { MarkerShape, MarkerSize } from "../../shared/lib/types";

export const MARKER_PX: Record<MarkerSize, number> = { sm: 8, md: 11, lg: 15 };

/** Where the line tip sits inside each marker's 10x10 viewBox. */
export const MARKER_REF_X: Record<MarkerShape, number> = {
  none: 0,
  arrow: 8.5,
  open: 8.2,
  circle: 5,
  diamond: 8.8,
  bar: 5,
  many: 8.5,
  triangle: 9.2,
  "diamond-open": 8.8,
  // crow's-foot ends are drawn in a 20-wide box (MARKER_VIEW_W) with the tip at its right edge
  one: 19.5,
  "zero-one": 19.5,
  "one-many": 19.5,
  "zero-many": 19.5,
};

/**
 * Width of each marker's viewBox. The UML heads fit a 10×10 square; a
 * crow's-foot end carries a bar or a ring *and* the feet, so it gets twice the
 * length along the line (#5). The drawn size scales with it — the height stays
 * the marker size, the length doubles.
 */
export const MARKER_VIEW_W: Partial<Record<MarkerShape, number>> = {
  one: 20,
  "zero-one": 20,
  "one-many": 20,
  "zero-many": 20,
};

/**
 * The heads with a hollow body — the ones `MarkerGlyph` fills with `hollow`.
 * A drawing on no background cuts these bodies out of the line instead (#255).
 */
export const HOLLOW_MARKERS: ReadonlySet<MarkerShape> = new Set<MarkerShape>([
  "triangle",
  "diamond-open",
  "zero-one",
  "zero-many",
]);

/**
 * `hollow` fills the open shapes (circle, diamond-open, …) so the line does not
 * show through them. The canvas passes nothing and gets the live theme
 * variable; a file written outside the app passes the concrete background,
 * because a variable means nothing there (#148), or `none` when it has no
 * background and cuts the line under the head instead (#255).
 */
export const MarkerGlyph = ({
  shape,
  color,
  hollow = THEME_CANVAS_BG,
}: {
  shape: MarkerShape;
  color: string;
  hollow?: string;
}) => {
  switch (shape) {
    case "arrow":
      return <path d="M 1.5 1.5 L 8.5 5 L 1.5 8.5 Z" fill={color} stroke="none" />;
    case "open":
      return (
        <path
          d="M 2 1.8 L 8.2 5 L 2 8.2"
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "circle":
      return <circle cx={5} cy={5} r={3.2} fill={color} stroke="none" />;
    case "diamond":
      return <path d="M 5 1.2 L 8.8 5 L 5 8.8 L 1.2 5 Z" fill={color} stroke="none" />;
    // Hollow UML heads are filled with the canvas colour rather than "none":
    // the marker's refX sits at the tip, so an unfilled body would show the
    // line running straight through it.
    case "triangle":
      return (
        <path
          d="M 9.2 5 L 1.4 1.1 L 1.4 8.9 Z"
          fill={hollow}
          stroke={color}
          strokeWidth={0.95}
          strokeLinejoin="round"
        />
      );
    case "diamond-open":
      return (
        <path
          d="M 5 1.2 L 8.8 5 L 5 8.8 L 1.2 5 Z"
          fill={hollow}
          stroke={color}
          strokeWidth={0.95}
          strokeLinejoin="round"
        />
      );
    case "bar":
      return <rect x={4.2} y={1.2} width={1.6} height={7.6} fill={color} stroke="none" />;
    // Crow's-foot ends (#5). The tip (x = 19.5) touches the entity; feet
    // spread *at* the entity and meet away from it, the way ERD notation reads.
    // Bars and rings sit further out along the line.
    case "one":
      return (
        <path
          d="M 12 1.5 L 12 8.5 M 15.5 1.5 L 15.5 8.5"
          stroke={color}
          strokeWidth={1.05}
          fill="none"
        />
      );
    case "zero-one":
      return (
        <>
          <path d="M 15.5 1.5 L 15.5 8.5" stroke={color} strokeWidth={1.05} fill="none" />
          <circle cx={8.5} cy={5} r={2.8} fill={hollow} stroke={color} strokeWidth={0.95} />
        </>
      );
    case "one-many":
      return (
        <path
          d="M 19.5 1.2 L 12.5 5 L 19.5 8.8 M 19.5 5 L 12.5 5 M 10 1.5 L 10 8.5"
          stroke={color}
          strokeWidth={1.05}
          fill="none"
          strokeLinejoin="round"
        />
      );
    case "zero-many":
      return (
        <>
          <path
            d="M 19.5 1.2 L 12.5 5 L 19.5 8.8 M 19.5 5 L 12.5 5"
            stroke={color}
            strokeWidth={1.05}
            fill="none"
            strokeLinejoin="round"
          />
          <circle cx={7.5} cy={5} r={2.8} fill={hollow} stroke={color} strokeWidth={0.95} />
        </>
      );
    case "many":
      return (
        <path
          d="M 8.5 5 L 1.5 1.2 M 8.5 5 L 1.2 5 M 8.5 5 L 1.5 8.8"
          fill="none"
          stroke={color}
          strokeWidth={1.05}
          strokeLinecap="round"
        />
      );
    default:
      return null;
  }
};

/** Per-edge inline SVG marker definition, colored to match the edge stroke. */
export const EdgeMarkerDef = ({
  id,
  shape,
  color,
  size,
  hollow,
}: {
  id: string;
  shape: MarkerShape;
  color: string;
  size: MarkerSize;
  hollow?: string;
}) => {
  if (shape === "none") return null;
  const px = MARKER_PX[size];
  const viewW = MARKER_VIEW_W[shape] ?? 10;
  return (
    <marker
      id={id}
      viewBox={`0 0 ${viewW} 10`}
      refX={MARKER_REF_X[shape]}
      refY={5}
      markerWidth={(px * viewW) / 10}
      markerHeight={px}
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <MarkerGlyph shape={shape} color={color} hollow={hollow} />
    </marker>
  );
};
