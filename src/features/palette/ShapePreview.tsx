import { THEME_COLOR_TOKENS, THEME_INK, THUMBNAIL_PAINT } from "../../shared/lib/palette";
import type { ShapeKind } from "../../shared/lib/types";
import { IconGlyph } from "../../shared/lib/icons";
import { ShapeSvg } from "../canvas/ShapeNode";

/** Palette and inspector thumbnails are drawn in the default mono, not the node colour. */
export const PREVIEW_COLOR = THEME_COLOR_TOKENS.mono;

/**
 * A shape at thumbnail size, shared by the palette rail and the inspector so a
 * shape is recognisable in both. `ShapeSvg` sizes its details from the box, so
 * the small render is the same drawing, not a separate icon that can drift.
 */
export const ShapePreview = ({
  shape,
  width = 36,
  height = 24,
}: {
  shape: ShapeKind;
  width?: number;
  height?: number;
}) => {
  if (shape === "text") {
    // decorative in both consumers: the palette has its own label and the
    // inspector has the select, so a screen reader must not read this "T" too
    return (
      <span
        aria-hidden="true"
        className="text-[13px] font-bold"
        // on the panel, not a tile: the page's ink (a tile's label stays dark in dark, #216)
        style={{ color: THEME_INK }}
      >
        T
      </span>
    );
  }
  if (shape === "icon") {
    // the group's rail thumbnail: one representative glyph at thumbnail size
    const size = Math.min(width, height);
    return (
      <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
        <IconGlyph
          icon="database"
          size={size}
          color={PREVIEW_COLOR.stroke}
          x={(width - size) / 2}
          y={(height - size) / 2}
        />
      </svg>
    );
  }
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <ShapeSvg shape={shape} width={width} height={height} {...THUMBNAIL_PAINT} />
    </svg>
  );
};
