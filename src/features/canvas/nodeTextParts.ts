import {
  CLASS_ROW_H,
  CLASS_SECTION_PAD,
  CLASS_STEREOTYPE_H,
  classDividerYs,
  sanitizeClassMembers,
  sanitizeStereotype,
} from "../../shared/lib/classShape";
import { ENTITY_HEADER_H, ENTITY_ROW_H, ENTITY_ROWS_PAD } from "../../shared/lib/entityShape";
import {
  hasBadge,
  sanitizeBadge,
  sanitizeDescription,
  takesDecor,
} from "../../shared/lib/nodeDecor";
import type { ShapeKind, ShapeNodeData } from "../../shared/lib/types";

/**
 * The texts a shape draws, each edited where it is drawn (#281): its name
 * (`label` — a frame's title, a class's or entity's name), a box's
 * description and badge, a frame's badge, a class's stereotype and member
 * compartments, an entity's columns. One model for the double-click, Tab,
 * right-click and the editor itself.
 */
export type NodeTextPart =
  | "label"
  | "description"
  | "badge"
  | "stereotype"
  | "attributes"
  | "methods"
  | "columns";

/** the parts stored as rows — one line of the editor per row */
export type ListPart = "attributes" | "methods" | "columns";

export const isListPart = (part: NodeTextPart): part is ListPart =>
  part === "attributes" || part === "methods" || part === "columns";

/** a part that is one line — Shift+Enter adds nothing to it */
export const isSingleLinePart = (part: NodeTextPart): boolean =>
  part === "badge" || part === "stereotype";

/** every part a shape can carry, in Tab order */
const partsOf = (shape: ShapeKind): NodeTextPart[] => {
  if (shape === "image" || shape === "anchor") return [];
  if (shape === "class") return ["stereotype", "label", "attributes", "methods"];
  if (shape === "entity") return ["label", "columns"];
  if (shape === "frame") return ["label", "badge"];
  if (takesDecor(shape)) return ["label", "description", "badge"];
  return ["label"];
};

const shows = (data: ShapeNodeData, part: NodeTextPart): boolean => {
  switch (part) {
    case "label":
      return true;
    case "description":
      return Boolean(data.description);
    case "badge":
      return hasBadge(data);
    case "stereotype":
      return Boolean(data.stereotype);
    default:
      return (data[part]?.length ?? 0) > 0;
  }
};

/**
 * The parts a node shows now, in Tab order — only what is drawn (#281 D1);
 * `adding` is a part being added from the right-click menu, shown while it
 * is typed.
 */
export const nodeTextParts = (data: ShapeNodeData, adding?: NodeTextPart): NodeTextPart[] =>
  partsOf(data.shape).filter((part) => part === adding || shows(data, part));

/**
 * The part Tab (`step` 1) or Shift+Tab (-1) goes to from `current`, round
 * the shape's parts. `current` may have just gone — a description emptied on
 * Tab — and the walk goes on from where it was. A shape with one text stays
 * on it; `null` when the shape has none.
 */
export const nextTextPart = (
  data: ShapeNodeData,
  current: NodeTextPart,
  step: 1 | -1,
): NodeTextPart | null => {
  const order = partsOf(data.shape);
  const shown = nodeTextParts(data);
  if (shown.length === 0) return null;
  const at = order.indexOf(current);
  if (at < 0) return shown[0] ?? null;
  const n = order.length;
  for (let k = 1; k <= n; k++) {
    const candidate = order[(((at + step * k) % n) + n) % n];
    if (candidate && shown.includes(candidate)) return candidate;
  }
  return null;
};

/** the text a part holds, as its editor shows it — a compartment's rows one per line */
export const textPartValue = (data: ShapeNodeData, part: NodeTextPart): string => {
  if (isListPart(part)) return (data[part] ?? []).join("\n");
  if (part === "label") return data.label;
  return data[part] ?? "";
};

/** the data patch that writes `text` into `part` — the store cleans it (`updateNodeData`) */
export const textPartPatch = (part: NodeTextPart, text: string): Partial<ShapeNodeData> =>
  isListPart(part) ? { [part]: text.split("\n") } : { [part]: text };

/**
 * Whether writing `text` would change the part once the store has cleaned
 * it — trimmed ends, blank rows dropped, «» stripped. A text that cleans up to
 * what is stored writes nothing, so closing an untouched editor (or Tab
 * through it) leaves no empty undo step.
 */
export const textPartChanged = (data: ShapeNodeData, part: NodeTextPart, text: string): boolean => {
  switch (part) {
    case "label":
      return text !== data.label;
    case "description":
      return sanitizeDescription(text) !== data.description;
    case "badge":
      return sanitizeBadge(text) !== data.badge;
    case "stereotype":
      return sanitizeStereotype(text) !== data.stereotype;
    default: {
      const next = sanitizeClassMembers(text.split("\n")) ?? [];
      const stored = data[part] ?? [];
      return next.length !== stored.length || next.some((row, i) => row !== stored[i]);
    }
  }
};

