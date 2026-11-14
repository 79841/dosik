import {
  DECOR,
  hasBadge,
  hasInlineDecor,
  iconPlacement,
  isStepBadge,
  stepAnchor,
  tagOrigin,
  tagWidth,
  takesDecor,
} from "./nodeDecor";
import { BORDER_TITLE, FRAGMENT_GUARD, ICON_LABEL_H, LIFELINE_HEADER_H } from "./palette";
import { outlineInset } from "./sideAttach";
import { ellipsize, textWidth, wrapText } from "./textLayout";
import type { DiagramNode, ShapeKind, ShapeNodeData } from "./types";

/**
 * A node's text and decorations laid out in numbers — where `ShapeNode`'s HTML
 * puts them, for the renderers that have no HTML (the vector SVG) and for the
 * one placement the canvas cannot leave to CSS: content moving down to clear a
 * badge (#210). The rules copy CSS the canvas states in class names, and
 * the constants are tied to those class names by tests, so a change to one
 * breaks the other.
 */

/** `ShapeNode`'s label span: text-[12px] font-semibold leading-snug (1.375) — Studio (#210 D5) */
export const NODE_LABEL = { fontSize: 12, fontWeight: 600, lineHeight: 12 * 1.375 } as const;
/** a sticky note and the text shape are body text, not a title: `font-normal` */
export const BODY_TEXT_WEIGHT = 400;
const STICKY_LABEL = { ...NODE_LABEL, fontWeight: BODY_TEXT_WEIGHT } as const;
/** the `text` shape adds text-[13px] */
export const TEXT_SHAPE_SIZE = 13;

/** what the layouts read of a node — the canvas has its data, not a whole node */
type LaidOutNode = Pick<DiagramNode, "data">;

export interface LabelLayout {
  lines: string[];
  /** in node coordinates */
  x: number;
  centerY: number;
  anchor: "start" | "middle";
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}

