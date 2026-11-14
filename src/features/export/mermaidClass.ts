import {
  DEFAULT_EDGE_WIDTH,
  effectiveMarkerEnd,
  effectiveMarkerStart,
} from "../../shared/lib/edgeUtils";
import type { DiagramDoc, MarkerShape } from "../../shared/lib/types";
import { flowchartLabel } from "./mermaidEscape";
import { colorStyles, withOmittedNote } from "./mermaidNotes";

/**
 * A class diagram as Mermaid's classDiagram (#194 feedback). Before, it fell
 * back to flowchart boxes that kept only the class names — the members, the
 * stereotypes and the UML relations were all lost.
 *
 * Relation ends follow UML as the canvas draws them: a hollow triangle is
 * generalisation (`<|`/`|>`), a filled diamond composition (`*`), a hollow one
 * aggregation (`o`), an arrow navigability (`<`/`>`). A dashed line is `..`
 * (realisation, dependency). Ends with no classDiagram form are reported in a
 * `%% omitted` note, as the sequence export does.
 */
const LEFT_END: Partial<Record<MarkerShape, string>> = {
  triangle: "<|",
  diamond: "*",
  "diamond-open": "o",
  arrow: "<",
  open: "<",
};
const RIGHT_END: Partial<Record<MarkerShape, string>> = {
  triangle: "|>",
  diamond: "*",
  "diamond-open": "o",
  arrow: ">",
  open: ">",
};

/**
 * One member line, in the form Mermaid reads:
 * - the visibility mark touches the name (`+ id` → `+id`) — Mermaid takes the
 *   first character as the mark;
 * - a method's `): Type` is its return type written `) Type`;
 * - generics are `~T~` (`List<Item>` would be handed to the renderer as HTML);
 * - braces would close the class body, and `%%` would start a comment.
 */
const member = (line: string): string =>
  line
    .trim()
    .replace(/^([+\-#~])\s+/, "$1")
    .replace(/\)\s*:\s*(.+)$/, ") $1")
    .replace(/[<>]/g, "~")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/%%/g, "% %");

/** a cardinality between quotes: no quote of its own, one line */
const cardinality = (text: string | undefined): string =>
  text?.trim() ? ` "${text.trim().replace(/["\r\n]/g, "")}"` : "";

/** a relation name after the colon: one line, nothing that starts a comment */
const relationLabel = (text: string | undefined): string =>
  text?.trim() ? ` : ${text.trim().replace(/\r?\n/g, " ").replace(/%%/g, "% %")}` : "";

export const toMermaidClass = (
  doc: DiagramDoc,
  ids: Map<string, string>,
  direction: "LR" | "TD",
): string => {
  const omitted: string[] = [];
  const classes = doc.nodes.filter((n) => n.data.shape === "class");
  if (doc.nodes.some((n) => n.data.shape === "anchor")) omitted.push("free arrows");
  // both lines go in the file, but Mermaid draws only a class's first
  // annotation — the «abstract» under a stereotype is not in the picture
  if (classes.some((n) => n.data.stereotype && n.data.isAbstract)) {
    omitted.push("abstract shown with a stereotype");
  }

  const lines = ["classDiagram"];
  if (direction === "LR") lines.push("    direction LR");
  for (const node of classes) {
    const id = ids.get(node.id);
    if (!id) continue;
    const name = node.data.label || node.id;
    const head = name === id ? `class ${id}` : `class ${id}["${flowchartLabel(name)}"]`;
    const body = [
      ...(node.data.stereotype ? [`<<${member(node.data.stereotype)}>>`] : []),
      ...(node.data.isAbstract ? ["<<abstract>>"] : []),
      ...(node.data.attributes ?? []).map(member),
      ...(node.data.methods ?? []).map(member),
    ].filter(Boolean);
    if (body.length === 0) {
      lines.push(`    ${head}`);
      continue;
    }
    lines.push(`    ${head} {`, ...body.map((l) => `        ${l}`), "    }");
  }

  for (const edge of doc.edges) {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (!source || !target) continue;
    const start = effectiveMarkerStart(edge.data);
    const end = effectiveMarkerEnd(edge.data);
    const left = LEFT_END[start] ?? "";
    const right = RIGHT_END[end] ?? "";
    if ((start !== "none" && !left) || (end !== "none" && !right)) omitted.push("line end shapes");
    if (
      edge.data?.color ||
      (edge.data?.width ?? DEFAULT_EDGE_WIDTH) !== DEFAULT_EDGE_WIDTH ||
      (edge.data?.opacity ?? 1) < 1
    ) {
      omitted.push("line colors and widths");
    }
    const link = (edge.data?.variant ?? "solid") === "solid" ? "--" : "..";
    lines.push(
      `    ${source}${cardinality(edge.data?.labelStart)} ${left}${link}${right}${cardinality(edge.data?.labelEnd)} ${target}${relationLabel(edge.data?.label)}`,
    );
  }

  lines.push(...colorStyles(classes, ids));
  return withOmittedNote(lines, "classDiagram", omitted).join("\n");
};
