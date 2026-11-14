import {
  DEFAULT_EDGE_WIDTH,
  effectiveMarkerEnd,
  effectiveMarkerStart,
  nodeBounds,
} from "../../shared/lib/edgeUtils";
import { frameContents } from "../../shared/lib/store/frames";
import { takesDecor } from "../../shared/lib/nodeDecor";
import { mermaidCardinality, parseColumn } from "../../shared/lib/entityShape";
import { isIconId } from "../../shared/lib/iconIds";
import type { DiagramDoc, DiagramNode, ShapeKind } from "../../shared/lib/types";
import { erAttributeWord, erLabel, flowchartLabel } from "./mermaidEscape";
import { toMermaidClass } from "./mermaidClass";
import { colorStyles, withOmittedNote } from "./mermaidNotes";
import { toMermaidSequence } from "./mermaidSequence";

const SHAPE_BRACKETS: Record<ShapeKind, [string, string]> = {
  anchor: ['["', '"]'],
  rect: ['["', '"]'],
  rounded: ['("', '")'],
  ellipse: ['(["', '"])'],
  diamond: ['{"', '"}'],
  parallelogram: ['[/"', '"/]'],
  cylinder: ['[("', '")]'],
  hexagon: ['{{"', '"}}'],
  sticky: ['["', '"]'],
  text: ['["', '"]'],
  lifeline: ['["', '"]'],
  // no flowchart equivalent — falls back to a plain box like lifeline does
  fragment: ['["', '"]'],
  // never declared as a node: a frame becomes a subgraph (#170 D9)
  frame: ['["', '"]'],
  // flowchart has no compartments; only the class name survives
  class: ['["', '"]'],
  // Mermaid has no icon concept — a box, with the icon id noted in a comment
  icon: ['["', '"]'],
  // a picture has no text form: the box carries its label (alt text) or "Image"
  image: ['["', '"]'],
  // in a flowchart an entity is a box with its name; a pure ERD exports as erDiagram
  entity: ['["', '"]'],
};

/**
 * Mermaid keywords that lex as syntax when they lead a line. Node ids come from
 * the caller (`add_node` takes them verbatim), so an agent naming a node `loop`
 * or `end` is realistic — and `end` has always broken flowchart too.
 */
const MERMAID_RESERVED = new Set([
  "end",
  "graph",
  "subgraph",
  "class",
  "click",
  "style",
  "loop",
  "alt",
  "else",
  "opt",
  "par",
  "and",
  "rect",
  "break",
  "critical",
  "option",
  "box",
  "note",
  "activate",
  "deactivate",
  "participant",
  "actor",
  "create",
  "destroy",
  "autonumber",
  "link",
  "links",
  "over",
  "off",
  "properties",
  "details",
  "sequencediagram",
  "erdiagram",
  // flowchart-only, and case-sensitive in Mermaid — the lowercase form is the
  // one that lexes as syntax, and ids are compared lowercased
  "linkstyle",
  "classdef",
  "flowchart",
  "interpolate",
  // a lone `o` reads as an aggregation end in classDiagram (`o --> b`), and
  // `x` as a cross end next to a link — found by #200's round trip
  "o",
  "x",
]);

const sanitizeIds = (nodes: DiagramNode[]): Map<string, string> => {
  const map = new Map<string, string>();
  const used = new Set<string>();
  nodes.forEach((node, index) => {
    let base = node.id.replace(/[^a-zA-Z0-9_]/g, "");
    if (!base || /^\d/.test(base)) base = `n${index}${base}`;
    if (MERMAID_RESERVED.has(base.toLowerCase())) base = `n_${base}`;
    let candidate = base;
    let suffix = 1;
    while (used.has(candidate)) candidate = `${base}_${suffix++}`;
    used.add(candidate);
    map.set(node.id, candidate);
  });
  return map;
};

