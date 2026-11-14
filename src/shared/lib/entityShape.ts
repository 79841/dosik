import { effectiveMarkerEnd } from "./edgeUtils";
import type { MarkerShape, ShapeNodeData } from "./types";
import { MAX_CLASS_MEMBERS, sanitizeClassMembers, textWidth } from "./classShape";

/**
 * Columns are kept like a class box's members: one per line, line breaks
 * flattened, blank lines dropped, at most MAX_CLASS_MEMBERS (40) rows — the
 * same rule, under the name an entity's code reads by (#156).
 */
export const sanitizeEntityColumns = sanitizeClassMembers;
export const MAX_ENTITY_COLUMNS = MAX_CLASS_MEMBERS;

/**
 * The ERD entity (#5): a table — the entity's name in a header band, then one
 * row per column. Columns are raw lines like `id uuid PK`, for the same reason
 * class members are (see `classShape.ts`): one-line entry is how every ERD
 * tool is fed, and a line needs no migration if rows become fields later.
 */
export const ENTITY_HEADER_H = 32;
export const ENTITY_ROW_H = 20;
/** padding above and below the column rows */
export const ENTITY_ROWS_PAD = 6;
/** narrowest left gutter a key badge sits in — kept even without keys so names line up */
export const ENTITY_KEY_W = 30;
export const ENTITY_KEY_FONT = 9;
/** space between a key badge and the column name */
const KEY_GAP = 6;
export const ENTITY_TEXT_PAD = 10;
export const ENTITY_NAME_FONT = 12;
export const ENTITY_COLUMN_FONT = 11.5;
/** gap between a column's name and its type */
const NAME_TYPE_GAP = 16;

export type ColumnKey = "PK" | "FK" | "UK";
const KEYS: ColumnKey[] = ["PK", "FK", "UK"];

export interface Column {
  name: string;
  type: string;
  keys: ColumnKey[];
}

/**
 * `name type… [KEYS]`: the first word is the name, a trailing word made only
 * of PK/FK/UK (comma-joined, any case) is the keys, the rest is the type. Only
 * the *last* word counts as keys, so `pk_seq bigint` keeps its name.
 */
export const parseColumn = (line: string): Column => {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const name = words.shift() ?? "";
  let keys: ColumnKey[] = [];
  const last = words[words.length - 1];
  if (last) {
    const parts = last.toUpperCase().split(",");
    if (parts.every((p) => (KEYS as string[]).includes(p))) {
      keys = parts as ColumnKey[];
      words.pop();
    }
  }
  return { name, type: words.join(" "), keys };
};

/**
 * Width of the key gutter: the widest badge in this table (`PK,FK` needs more
 * than `PK`), never under ENTITY_KEY_W. One value per table so every name
 * starts in the same column.
 */
export const entityKeyGutter = (columns: string[] | undefined): number => {
  const widest = (columns ?? []).reduce((max, line) => {
    const { keys } = parseColumn(line);
    return keys.length > 0 ? Math.max(max, textWidth(keys.join(","), ENTITY_KEY_FONT)) : max;
  }, 0);
  return Math.max(ENTITY_KEY_W, Math.ceil(ENTITY_TEXT_PAD + widest + KEY_GAP));
};

export const entityNodeHeight = (columns: string[] | undefined): number => {
  const count = columns?.length ?? 0;
  return ENTITY_HEADER_H + (count > 0 ? ENTITY_ROWS_PAD * 2 + count * ENTITY_ROW_H : 0);
};

/** width that fits the name and every row; a user resize may only add to it */
export const entityNodeWidth = (
  data: Pick<ShapeNodeData, "label" | "columns">,
  minimum: number,
): number => {
  const gutter = entityKeyGutter(data.columns);
  const rows = (data.columns ?? []).map((line) => {
    const { name, type } = parseColumn(line);
    return (
      gutter +
      textWidth(name, ENTITY_COLUMN_FONT) +
      (type ? NAME_TYPE_GAP + textWidth(type, ENTITY_COLUMN_FONT) : 0) +
      ENTITY_TEXT_PAD
    );
  });
  return Math.ceil(
    Math.max(minimum, textWidth(data.label ?? "", ENTITY_NAME_FONT) + ENTITY_TEXT_PAD * 2, ...rows),
  );
};

/**
 * Relationships between entities, as the two crow's-foot ends they are.
 * Drawn parent → child: the start is the "one" side.
 */
export const ERD_RELATIONS = [
  { id: "one-to-one", label: "One to one", hint: "1 — 1" },
  { id: "one-to-many", label: "One to many", hint: "1 — 1..N" },
  { id: "one-to-zero-many", label: "One to zero or many", hint: "1 — 0..N" },
  { id: "many-to-many", label: "Many to many", hint: "0..N — 0..N" },
] as const satisfies readonly { id: string; label: string; hint: string }[];

export type ErdRelationId = (typeof ERD_RELATIONS)[number]["id"];

export const ERD_RELATION_STYLE: Record<
  ErdRelationId,
  { markerStart: MarkerShape; markerEnd: MarkerShape }
> = {
  "one-to-one": { markerStart: "one", markerEnd: "one" },
  "one-to-many": { markerStart: "one", markerEnd: "one-many" },
  "one-to-zero-many": { markerStart: "one", markerEnd: "zero-many" },
  "many-to-many": { markerStart: "zero-many", markerEnd: "zero-many" },
};

export const matchErdRelation = (data: {
  markerStart?: MarkerShape;
  markerEnd?: MarkerShape;
}): ErdRelationId | null => {
  for (const { id } of ERD_RELATIONS) {
    const style = ERD_RELATION_STYLE[id];
    if (
      (data.markerStart ?? "none") === style.markerStart &&
      effectiveMarkerEnd(data) === style.markerEnd
    ) {
      return id;
    }
  }
  return null;
};

/**
 * Mermaid `erDiagram` cardinality for one end. The left end is written before
 * `--` and the right after it, mirrored: `||--o{`. Any end that is not a
 * crow's foot reads as "exactly one" — erDiagram needs a cardinality on both.
 */
export const mermaidCardinality = (marker: MarkerShape, side: "left" | "right"): string => {
  const table: Record<string, [string, string]> = {
    one: ["||", "||"],
    "zero-one": ["|o", "o|"],
    "one-many": ["}|", "|{"],
    "zero-many": ["}o", "o{"],
  };
  const pair = table[marker] ?? table.one!;
  return side === "left" ? pair[0] : pair[1];
};
