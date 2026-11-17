import type { ReactNode } from "react";

/** a mask is luminance, not colour: black cuts… */
export const CUT = "#000";
/** …and white keeps */
export const KEEP = "#fff";

export interface MaskArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A mask that keeps everything in `area` but the holes drawn in `CUT` as its
 * children. A drawing on no background cuts with these where the canvas lays
 * a patch of its own colour — under a label, inside a hollow head, round a
 * badge — since such a patch shows on a page of any other colour (#255).
 */
export const CutMask = ({
  id,
  area,
  children,
}: {
  id: string;
  area: MaskArea;
  children: ReactNode;
}) => (
  <mask
    id={id}
    maskUnits="userSpaceOnUse"
    x={area.x}
    y={area.y}
    width={area.width}
    height={area.height}
  >
    <rect x={area.x} y={area.y} width={area.width} height={area.height} fill={KEEP} />
    {children}
  </mask>
);
