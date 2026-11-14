import type { AgentOp, MarkerShape } from "../../../shared/lib/types";
import { decodeLabel, paletteFromStyles } from "./mermaidText";
import { type ImportPlan, layoutDirection } from "./plan";

/** the parts of Mermaid's class db this reads (mermaid 11) */
interface ClassMember {
  classifier?: string;
  getDisplayDetails(): { displayText: string };
}
interface ClassNode {
  id: string;
  label?: string;
  /** a generic's parameter: `class Square~Shape~` */
  type?: string;
  annotations?: string[];
  members?: ClassMember[];
  methods?: ClassMember[];
  styles?: string[];
}
interface ClassRelation {
  id1: string;
  id2: string;
  relation: { type1: number | "none"; type2: number | "none"; lineType: number };
  relationTitle1?: string;
  relationTitle2?: string;
  title?: string;
}
export interface ClassDb {
  getClasses(): Map<string, ClassNode>;
  getRelations(): ClassRelation[];
  getDirection?(): string | undefined;
  getNotes?(): Map<string, unknown> | unknown[];
  getNamespaces?(): Map<string, unknown>;
}

/**
 * Mermaid's relation ends (`relationType`) as the canvas's UML heads — the
 * mapping `mermaidClass` writes, read the other way. A bare `<`/`>` is
 * Mermaid's dependency end; the canvas draws association and dependency with
 * the same open arrow, told apart by the line (#49).
 */
const END: Record<number, MarkerShape> = {
  0: "diamond-open", // AGGREGATION
  1: "triangle", // EXTENSION
  2: "diamond", // COMPOSITION
  3: "open", // DEPENDENCY
};
const LOLLIPOP = 4;

/**
 * One member as the canvas writes it (#49): a space after the visibility mark
 * (`+ name`) and the return type after a colon (`+ run(): void`). Mermaid
 * shows `+run() : void`, generics already as `<T>`.
 */
const member = (m: ClassMember): string =>
  decodeLabel(m.getDisplayDetails().displayText)
    .replace(/\)\s*:\s*/, "): ")
    .replace(/^([+\-#~])(?=\S)/, "$1 ");

const size = (v: Map<string, unknown> | unknown[] | undefined): number =>
  v instanceof Map ? v.size : (v?.length ?? 0);

export const fromClass = (db: ClassDb): Omit<ImportPlan, "kind"> => {
  const omitted: string[] = [];
  const ops: AgentOp[] = [];
  const ids = new Map<string, string>();
  if (size(db.getNotes?.()) > 0) omitted.push("notes");
  if (size(db.getNamespaces?.()) > 0) omitted.push("namespaces");

  [...db.getClasses().values()].forEach((c, i) => {
    const id = `n${i}`;
    ids.set(c.id, id);
    const annotations = (c.annotations ?? []).map((a) => decodeLabel(a));
    const stereotype = annotations.find((a) => a.toLowerCase() !== "abstract");
    const isAbstract = annotations.some((a) => a.toLowerCase() === "abstract");
    const members = [...(c.members ?? []), ...(c.methods ?? [])];
    // static ($) and abstract (*) members have no mark on the canvas
    if (members.some((m) => m.classifier)) omitted.push("static and abstract member marks");
    const color = paletteFromStyles(c.styles ?? []);
    ops.push({
      op: "add_node",
      node: {
        id,
        label:
          (decodeLabel(c.label) || c.id) +
          (c.type ? `<${decodeLabel(c.type).replace(/~/g, "")}>` : ""),
        shape: "class",
        ...(color ? { color } : {}),
        x: i * 10,
        y: i * 10,
      },
    });
    const set = {
      ...(stereotype ? { stereotype } : {}),
      ...(isAbstract ? { isAbstract } : {}),
      ...(c.members?.length ? { attributes: c.members.map(member) } : {}),
      ...(c.methods?.length ? { methods: c.methods.map(member) } : {}),
    };
    if (Object.keys(set).length > 0) ops.push({ op: "update_node", id, set });
  });

  db.getRelations().forEach((r, i) => {
    const { type1, type2, lineType } = r.relation;
    if (type1 === LOLLIPOP || type2 === LOLLIPOP) {
      omitted.push("lollipop interfaces");
      return;
    }
    const source = ids.get(r.id1);
    const target = ids.get(r.id2);
    if (!source || !target) return;
    const title = (t: string | undefined) => (t && t !== "none" ? decodeLabel(t) : "");
    ops.push({
      op: "add_edge",
      edge: {
        id: `e${i}`,
        source,
        target,
        variant: lineType === 1 ? "dashed" : "solid",
        markerStart: type1 === "none" ? "none" : (END[type1] ?? "none"),
        markerEnd: type2 === "none" ? "none" : (END[type2] ?? "none"),
        ...(title(r.relationTitle1) ? { labelStart: title(r.relationTitle1) } : {}),
        ...(title(r.relationTitle2) ? { labelEnd: title(r.relationTitle2) } : {}),
        ...(title(r.title) ? { label: title(r.title) } : {}),
      },
    });
  });

  return {
    ops,
    omitted,
    layout: { direction: layoutDirection(db.getDirection?.()), clusters: [] },
  };
};