/** a badge as a tag, its text upper-cased */
export interface TagLayout {
  kind: "tag";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** a step badge: a circle on the shape's top-right anchor (#210 D23) */
export interface StepLayout {
  kind: "step";
  text: string;
  cx: number;
  cy: number;
  r: number;
}

export interface DecorLayout {
  label: LabelLayout | null;
  description: LabelLayout | null;
  icon: { id: string; x: number; y: number; size: number } | null;
  badge: TagLayout | StepLayout | null;
}

type Box = { x: number; y: number; width: number; height: number };

/** the box a laid-out label covers, in node coordinates */
export const labelBox = (label: LabelLayout): Box => {
  const width = Math.max(0, ...label.lines.map((l) => textWidth(l, label.fontSize)));
  const height = label.lines.length * label.lineHeight;
  return {
    x: label.anchor === "middle" ? label.x - width / 2 : label.x,
    y: label.centerY - height / 2,
    width,
    height,
  };
};

/** the area a badge covers, in node coordinates — a step circle and its ring hang past the corner */
export const badgeBox = (badge: TagLayout | StepLayout): Box => {
  if (badge.kind !== "step") {
    return { x: badge.x, y: badge.y, width: badge.width, height: badge.height };
  }
  const r = badge.r + DECOR.stepRing;
  return { x: badge.cx - r, y: badge.cy - r, width: r * 2, height: r * 2 };
};

/**
 * Where `ShapeNode` puts a badge on a `shape` node `w` × `h` (#210 D23): a step circle on `stepAnchor`, or a tag at `tagOrigin`.
 */
export const badgeLayout = (
  badge: string,
  shape: ShapeKind,
  w: number,
  h: number,
): TagLayout | StepLayout => {
  if (isStepBadge(badge)) {
    const { x, y } = stepAnchor(shape, w, h);
    return { kind: "step", text: badge, cx: x, cy: y, r: DECOR.stepRadius };
  }
  const width = tagWidth(badge);
  return {
    kind: "tag",
    text: badge.toUpperCase(),
    ...tagOrigin(shape, w, h, width),
    width,
    height: DECOR.tagHeight,
  };
};

/** a frame's badge, or null — boxes lay theirs out with `nodeDecorLayout` */
export const frameBadgeLayout = (
  node: LaidOutNode,
  w: number,
  h: number,
): TagLayout | StepLayout | null =>
  node.data.shape === "frame" && hasBadge(node.data)
    ? badgeLayout(node.data.badge, "frame", w, h)
    : null;

/**
 * How far a frame's title band stops short of its right end: the inset, and
 * past a tag set into the border there, so a long title is cut before it —
 * its canvas-coloured patch running up to the tag (#210). A step circle
 * sits on the corner itself, beyond the inset.
 */
export const frameTitleRight = (data: Pick<ShapeNodeData, "shape" | "badge">): number =>
  hasBadge(data) && !isStepBadge(data.badge)
    ? BORDER_TITLE.inset + tagWidth(data.badge)
    : BORDER_TITLE.inset;

/** The label where `ShapeNode`'s HTML puts it, before any move to clear a badge. */
const baseLabelLayout = (node: LaidOutNode, w: number, h: number): LabelLayout | null => {
  const { shape } = node.data;
  const isText = shape === "text";
  // the placeholders ShapeNode shows for an empty label
  const text = node.data.label || (isText ? "Text" : shape === "frame" ? "Frame" : "");
  // an image draws no label — the text is its alt text (#8)
  if (!text || shape === "class" || shape === "entity" || shape === "anchor" || shape === "image")
    return null;
  const { fontSize, fontWeight, lineHeight } = isText
    ? {
        fontWeight: BODY_TEXT_WEIGHT,
        fontSize: TEXT_SHAPE_SIZE,
        lineHeight: TEXT_SHAPE_SIZE * 1.375,
      }
    : shape === "sticky"
      ? STICKY_LABEL
      : NODE_LABEL;
  const font = { fontSize, fontWeight, lineHeight };

  if (shape === "icon") {
    // one fixed line under the glyph (px-1) — the only label ShapeNode clips
    // with an ellipsis. Clipped, a centred line starts at the left edge
    // instead: CSS aligns overflowing text to the start
    const line = ellipsize(text, w - 8, fontSize);
    const clipped = line !== text;
    return {
      lines: [line],
      x: clipped ? 4 : w / 2,
      centerY: h - ICON_LABEL_H / 2,
      anchor: clipped ? "start" : "middle",
      ...font,
    };
  }
  if (shape === "frame") {
    // the title set into the top border (#210 D10): one line clipped like the
    // canvas's ellipsis, `px-1.5` inside its canvas-coloured patch, in a band
    // from `inset` to `frameTitleRight` short of the right end
    const room = Math.max(
      0,
      w - BORDER_TITLE.inset - frameTitleRight(node.data) - BORDER_TITLE.padX * 2,
    );
    return {
      lines: [ellipsize(text, room, BORDER_TITLE.fontSize)],
      x: BORDER_TITLE.inset + BORDER_TITLE.padX,
      centerY: 0,
      anchor: "start",
      fontSize: BORDER_TITLE.fontSize,
      fontWeight: BORDER_TITLE.fontWeight,
      lineHeight: BORDER_TITLE.fontSize * 1.375,
    };
  }
  if (shape === "fragment") {
    // the guard sits inside at the top-left (#210 D11) and wraps like every
    // other label; centred on its band, overflowing both ways
    return {
      lines: wrapText(
        text,
        Math.max(0, w - FRAGMENT_GUARD.left - FRAGMENT_GUARD.right),
        FRAGMENT_GUARD.fontSize,
      ),
      x: FRAGMENT_GUARD.left,
      centerY: FRAGMENT_GUARD.top + FRAGMENT_GUARD.height / 2,
      anchor: "start",
      fontSize: FRAGMENT_GUARD.fontSize,
      fontWeight: BODY_TEXT_WEIGHT,
      lineHeight: FRAGMENT_GUARD.fontSize * 1.375,
    };
  }
  if (shape === "sticky") {
    // items-start p-3, left-aligned
    const lines = wrapText(text, w - 24, fontSize);
    return {
      lines,
      x: 12,
      centerY: 12 + (lines.length * lineHeight) / 2,
      anchor: "start",
      ...font,
    };
  }
  const padX = shape === "diamond" || shape === "hexagon" || shape === "parallelogram" ? 24 : 12;
  const band =
    shape === "lifeline"
      ? { top: 0, bottom: LIFELINE_HEADER_H }
      : shape === "cylinder"
        ? { top: 16, bottom: h } // pt-4 clears the lid
        : { top: 0, bottom: h };
  return {
    lines: wrapText(text, w - padX * 2, fontSize),
    x: w / 2,
    centerY: (band.top + band.bottom) / 2,
    anchor: "middle",
    ...font,
  };
};

/** A box's icon, label and description where `ShapeNode` puts them, before any move. */
const baseDecorLayout = (node: LaidOutNode, w: number, h: number): DecorLayout | null => {
  const { shape, label, description } = node.data;
  if (!takesDecor(shape)) return null;
  const badge = hasBadge(node.data) ? badgeLayout(node.data.badge, shape, w, h) : null;
  if (!hasInlineDecor(node.data)) {
    return badge
      ? { label: baseLabelLayout(node, w, h), description: null, icon: null, badge }
      : null;
  }
  const sticky = shape === "sticky";
  const font = sticky ? STICKY_LABEL : NODE_LABEL;
  const padX = shape === "diamond" || shape === "hexagon" || shape === "parallelogram" ? 24 : 12;
  const band = shape === "cylinder" ? { top: 16, bottom: h } : { top: 0, bottom: h };
  const middle = (band.top + band.bottom) / 2;
  const avail = Math.max(0, w - padX * 2);
  const iconId = node.data.icon ? String(node.data.icon) : null;
  const beside = iconId !== null && iconPlacement(h) === "left";
  const iconLead = beside ? DECOR.iconSizeInline + DECOR.iconGap : 0;

  const lines = label ? wrapText(label, Math.max(0, avail - iconLead), font.fontSize) : [];
  const labelH = lines.length * font.lineHeight;
  const descLines = description ? wrapText(description, avail, DECOR.descriptionFontSize) : [];
  const descH = descLines.length * DECOR.descriptionLineHeight;
  const descAt = (x: number, centerY: number, anchor: "start" | "middle"): LabelLayout | null =>
    descLines.length > 0
      ? {
          lines: descLines,
          x,
          centerY,
          anchor,
          fontSize: DECOR.descriptionFontSize,
          fontWeight: 400,
          lineHeight: DECOR.descriptionLineHeight,
        }
      : null;

  if (beside && iconId) {
    // one row — the icon, then the label, left-aligned as a block in the box
    const rowH = Math.max(DECOR.iconSizeInline, labelH);
    const gap = descH > 0 ? DECOR.descriptionGap : 0;
    const top = sticky ? 12 : middle - (rowH + gap + descH) / 2;
    const labelW = Math.max(0, ...lines.map((l) => textWidth(l, font.fontSize)));
    const rowW = lines.length > 0 ? iconLead + labelW : DECOR.iconSizeInline;
    const rowX = sticky ? 12 : w / 2 - rowW / 2;
    return {
      icon: {
        id: iconId,
        x: rowX,
        y: top + rowH / 2 - DECOR.iconSizeInline / 2,
        size: DECOR.iconSizeInline,
      },
      label:
        lines.length > 0
          ? { lines, x: rowX + iconLead, centerY: top + rowH / 2, anchor: "start", ...font }
          : null,
      description: descAt(
        sticky ? 12 : w / 2,
        top + rowH + gap + descH / 2,
        sticky ? "start" : "middle",
      ),
      badge,
    };
  }

  // one stack — the icon over the label over the description (`flex-col gap-0.5`,
  // the icon's `mb-1` makes 6px to whatever follows it, 4px when nothing does)
  const iconBlock = iconId ? DECOR.iconSize + (labelH > 0 || descH > 0 ? DECOR.iconGap : 4) : 0;
  const gap = labelH > 0 && descH > 0 ? DECOR.descriptionGap : 0;
  const total = iconBlock + labelH + gap + descH;
  const top = sticky ? 12 : middle - total / 2;
  const x = sticky ? 12 : w / 2;
  const anchor = sticky ? "start" : "middle";
  return {
    icon: iconId
      ? { id: iconId, x: sticky ? 12 : w / 2 - DECOR.iconSize / 2, y: top, size: DECOR.iconSize }
      : null,
    label:
      lines.length > 0
        ? { lines, x, centerY: top + iconBlock + labelH / 2, anchor, ...font }
        : null,
    description: descAt(x, top + iconBlock + labelH + gap + descH / 2, anchor),
    badge,
  };
};

/** the room kept between a badge and the content it moves */
const BADGE_CLEARANCE = 3;
/** the content never moves closer than this to the box's bottom */
const BOTTOM_ROOM = 4;
/** how close moved content may come to a curved or slanted outline */
const OUTLINE_ROOM = 1;

/** the pieces a box's content is made of: the icon and each line of label and description */
const contentParts = (decor: DecorLayout): Box[] => {
  const lines = (label: LabelLayout | null): Box[] => {
    if (!label) return [];
    const box = labelBox(label);
    return label.lines.map((line, i) => {
      const width = textWidth(line, label.fontSize);
      return {
        x: label.anchor === "middle" ? label.x - width / 2 : label.x,
        y: box.y + i * label.lineHeight,
        width,
        height: label.lineHeight,
      };
    });
  };
  const icon = decor.icon
    ? [{ x: decor.icon.x, y: decor.icon.y, width: decor.icon.size, height: decor.icon.size }]
    : [];
  return [...icon, ...lines(decor.label), ...lines(decor.description)];
};

/** whether a point lies inside a `shape` node `w` × `h` — its silhouette — with `room` to spare */
const insideShape = (shape: ShapeKind, w: number, h: number, x: number, y: number): boolean => {
  const b = { x: 0, y: 0, width: w, height: h };
  if (x < 0 || x > w || y < 0 || y > h) return false;
  const room = OUTLINE_ROOM;
  return (
    x >= outlineInset(shape, b, "left", y / h) + room &&
    x <= w - outlineInset(shape, b, "right", y / h) - room &&
    y >= outlineInset(shape, b, "top", x / w) + room &&
    y <= h - outlineInset(shape, b, "bottom", x / w) - Math.max(room, BOTTOM_ROOM)
  );
};

/**
 * How far a box's content — icon, label, description — moves down to clear its
 * badge (#210): only the pieces that run under the tag, or under a step
 * circle reaching in, count, and the content moves just past it. Never so far
 * that a piece leaves the shape's outline or comes within 4px of its bottom —
 * a box too small for both keeps the overlap that is left; 0 when nothing
 * collides, so content stays where `ShapeNode` centres it.
 */
export const contentLift = (node: LaidOutNode, w: number, h: number): number => {
  const { data } = node;
  if (!takesDecor(data.shape) || !hasBadge(data)) return 0;
  // a box with a badge always has a decor layout — the badge is in it
  const decor = baseDecorLayout(node, w, h);
  if (!decor) return 0;
  const badge = badgeBox(badgeLayout(data.badge, data.shape, w, h));
  const parts = contentParts(decor);
  const under = parts.filter(
    (p) =>
      badge.x < p.x + p.width + BADGE_CLEARANCE && badge.x + badge.width > p.x - BADGE_CLEARANCE,
  );
  const need = Math.max(0, ...under.map((p) => badge.y + badge.height + BADGE_CLEARANCE - p.y));
  if (need === 0) return 0;
  const fits = (dy: number) =>
    parts.every((p) =>
      [
        [p.x, p.y + dy],
        [p.x + p.width, p.y + dy],
        [p.x, p.y + p.height + dy],
        [p.x + p.width, p.y + p.height + dy],
      ].every(([x, y]) => insideShape(data.shape, w, h, x!, y!)),
    );
  // content that does not fit even where it is stays there
  if (!fits(0)) return 0;
  let lift = need;
  while (lift > 0 && !fits(lift)) lift = Math.max(0, lift - 0.25);
  return lift;
};

const lowered = (label: LabelLayout | null, dy: number): LabelLayout | null =>
  label && dy ? { ...label, centerY: label.centerY + dy } : label;

/**
 * The label, laid out the way `ShapeNode`'s HTML lays it out for this shape —
 * moved down past the box's badge where it would run under it (`contentLift`).
 *
 * Pure, so the drawing and the document bounds use the same numbers: a label
 * that overflows its box is visible on the canvas (nothing clips it), and the
 * file must not cut it off at the viewBox (#152).
 */
export const nodeLabelLayout = (node: LaidOutNode, w: number, h: number): LabelLayout | null =>
  lowered(baseLabelLayout(node, w, h), contentLift(node, w, h));

/**
 * A box's icon, label, description and badge (#160, Studio #210), laid out the
 * way `ShapeNode` does it. The icon sits above the label as one centred stack
 * with the description — or, in a box under 64px, beside the label on one row.
 * A sticky note starts at its top-left instead. The whole stack moves down past
 * the badge where it would run under it. `null` for a shape that takes no
 * decoration, or a box without any — its label is `nodeLabelLayout`'s alone.
 */
export const nodeDecorLayout = (node: LaidOutNode, w: number, h: number): DecorLayout | null => {
  const decor = baseDecorLayout(node, w, h);
  const dy = decor ? contentLift(node, w, h) : 0;
  if (!decor || dy === 0) return decor;
  return {
    ...decor,
    icon: decor.icon ? { ...decor.icon, y: decor.icon.y + dy } : null,
    label: lowered(decor.label, dy),
    description: lowered(decor.description, dy),
  };
};
