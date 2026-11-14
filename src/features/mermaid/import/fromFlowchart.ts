import { type IconId, isIconId } from "../../../shared/lib/iconIds";
import type { AgentOp, MarkerShape, PaletteColor, ShapeKind } from "../../../shared/lib/types";
import { decodeLabel, paletteFromStyles } from "./mermaidText";
import { type Cluster, type ImportPlan, layoutDirection } from "./plan";

/** the parts of Mermaid's flowchart db this reads (mermaid 11) */
interface FlowVertex {
  id: string;
  text?: string;
  type?: string;
  styles?: string[];
  classes?: string[];
}
interface FlowEdge {
  start: string;
  end: string;
  type?: string;
  stroke?: string;
  text?: string;
  style?: string[];
}
interface FlowSubGraph {
  id: string;
  title?: string;
  nodes: string[];
}
export interface FlowDb {
  getVertices(): Map<string, FlowVertex>;
  getEdges(): FlowEdge[];
  getSubGraphs(): FlowSubGraph[];
  getDirection(): string | undefined;
  getClasses(): Map<string, { styles?: string[] }>;
}

/**
 * Mermaid node shapes, classic brackets and the `@{ shape: … }` names alike,
 * as the canvas shapes nearest them. Anything else — flags, subroutines,
 * the many new shapes — is a box.
 */
const SHAPES: Record<string, ShapeKind> = {
  round: "rounded",
  rounded: "rounded",
  stadium: "ellipse",
  pill: "ellipse",
  circle: "ellipse",
  circ: "ellipse",
  "sm-circ": "ellipse",
  doublecircle: "ellipse",
  "dbl-circ": "ellipse",
  ellipse: "ellipse",
  diamond: "diamond",
  diam: "diamond",
  question: "diamond",
  decision: "diamond",
  hexagon: "hexagon",
  hex: "hexagon",
  cylinder: "cylinder",
  cyl: "cylinder",
  db: "cylinder",
  database: "cylinder",
  lean_right: "parallelogram",
  lean_left: "parallelogram",
  "lean-r": "parallelogram",
  "lean-l": "parallelogram",
  trapezoid: "parallelogram",
  inv_trapezoid: "parallelogram",
  "trap-b": "parallelogram",
  "trap-t": "parallelogram",
  text: "text",
};

/** an end of a link: `>` an arrowhead, `o` a circle, `x` a cross the canvas has no mark for */
const END: Record<string, MarkerShape> = { point: "arrow", circle: "circle", cross: "none" };

/** a `==>` link — heavier than the default the way Mermaid's thick link is */
const THICK_WIDTH = 2.8;

/**
 * The app's own export notes an icon node above its declaration:
 * `%% icon: database (n_db)` (#160). Read back, the box is that icon again.
 */
const iconNotes = (code: string): Map<string, IconId> => {
  const icons = new Map<string, IconId>();
  for (const m of code.matchAll(/^\s*%% icon: (\S+) \(([^)]+)\)\s*$/gm)) {
    if (isIconId(m[1])) icons.set(m[2]!, m[1]);
  }
  return icons;
};

export const fromFlowchart = (db: FlowDb, code: string): Omit<ImportPlan, "kind"> => {
  const omitted: string[] = [];
  const ops: AgentOp[] = [];
  const classDefs = db.getClasses();
  const icons = iconNotes(code);
  const ids = new Map<string, string>();
  const vertices = [...db.getVertices().values()];
  const subgraphs = db.getSubGraphs();
  const subgraphIds = new Set(subgraphs.map((s) => s.id));

  vertices.forEach((v, i) => {
    // a subgraph that an edge names shows up as a vertex too — it is drawn as its frame
    if (subgraphIds.has(v.id)) return;
    const id = `n${i}`;
    ids.set(v.id, id);
    const classes = v.classes ?? [];
    if (classes.includes("clickable")) omitted.push("click links");
    // `classDef default` styles every node without being listed in its classes
    const styles = [
      ...(classDefs.get("default")?.styles ?? []),
      ...classes.flatMap((name) => classDefs.get(name)?.styles ?? []),
      ...(v.styles ?? []),
    ];
    const color: PaletteColor | null = paletteFromStyles(styles);
    const icon = icons.get(v.id);
    ops.push({
      op: "add_node",
      node: {
        id,
        label: decodeLabel(v.text) || v.id,
        shape: icon ? "icon" : (SHAPES[v.type ?? ""] ?? "rect"),
        ...(icon ? { icon } : {}),
        ...(color ? { color } : {}),
        // in declaration order along the flow — the layout reads it for shapes with no links
        x: i * 10,
        y: i * 10,
      },
    });
  });

  const clusters: Cluster[] = [];
  subgraphs.forEach((s, i) => {
    const id = `f${i}`;
    ids.set(s.id, id);
    ops.push({
      op: "add_node",
      node: { id, label: decodeLabel(s.title) || s.id, shape: "frame", x: 0, y: 0 },
    });
  });
  for (const s of subgraphs) {
    clusters.push({
      id: ids.get(s.id)!,
      members: s.nodes.map((n) => ids.get(n)).filter((n): n is string => Boolean(n)),
    });
  }

  db.getEdges().forEach((e, i) => {
    // a frame cannot end a line on the canvas — a link to a subgraph itself is left out
    if (subgraphIds.has(e.start) || subgraphIds.has(e.end)) {
      omitted.push("links to subgraphs");
      return;
    }
    const source = ids.get(e.start);
    const target = ids.get(e.end);
    if (!source || !target) return;
    // `~~~` only spaces the layout; there is no line to draw
    if (e.stroke === "invisible") return;
    if (e.style?.length) omitted.push("link styles");
    const type = e.type ?? "arrow_point";
    const both = type.startsWith("double_arrow_");
    const end = END[type.replace(/^(double_)?arrow_/, "")] ?? "none";
    if (type.endsWith("_cross")) omitted.push("x line ends");
    ops.push({
      op: "add_edge",
      edge: {
        id: `e${i}`,
        source,
        target,
        ...(decodeLabel(e.text) ? { label: decodeLabel(e.text) } : {}),
        variant: e.stroke === "dotted" ? "dashed" : "solid",
        markerStart: both ? end : "none",
        markerEnd: end,
        ...(e.stroke === "thick" ? { width: THICK_WIDTH } : {}),
      },
    });
  });

  return {
    ops,
    omitted,
    layout: { direction: layoutDirection(db.getDirection()), clusters },
  };
};
