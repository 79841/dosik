import { effectiveMarkerEnd } from "./edgeUtils";
import type { EdgeVariant, MarkerShape, ShapeNodeData } from "./types";

/** one member line */
export const CLASS_ROW_H = 18;
/** name compartment without a stereotype */
export const CLASS_NAME_H = 36;
/** extra height the «stereotype» line adds to the name compartment */
export const CLASS_STEREOTYPE_H = 15;
/** padding above and below a member compartment's rows */
export const CLASS_SECTION_PAD = 9;
/** members past this are dropped — a class box that long is a modelling mistake */
export const MAX_CLASS_MEMBERS = 40;
/** UML visibility markers; the leading one is tinted, the rest is left verbatim */
export const VISIBILITY_MARKS = ["+", "-", "#", "~"] as const;

/**
 * Members are stored as raw signature lines, not parsed fields. Every tool
 * surveyed (draw.io, Lucidchart, PlantUML, Mermaid, StarUML, Visual Paradigm)
 * offers one-line text entry as the primary path, and none forces a per-field
 * form. Keeping the line whole also means promoting to row-level editing later
 * needs no data migration.
 */
export const sanitizeClassMembers = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const lines = raw
    .filter((line): line is string => typeof line === "string")
    // a line break inside one member would render as a second row the data
    // doesn't know about, so members are flattened to single lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_CLASS_MEMBERS);
  return lines.length > 0 ? lines : undefined;
};

/** Trims a stereotype to its body — the «» guillemets are added when rendering. */
export const sanitizeStereotype = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/\s+/g, " ").replace(/^«|»$/g, "").trim();
  return text.length > 0 ? text : undefined;
};

/**
 * Splits a member line into its visibility mark and the rest. Only a mark that
 * actually leads the line counts, so `a+b: int` keeps its `+` in the text.
 */
export const splitVisibility = (line: string): { mark: string | null; rest: string } => {
  const first = line.charAt(0);
  if (!(VISIBILITY_MARKS as readonly string[]).includes(first)) return { mark: null, rest: line };
  return { mark: first, rest: line.slice(1).trimStart() };
};

/**
 * Height the box needs for its content. Empty compartments are not drawn — UML
 * allows omitting them, and an empty strip reads as "no members" rather than
 * "not shown". Callers treat this as the minimum a user resize may take.
 */
export const classNodeHeight = (
  data: Pick<ShapeNodeData, "stereotype" | "attributes" | "methods">,
): number => {
  const attributes = data.attributes ?? [];
  const methods = data.methods ?? [];
  let height = CLASS_NAME_H + (data.stereotype ? CLASS_STEREOTYPE_H : 0);
  if (attributes.length > 0) height += CLASS_SECTION_PAD * 2 + attributes.length * CLASS_ROW_H;
  if (methods.length > 0) height += CLASS_SECTION_PAD * 2 + methods.length * CLASS_ROW_H;
  return height;
};

/**
 * Advance width of IBM Plex Mono as a fraction of font size. The app pins that
 * font (a project rule), and it is monospaced, so text width is exact
 * arithmetic rather than a guess — no canvas measurement needed.
 */
export const CLASS_CHAR_W = 0.62;
export const CLASS_MEMBER_FONT = 11.5;
export const CLASS_NAME_FONT = 12;
export const CLASS_STEREOTYPE_FONT = 10.5;
/** left/right padding around member rows */
export const CLASS_TEXT_PAD = 9;

/**
 * Codepoints that render about one em wide instead of the monospace advance.
 * IBM Plex Mono ships no Hangul or CJK glyphs, so those characters come from a
 * system fallback at roughly full width — measuring them at the Latin advance
 * made Korean class names and members overflow the box.
 */
const WIDE_CHAR =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}]|[\u{20000}-\u{3FFFD}]/u;

/** Rendered width of one line, in px, at `font` size. */
export const textWidth = (line: string, font: number): number => {
  let ems = 0;
  // iterate by codepoint so surrogate pairs (emoji) count once, not twice
  for (const ch of line) ems += WIDE_CHAR.test(ch) ? 1 : CLASS_CHAR_W;
  return ems * font;
};