const inferDirection = (nodes: DiagramNode[]): "LR" | "TD" => {
  if (nodes.length < 2) return "TD";
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  return spreadX > spreadY ? "LR" : "TD";
};

export const toMermaid = (doc: DiagramDoc): string => {
  // A lifeline is sequence-only, so a document holding one means sequence
  // intent — emit sequenceDiagram and drop what that syntax can't express.
  // "only when every node is a lifeline" would fall back to flowchart the
  // moment a fragment or note is added, which is the more surprising result.
  if (doc.nodes.some((n) => n.data.shape === "lifeline")) {
    return toMermaidSequence(doc, sanitizeIds(doc.nodes));
  }
  // A pure ERD — every shape an entity — is what erDiagram exists for (#5).
  // Mixed with other shapes it cannot be expressed, so it falls back to a
  // flowchart where each entity is a named box.
  const shapes = doc.nodes.filter((n) => n.data.shape !== "anchor");
  if (shapes.length > 0 && shapes.every((n) => n.data.shape === "entity")) {
    return toMermaidEr(doc, sanitizeIds(shapes));
  }
  // Likewise a pure class diagram is classDiagram (#194 feedback) — members,
  // stereotypes and UML relations intact; mixed, a class is a named box
  if (shapes.length > 0 && shapes.every((n) => n.data.shape === "class")) {
    return toMermaidClass(doc, sanitizeIds(shapes), inferDirection(shapes));
  }
  // Free-arrow anchor points have no textual meaning — exclude them and any
  // arrows attached to them.
  const anchorIds = new Set(doc.nodes.filter((n) => n.data.shape === "anchor").map((n) => n.id));
  const docNodes = doc.nodes.filter((n) => !anchorIds.has(n.id));
  const docEdges = doc.edges.filter((e) => !anchorIds.has(e.source) && !anchorIds.has(e.target));

  const ids = sanitizeIds(docNodes);
  const lines: string[] = [`flowchart ${inferDirection(docNodes)}`];
  /** what a flowchart cannot carry, told in a `%% omitted` note (#194) */
  const omitted: string[] = [];
  if (anchorIds.size > 0) omitted.push("free arrows");
  if (docNodes.some((n) => n.data.shape === "image" && n.data.src)) omitted.push("pictures");
  if (
    docNodes.some(
      (n) => n.data.shape === "class" && (n.data.attributes?.length || n.data.methods?.length),
    )
  ) {
    omitted.push("class members");
  }
  if (docNodes.some((n) => n.data.shape === "entity" && n.data.columns?.length)) {
    omitted.push("entity columns");
  }
  // Mermaid has no icon nodes: they become plain boxes, and the glyph is noted
  // in a comment right above the declaration, the same way found/lost messages
  // and free arrows are. Only a known id is written — `data.icon` is free text
  // from the file, and a newline in a comment would end it and feed the rest
  // to the parser as syntax
  // the sanitized id is repeated so a note stays attributable when an edge
  // line declares two icon nodes at once
  const iconNote = (node: DiagramNode): string | null =>
    // a box's icon too (#160) — the same note an icon node leaves
    node.data.shape === "icon" || (takesDecor(node.data.shape) && node.data.icon)
      ? `    %% icon: ${isIconId(node.data.icon) ? node.data.icon : "unknown"} (${ids.get(node.id)})`
      : null;

  const nodeDecl = (node: DiagramNode): string => {
    const [open, close] = SHAPE_BRACKETS[node.data.shape];
    const fallback = node.data.shape === "image" ? "Image" : node.id;
    // a box's badge rides on its label and its description takes the next
    // line (#160 D8); the icon has no words to give
    const { badge, description } = node.data;
    const text =
      (node.data.label || fallback) +
      (badge ? ` [${badge}]` : "") +
      (description ? `\n${description}` : "");
    return `${ids.get(node.id)}${open}${flowchartLabel(text)}${close}`;
  };

  const byId = new Map(docNodes.map((n) => [n.id, n]));
  const declared = new Set<string>();

  for (const edge of docEdges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    // a self-loop names the same node twice — note it once
    for (const node of source === target ? [source] : [source, target]) {
      if (declared.has(node.id)) continue;
      const note = iconNote(node);
      if (note) lines.push(note);
    }
    const left = declared.has(source.id) ? ids.get(source.id) : nodeDecl(source);
    const right = declared.has(target.id) ? ids.get(target.id) : nodeDecl(target);
    declared.add(source.id);
    declared.add(target.id);

    const dashed = edge.data?.variant !== undefined && edge.data.variant !== "solid";
    const startArrow = effectiveMarkerStart(edge.data) !== "none";
    const endArrow = effectiveMarkerEnd(edge.data) !== "none";
    // a flowchart has one arrowhead; a circle, a diamond, a bar or a crow's
    // foot on the canvas comes out as that arrow
    if (
      !ARROW_LIKE.has(effectiveMarkerStart(edge.data)) ||
      !ARROW_LIKE.has(effectiveMarkerEnd(edge.data))
    ) {
      omitted.push("line end shapes");
    }
    if (edge.data?.labelStart?.trim() || edge.data?.labelEnd?.trim())
      omitted.push("line end labels");
    if (
      edge.data?.color ||
      (edge.data?.width ?? DEFAULT_EDGE_WIDTH) !== DEFAULT_EDGE_WIDTH ||
      (edge.data?.opacity ?? 1) < 1
    ) {
      omitted.push("line colors and widths");
    }
    let connector: string;
    if (startArrow && endArrow) connector = dashed ? "<-.->" : "<-->";
    else if (endArrow || startArrow) connector = dashed ? "-.->" : "-->";
    else connector = dashed ? "-.-" : "---";
    const label = edge.data?.label?.trim();
    if (label) {
      connector = `${connector}|${flowchartLabel(label)}|`;
    }
    // Mermaid flowcharts have no left-pointing arrow: a head only at the
    // source end is the edge read backwards, so write it the way it points —
    // the same reading the layout uses (#182)
    const backwards = startArrow && !endArrow;
    lines.push(
      backwards ? `    ${right} ${connector} ${left}` : `    ${left} ${connector} ${right}`,
    );
  }

  for (const node of docNodes) {
    if (declared.has(node.id) || node.data.shape === "frame") continue;
    const note = iconNote(node);
    if (note) lines.push(note);
    lines.push(`    ${nodeDecl(node)}`);
  }

  lines.push(...frameSubgraphs(docNodes, ids));
  // a frame is a subgraph, and a subgraph takes a `style` line too
  lines.push(...colorStyles(docNodes, ids));
  return withOmittedNote(lines, "flowchart", omitted).join("\n");
};

