import { textWidth } from "./textLayout";

/**
 * An edge label — `LabelPill`: a canvas-coloured patch `rounded-[2px]
 * px-[5px]` under `text-[11px] font-medium`, inherited line-height 1.5, no
 * border (#210 D7). The vector SVG draws it at this size, and the auto layout
 * leaves this much room for it along the line (#202): one measure, so a label
 * never covers the line it names.
 */
export const PILL = {
  fontSize: 11,
  fontWeight: 500,
  padX: 5,
  padY: 0,
  border: 0,
  lineHeight: 16.5,
  /** `rounded-[2px]` */
  radius: 2,
} as const;

export const pillSize = (text: string): { width: number; height: number } => ({
  width: textWidth(text, PILL.fontSize) + (PILL.padX + PILL.border) * 2,
  height: PILL.lineHeight + (PILL.padY + PILL.border) * 2,
});
