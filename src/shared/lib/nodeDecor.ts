import { BORDER_TITLE } from "./palette";
import { cylinderCapRy, hexagonCut, parallelogramSkew } from "./sideAttach";
import { textWidth } from "./textLayout";
import type { ShapeKind } from "./types";

/**
 * Box decorations (#160): an icon, a badge and a description. In the Studio
 * style (#210) the icon sits above the label (beside it in a short box), the
 * badge is a tag in the top-left corner — a step circle on the top-right when it
 * is a number —
 * and the description runs under the label. One place says which shapes take
 * them, how long the text may be and where each piece goes — the bridge, the
 * file loader, the edit bar and every renderer read it from here.
 */

/** shapes that are a box around a label — the ones a decoration makes sense on */
export const DECOR_SHAPES: readonly ShapeKind[] = [
  "rect",
  "rounded",
  "ellipse",
  "diamond",
  "parallelogram",
  "cylinder",
  "hexagon",
  "sticky",
];

export const takesDecor = (shape: ShapeKind): boolean => DECOR_SHAPES.includes(shape);

/** `icon` is the glyph of an icon node and the decoration of a box (#160 D1) */
export const keepsIcon = (shape: ShapeKind): boolean => shape === "icon" || takesDecor(shape);

/**
 * Whether a box lays its label out piece by piece — an icon with it or a
 * description under it (#210). A badge sits in its corner and leaves the label
 * where it always was. The canvas and the vector SVG both branch on this one
 * test (#160).
 */
export const hasInlineDecor = (data: {
  shape: ShapeKind;
  icon?: string;
  description?: string;
}): boolean => takesDecor(data.shape) && (Boolean(data.description) || Boolean(data.icon));

/** the shapes that take a badge: the boxes, and a frame — its step number (#210 D23) */
export const takesBadge = (shape: ShapeKind): boolean => takesDecor(shape) || shape === "frame";

/** whether a node draws a badge in its corner */
export const hasBadge = <T extends { shape: ShapeKind; badge?: string }>(
  data: T,
): data is T & { badge: string } => takesBadge(data.shape) && Boolean(data.badge);

/** a badge of one to three digits is a step number — drawn as a circle on the corner (#210 D23) */
export const isStepBadge = (badge: string | undefined): boolean =>
  badge !== undefined && /^\d{1,3}$/.test(badge);

/** where a box's icon goes: above the label, or beside it in a box too short to stack (#210 D6) */
export const iconPlacement = (height: number): "above" | "left" =>
  height >= DECOR.iconAboveMinHeight ? "above" : "left";

export const MAX_BADGE = 16;
export const MAX_DESCRIPTION = 300;

/** a usable badge, or `undefined` — trimmed, never blank, at most MAX_BADGE characters */
export const sanitizeBadge = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? [...text].slice(0, MAX_BADGE).join("") : undefined;
};

/** a usable description, or `undefined` — line breaks kept, ends trimmed, at most MAX_DESCRIPTION */
export const sanitizeDescription = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? [...text].slice(0, MAX_DESCRIPTION).join("") : undefined;
};

/**
 * Numbers the canvas (Tailwind classes in `ShapeNode`) and the renderers
 * (vector SVG) share. `features/export/__tests__/nodeDecor.test.ts` ties them to the classes.
 */
export const DECOR = {
  /** `text-[11px] leading-snug`, `gap-0.5` under the label, `opacity-65` */
  descriptionFontSize: 11,
  descriptionLineHeight: 11 * 1.375,
  descriptionGap: 2,
  descriptionOpacity: 0.65,
  /**
   * above the label: `h-6 w-6 mb-1` in the `gap-0.5` stack — 6px to the label. A
   * touch larger than the mockup's 20 so the glyph holds the tile (user, 2026-10-26)
   */
  iconSize: 24,
  /** beside the label in a short box: `h-[18px] w-[18px]`, `gap-1.5` to the label */
  iconSizeInline: 18,
  iconGap: 6,
  /** the glyph's line on screen — a touch heavier than a 1px rule so it holds the tile */
  iconStrokePx: 1.5,
  /** a box this tall stacks its icon above the label */
  iconAboveMinHeight: 64,
  /** the badge tag: `text-[9.5px] font-semibold uppercase`, `h-[15px] px-[5px] rounded-[3px]`, 7px in from the top-left */
  tagFontSize: 9.5,
  tagPadX: 5,
  tagHeight: 15,
  tagInset: 7,
  tagRadius: 3,
  /** a step badge: a 20px circle on the top-right corner, `text-[11px] font-bold` */
  stepRadius: 10,
  stepFontSize: 11,
  /** the canvas-coloured ring round a step circle, so it reads on an ink tile too */
  stepRing: 2,
} as const;