/** the canvas ends a flowchart draws as its one arrowhead (or none) */
const ARROW_LIKE = new Set(["none", "arrow", "open", "triangle"]);

/** a frame's subgraph title: its label, and its badge in brackets as a box's is (#210 D23) */
const frameTitle = (frame: DiagramNode): string => {
  const title = frame.data.label || "Frame";
  return frame.data.badge ? `${title} [${frame.data.badge}]` : title;
};

/**
 * Frames as subgraphs (#170 D9): each holds what lies wholly inside it — a
 * shape inside two frames goes to the smaller one, and a frame inside another
 * is a subgraph within it. Mentioning an already declared node inside a
 * subgraph is how Mermaid places it there.
 */
const frameSubgraphs = (nodes: DiagramNode[], ids: Map<string, string>): string[] => {
  const frames = nodes.filter((n) => n.data.shape === "frame");
  if (frames.length === 0) return [];
  const area = (n: DiagramNode) => {
    const b = nodeBounds(n);
    return b.width * b.height;
  };
  // each node's innermost frame
  const parent = new Map<string, string>();
  /** whether `ancestor` is `id` or already holds it, through the chain */
  const holds = (ancestor: string, id: string): boolean => {
    for (let p: string | undefined = id; p; p = parent.get(p)) if (p === ancestor) return true;
    return false;
  };
  for (const frame of [...frames].sort((a, b) => area(b) - area(a))) {
    for (const id of frameContents(nodes, frame)) {
      // frames with the same bounds each lie inside the others — never let
      // the chain loop back, or every one of them drops out (#172)
      if (!holds(id, frame.id)) parent.set(id, frame.id);
    }
  }
  const children = (frameId: string | undefined) =>
    nodes.filter((n) => parent.get(n.id) === frameId);
  const out: string[] = [];
  const emit = (frame: DiagramNode, pad: string) => {
    out.push(`${pad}subgraph ${ids.get(frame.id)}["${flowchartLabel(frameTitle(frame))}"]`);
    for (const child of children(frame.id)) {
      if (child.data.shape === "frame") emit(child, `${pad}    `);
      else out.push(`${pad}    ${ids.get(child.id)}`);
    }
    out.push(`${pad}end`);
  };
  for (const frame of children(undefined).filter((n) => n.data.shape === "frame")) {
    emit(frame, "    ");
  }
  return out;
};