/** whether writing `text` leaves the part with nothing — the store then drops the field */
export const textPartEmptied = (part: NodeTextPart, text: string): boolean => {
  switch (part) {
    case "label":
      return false;
    case "description":
      return sanitizeDescription(text) === undefined;
    case "badge":
      return sanitizeBadge(text) === undefined;
    case "stereotype":
      return sanitizeStereotype(text) === undefined;
    default:
      return sanitizeClassMembers(text.split("\n")) === undefined;
  }
};

/** what a double-click opens: the marked part it landed on, else the name */
export const pickTextPart = (
  data: ShapeNodeData,
  mark: string | undefined,
  line: string | undefined,
): { part: NodeTextPart; line?: number } | null => {
  const shown = nodeTextParts(data);
  const part = shown.find((p) => p === mark);
  if (part) return isListPart(part) ? { part, line: Number(line) || 0 } : { part };
  return shown.includes("label") ? { part: "label" } : null;
};

/** the [from, to) of line `line` in `text` — past the last line, the last line */
export const lineRange = (text: string, line: number): [number, number] => {
  const lines = text.split("\n");
  const index = Math.min(Math.max(0, line), lines.length - 1);
  let from = 0;
  for (let i = 0; i < index; i++) from += (lines[i]?.length ?? 0) + 1;
  return [from, from + (lines[index]?.length ?? 0)];
};

/** what right-click › Add … offers: a box's or frame's missing texts, a row of a compartment */
export const addableTextParts = (data: ShapeNodeData): { part: NodeTextPart; enabled: boolean }[] =>
  partsOf(data.shape)
    .filter((part) => part !== "label" && part !== "stereotype")
    // a compartment always takes another row; a description or badge is one
    .map((part) => ({ part, enabled: isListPart(part) || !shows(data, part) }));

/** the text an editor opens with — adding a row starts a new last line */
export const editorStartText = (
  data: ShapeNodeData,
  part: NodeTextPart,
  adding: boolean,
): string => {
  const value = textPartValue(data, part);
  return adding && isListPart(part) && value ? `${value}\n` : value;
};

/**
 * Where the «stereotype» line is drawn — low in its band, against the name
 * (`ClassSvg` sets it at `CLASS_STEREOTYPE_H / 2 + 6`). Its 14px line box is
 * raised 1.2px more: SVG's `middle` baseline sets the words that much above
 * a line box's centre (measured in WKWebView).
 */
export const STEREOTYPE_LINE = { top: CLASS_STEREOTYPE_H / 2 + 6 - 7 - 1.2, height: 14 } as const;

/**
 * Where a compartment's area starts on its card — the rule above it — for the
 * rows `data` holds: the methods follow the attributes when there are any.
 */
export const compartmentTop = (data: ShapeNodeData, part: ListPart): number => {
  if (part === "columns") return ENTITY_HEADER_H;
  const dividers = classDividerYs(data);
  const index = part === "methods" && (data.attributes?.length ?? 0) > 0 ? 1 : 0;
  return dividers[index] ?? 0;
};

/** a row's band on a class or entity card, top-relative — where a double-click on it lands */
export interface RowBand {
  part: NodeTextPart;
  line: number;
  top: number;
  height: number;
  /** the row itself, without the compartment padding the band takes in */
  row: { top: number; height: number };
}

/** one compartment's rows; the first reaches up to its rule, the last down past its padding */
const rowBands = (
  part: ListPart,
  top: number,
  count: number,
  rowH: number,
  pad: number,
): RowBand[] =>
  Array.from({ length: count }, (_, line) => {
    const first = line === 0;
    const last = line === count - 1;
    const rowTop = top + pad + line * rowH;
    return {
      part,
      line,
      top: first ? top : rowTop,
      height: rowH + (first ? pad : 0) + (last ? pad : 0),
      row: { top: rowTop, height: rowH },
    };
  });

/**
 * The bands of a class's stereotype line and member rows, or an entity's
 * column rows — from the same numbers `ClassSvg` and `EntitySvg` draw with.
 * Empty for every other shape.
 */
export const cardRowBands = (data: ShapeNodeData): RowBand[] => {
  if (data.shape === "entity") {
    const count = data.columns?.length ?? 0;
    return rowBands(
      "columns",
      compartmentTop(data, "columns"),
      count,
      ENTITY_ROW_H,
      ENTITY_ROWS_PAD,
    );
  }
  if (data.shape !== "class") return [];
  const bands: RowBand[] = data.stereotype
    ? [{ part: "stereotype", line: 0, top: 0, height: CLASS_STEREOTYPE_H, row: STEREOTYPE_LINE }]
    : [];
  for (const part of ["attributes", "methods"] as const) {
    const count = data[part]?.length ?? 0;
    if (count > 0) {
      bands.push(
        ...rowBands(part, compartmentTop(data, part), count, CLASS_ROW_H, CLASS_SECTION_PAD),
      );
    }
  }
  return bands;
};
