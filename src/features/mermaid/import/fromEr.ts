import type { AgentOp, MarkerShape } from "../../../shared/lib/types";
import { decodeLabel, paletteFromStyles } from "./mermaidText";
import { type ImportPlan, layoutDirection } from "./plan";

/** the parts of Mermaid's ER db this reads (mermaid 11) */
interface ErAttribute {
  type?: string;
  name?: string;
  keys?: string[];
  comment?: string;
}
interface ErEntity {
  id: string;
  label?: string;
  alias?: string;
  attributes?: ErAttribute[];
  cssStyles?: string[];
}
interface ErRelationship {
  entityA: string;
  entityB: string;
  roleA?: string;
  relSpec: { cardA: string; cardB: string; relType: string };
}
export interface ErDb {
  getEntities(): Map<string, ErEntity>;
  getRelationships(): ErRelationship[];
  getDirection?(): string | undefined;
}

/** Mermaid's cardinalities as the canvas's crow's-foot ends (#5) */
const CARD: Record<string, MarkerShape> = {
  ONLY_ONE: "one",
  ZERO_OR_ONE: "zero-one",
  ONE_OR_MORE: "one-many",
  ZERO_OR_MORE: "zero-many",
};

/** a column line as the entity shape keeps it (#5): `name type PK,FK` */
const column = (a: ErAttribute): string =>
  [a.name, a.type, (a.keys ?? []).join(",")]
    .map((w) => decodeLabel(w))
    .filter(Boolean)
    .join(" ");

export const fromEr = (db: ErDb): Omit<ImportPlan, "kind"> => {
  const omitted: string[] = [];
  const ops: AgentOp[] = [];
  /** Mermaid's relationships name an entity by its internal id, not its key */
  const ids = new Map<string, string>();

  [...db.getEntities().entries()].forEach(([key, e], i) => {
    const id = `n${i}`;
    ids.set(e.id, id);
    const attributes = e.attributes ?? [];
    if (attributes.some((a) => a.comment)) omitted.push("attribute comments");
    const color = paletteFromStyles(e.cssStyles ?? []);
    ops.push({
      op: "add_node",
      node: {
        id,
        label: decodeLabel(e.alias) || decodeLabel(e.label) || key,
        shape: "entity",
        ...(attributes.length ? { columns: attributes.map(column) } : {}),
        ...(color ? { color } : {}),
        x: i * 10,
        y: i * 10,
      },
    });
  });

  db.getRelationships().forEach((r, i) => {
    const source = ids.get(r.entityA);
    const target = ids.get(r.entityB);
    if (!source || !target) return;
    const { cardA, cardB, relType } = r.relSpec;
    if (!CARD[cardA] || !CARD[cardB]) omitted.push("parent cardinality");
    const label = decodeLabel(r.roleA);
    ops.push({
      op: "add_edge",
      edge: {
        id: `e${i}`,
        source,
        target,
        // Mermaid names the ends crosswise: cardB is the end at entity A
        markerStart: CARD[cardB] ?? "one",
        markerEnd: CARD[cardA] ?? "one",
        variant: relType === "NON_IDENTIFYING" ? "dashed" : "solid",
        ...(label ? { label } : {}),
      },
    });
  });

  return {
    ops,
    omitted,
    layout: { direction: layoutDirection(db.getDirection?.()), clusters: [] },
  };
};