/**
 * Mermaid source as the fenced block a Markdown renderer draws — the one
 * definition the Markdown export and the preview's Copy both use (#194).
 */
export const fenceMermaid = (code: string): string => ["```mermaid", code, "```"].join("\n");

/**
 * The diagram as Markdown: its title, then one mermaid block (#192) — a
 * diagram is one canvas (#229 D17).
 */
export const toMarkdown = (doc: DiagramDoc): string =>
  [`# ${doc.title || "Untitled Diagram"}`, "", fenceMermaid(toMermaid(doc)), ""].join("\n");

/**
 * One column as an erDiagram attribute: `type name KEYS`, each word shaped by
 * `erAttributeWord` (any script survives — a Korean schema keeps its names);
 * a column with no type is `string`.
 */
const erAttribute = (line: string): string => {
  const { name, type, keys } = parseColumn(line);
  return [erAttributeWord(type, "string"), erAttributeWord(name, "column"), keys.join(", ")]
    .filter(Boolean)
    .join(" ");
};

/**
 * Mermaid erDiagram (#5): each entity with its columns, each edge between two
 * entities as a relationship whose cardinalities come from the crow's-foot
 * ends (`mermaidCardinality`). Labels are quoted — erDiagram requires one, so
 * an unlabelled edge gets an empty string.
 */
const toMermaidEr = (doc: DiagramDoc, ids: Map<string, string>): string => {
  const lines = ["erDiagram"];
  const omitted: string[] = [];
  if (doc.nodes.some((n) => n.data.shape === "anchor")) omitted.push("free arrows");
  if (doc.nodes.some((n) => n.data.shape === "entity" && n.data.color !== "mono")) {
    omitted.push("colors");
  }
  for (const node of doc.nodes) {
    const id = ids.get(node.id);
    if (!id) continue;
    lines.push(`    ${id}["${erLabel(node.data.label || node.id)}"] {`);
    for (const column of node.data.columns ?? []) lines.push(`        ${erAttribute(column)}`);
    lines.push("    }");
  }
  for (const edge of doc.edges) {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (!source || !target) continue;
    const left = mermaidCardinality(effectiveMarkerStart(edge.data), "left");
    const right = mermaidCardinality(effectiveMarkerEnd(edge.data), "right");
    // erDiagram has one broken line (non-identifying); every non-solid variant is it
    const line = (edge.data?.variant ?? "solid") === "solid" ? "--" : "..";
    lines.push(
      // a relationship takes an empty label; only an entity alias must not be blank
      `    ${source} ${left}${line}${right} ${target} : "${edge.data?.label ? erLabel(edge.data.label) : ""}"`,
    );
  }
  return withOmittedNote(lines, "erDiagram", omitted).join("\n");
};