/**
 * Width the box needs so nothing spills past its border. Mirrors
 * `classNodeHeight`: content sets the minimum, a user resize may only add.
 * Without it a long signature simply drew out over the canvas.
 */
export const classNodeWidth = (
  data: Pick<ShapeNodeData, "label" | "stereotype" | "attributes" | "methods">,
  minimum: number,
): number => {
  const longest = (lines: string[], font: number): number =>
    lines.reduce((max, line) => Math.max(max, textWidth(line, font)), 0);
  const members = [...(data.attributes ?? []), ...(data.methods ?? [])];
  return Math.ceil(
    Math.max(
      minimum,
      longest(members, CLASS_MEMBER_FONT) + CLASS_TEXT_PAD * 2,
      longest([data.label ?? ""], CLASS_NAME_FONT) + CLASS_TEXT_PAD * 2,
      longest(data.stereotype ? [`«${data.stereotype}»`] : [], CLASS_STEREOTYPE_FONT) +
        CLASS_TEXT_PAD * 2,
    ),
  );
};

/** y of each divider line between drawn compartments, top-relative. */
export const classDividerYs = (
  data: Pick<ShapeNodeData, "stereotype" | "attributes" | "methods">,
): number[] => {
  const attributes = data.attributes ?? [];
  const methods = data.methods ?? [];
  const ys: number[] = [];
  let y = CLASS_NAME_H + (data.stereotype ? CLASS_STEREOTYPE_H : 0);
  if (attributes.length > 0) {
    ys.push(y);
    y += CLASS_SECTION_PAD * 2 + attributes.length * CLASS_ROW_H;
  }
  if (methods.length > 0) ys.push(y);
  return ys;
};

/**
 * The six UML relationships, as the edge style each one is. Aggregation and
 * composition put their diamond on `markerStart` because the diamond belongs on
 * the *whole* end and whole → part is the natural drawing direction; drawn the
 * other way round, the existing Reverse action swaps marker, labels and bends
 * together.
 */
export const UML_RELATIONS = [
  { id: "generalization", label: "Generalization", hint: "child → parent" },
  { id: "realization", label: "Realization", hint: "impl → interface" },
  { id: "association", label: "Association", hint: "either way" },
  { id: "aggregation", label: "Aggregation", hint: "whole → part" },
  { id: "composition", label: "Composition", hint: "whole → part" },
  { id: "dependency", label: "Dependency", hint: "client → supplier" },
] as const satisfies readonly { id: string; label: string; hint: string }[];

export type UmlRelationId = (typeof UML_RELATIONS)[number]["id"];

export const UML_RELATION_STYLE: Record<
  UmlRelationId,
  { variant: EdgeVariant; markerStart: MarkerShape; markerEnd: MarkerShape }
> = {
  generalization: { variant: "solid", markerStart: "none", markerEnd: "triangle" },
  realization: { variant: "dashed", markerStart: "none", markerEnd: "triangle" },
  association: { variant: "solid", markerStart: "none", markerEnd: "open" },
  aggregation: { variant: "solid", markerStart: "diamond-open", markerEnd: "none" },
  composition: { variant: "solid", markerStart: "diamond", markerEnd: "none" },
  dependency: { variant: "dashed", markerStart: "none", markerEnd: "open" },
};

/** Which preset an edge currently matches, if any — used to light up the button. */
export const matchUmlRelation = (data: {
  variant?: EdgeVariant;
  markerStart?: MarkerShape;
  markerEnd?: MarkerShape;
}): UmlRelationId | null => {
  for (const { id } of UML_RELATIONS) {
    const style = UML_RELATION_STYLE[id];
    if (
      (data.variant ?? "solid") === style.variant &&
      (data.markerStart ?? "none") === style.markerStart &&
      effectiveMarkerEnd(data) === style.markerEnd
    ) {
      return id;
    }
  }
  return null;
};
