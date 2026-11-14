import { classNodeHeight, classNodeWidth } from "./classShape";
import { entityNodeHeight, entityNodeWidth } from "./entityShape";
import { IMAGE_NODE_MIN } from "./imageData";
import { ICON_LABEL_H, ICON_MIN_GLYPH_H } from "./palette";
import type { ShapeNodeData } from "./types";

/**
 * The smallest a shape may be resized to — the node's own resizer and a
 * group resize (#179) share it, so shrinking a group never squeezes a member
 * under what its own handles allow. A class or entity box may not get
 * narrower or shorter than its text; an icon keeps room for glyph and label.
 */
export const resizeFloor = (data: ShapeNodeData): { width: number; height: number } => {
  switch (data.shape) {
    case "class":
      return { width: classNodeWidth(data, 0), height: classNodeHeight(data) };
    case "entity":
      return { width: entityNodeWidth(data, 0), height: entityNodeHeight(data.columns) };
    case "lifeline":
      return { width: 80, height: 120 };
    case "icon":
      return { width: 40, height: ICON_MIN_GLYPH_H + ICON_LABEL_H };
    case "image":
      return { width: IMAGE_NODE_MIN, height: IMAGE_NODE_MIN };
    default:
      return { width: 40, height: 28 };
  }
};