/**
 * Where a step circle sits on a node `w` × `h` (#210): the top-right
 * corner of a box, a frame or a parallelogram — or, on a curved or cut shape,
 * the point of the outline nearest that corner, so it does not float past it.
 */
export const stepAnchor = (shape: ShapeKind, w: number, h: number): { x: number; y: number } => {
  switch (shape) {
    case "ellipse":
      return { x: (w / 2) * (1 + Math.SQRT1_2), y: (h / 2) * (1 - Math.SQRT1_2) };
    case "diamond":
      return { x: w * 0.75, y: h * 0.25 };
    case "hexagon":
      return { x: w - hexagonCut(w), y: 0 };
    case "cylinder": {
      // on the lid's rim, which is an ellipse
      const ry = cylinderCapRy(h);
      return { x: (w / 2) * (1 + Math.SQRT1_2), y: ry * (1 - Math.SQRT1_2) };
    }
    default:
      return { x: w, y: 0 };
  }
};

/** a badge tag's width: its upper-cased text and padding — the font is monospace, so the canvas agrees */
export const tagWidth = (badge: string): number =>
  textWidth(badge.toUpperCase(), DECOR.tagFontSize) + DECOR.tagPadX * 2;

/** the room a tag keeps from a curved or slanted outline */
const TAG_MARGIN = 3.5;

/**
 * Where a badge tag `tagW` wide sits on a `shape` node `w` × `h`: its top-left
 * corner (#210 D7). Always inside the silhouette, where no line ends —
 * a tag on the outline would cover the ends that land there: in the top-left
 * corner of a box, under a cylinder's lid (whose
 * tone it shares), clear of a parallelogram's or hexagon's slanted side, as
 * high in an ellipse or a diamond as the curve leaves it room. A frame's
 * top-left holds its title, and it has no inside to give: its tag is set into
 * the top border at the right. Content the tag would cover moves down
 * (`contentLift`).
 */
export const tagOrigin = (
  shape: ShapeKind,
  w: number,
  h: number,
  tagW: number,
): { x: number; y: number } => {
  const inset = DECOR.tagInset;
  const tagH = DECOR.tagHeight;
  switch (shape) {
    case "frame":
      return { x: w - BORDER_TITLE.inset - tagW, y: -tagH / 2 };
    case "cylinder":
      return { x: inset, y: cylinderCapRy(h) * 2 + 4 };
    case "parallelogram":
      // the left side leans in towards the top: clear it at the tag's upper edge
      return { x: parallelogramSkew(w) * (1 - inset / h) + inset, y: inset };
    case "hexagon":
      // the left side leans in towards the top: clear it at the tag's upper edge
      return { x: hexagonCut(w) * (1 - Math.min(1, inset / (h / 2))) + inset, y: inset };
    case "ellipse":
    case "diamond": {
      // half the silhouette's width at height y, which narrows towards the top
      const half = (y: number) => {
        const t = Math.min(1, y / (h / 2));
        return shape === "diamond" ? (w / 2) * t : (w / 2) * Math.sqrt(1 - (1 - t) ** 2);
      };
      let y = inset;
      while (y < h / 2 && half(y) * 2 - TAG_MARGIN * 2 < tagW) y += 1;
      return { x: w / 2 - half(y) + TAG_MARGIN, y };
    }
    default:
      return { x: inset, y: inset };
  }
};

/**
 * Makes a node's decorations agree with its shape, after an edit merged new
 * fields in — the one rule the bridge and the editor both apply (#160 D3):
 * an icon node always has a glyph, a box may keep its icon, badge and
 * description, and any other shape keeps none of them. Text is cleaned the
 * same way the file loader cleans it; a blank badge or description is no field.
 */
export const fitDecorToShape = <
  T extends { shape: ShapeKind; icon?: string; badge?: string; description?: string },
>(
  data: T,
  defaultIcon: string,
): T => {
  if (data.shape === "icon" && !data.icon) data.icon = defaultIcon;
  if (!keepsIcon(data.shape) || data.icon === "") delete data.icon;
  const badge = takesBadge(data.shape) ? sanitizeBadge(data.badge) : undefined;
  const description = takesDecor(data.shape) ? sanitizeDescription(data.description) : undefined;
  if (badge === undefined) delete data.badge;
  else data.badge = badge;
  if (description === undefined) delete data.description;
  else data.description = description;
  return data;
};
