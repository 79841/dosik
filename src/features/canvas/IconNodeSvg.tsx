import { IconGlyph } from "../../shared/lib/icons";
import {
  ICON_GLYPH_RATIO,
  ICON_LABEL_H,
  ICON_MIN_GLYPH_H,
  SHAPE_STROKE_WIDTH,
} from "../../shared/lib/palette";

/**
 * An architecture icon node (#9): the bare glyph, no surrounding box — the
 * user rejected a pastel frame around it. The label is drawn *below* the
 * glyph by `ShapeNode` (not inside, as every other shape does), so the glyph
 * takes the area above the label line and is centred in it.
 */
export const IconNodeSvg = ({
  icon,
  width: w,
  height: h,
  stroke,
}: {
  icon: string;
  width: number;
  height: number;
  stroke: string;
}) => {
  const areaH = Math.max(ICON_MIN_GLYPH_H, h - ICON_LABEL_H);
  const glyph = Math.min(w, areaH) * ICON_GLYPH_RATIO;
  return (
    <IconGlyph
      icon={icon}
      size={glyph}
      color={stroke}
      x={(w - glyph) / 2}
      y={(areaH - glyph) / 2}
      strokePx={SHAPE_STROKE_WIDTH}
    />
  );
};
