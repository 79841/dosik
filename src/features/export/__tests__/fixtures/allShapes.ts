import { useDiagramStore } from "../../../../shared/lib/store";
import type { DiagramDoc, DiagramNode } from "../../../../shared/lib/types";

/**
 * Every shape kind, every edge case the SVG renderer has to agree with the
 * canvas on (#148) — built with bridge ops, so the nodes carry the handles,
 * sizes and member fields the app itself would give them. The vector tests
 * render it, and the side-by-side check against the canvas uses the same ops.
 */
export const ALL_SHAPES_OPS = [
  { op: "set_title", title: "All shapes" },
  // flow row
  { op: "add_node", node: { id: "rect", label: "Rect", shape: "rect", x: 0, y: 0, color: "blue" } },
  {
    op: "add_node",
    node: {
      id: "rounded",
      label: "Rounded box with a long label that wraps",
      shape: "rounded",
      x: 240,
      y: 0,
    },
  },
  {
    op: "add_node",
    node: { id: "ellipse", label: "Ellipse", shape: "ellipse", x: 480, y: 0, color: "teal" },
  },
  {
    op: "add_node",
    node: { id: "diamond", label: "Decide?", shape: "diamond", x: 720, y: -20, color: "amber" },
  },
  {
    op: "add_node",
    node: { id: "para", label: "Input", shape: "parallelogram", x: 0, y: 160, color: "green" },
  },
  {
    op: "add_node",
    node: { id: "db", label: "주문 DB", shape: "cylinder", x: 240, y: 140, color: "amber" },
  },
  {
    op: "add_node",
    node: { id: "hex", label: "Prepare", shape: "hexagon", x: 480, y: 160, color: "rose" },
  },
  {
    op: "add_node",
    node: {
      id: "note",
      label: "A sticky note\nwith two lines",
      shape: "sticky",
      x: 720,
      y: 140,
      color: "amber",
    },
  },
  { op: "add_node", node: { id: "txt", label: "Plain text", shape: "text", x: 0, y: 300 } },
  {
    op: "add_node",
    node: {
      id: "ico",
      label: "Payments Gateway",
      shape: "icon",
      icon: "database",
      x: 240,
      y: 300,
      color: "violet",
    },
  },
  // edges between them
  { op: "add_edge", edge: { id: "e1", source: "rect", target: "rounded", label: "HTTPS" } },
  {
    op: "add_edge",
    edge: {
      id: "e2",
      source: "rounded",
      target: "ellipse",
      label: "one",
      labelStart: "1",
      labelEnd: "*",
    },
  },
  {
    op: "add_edge",
    edge: {
      id: "e3",
      source: "rounded",
      target: "ellipse",
      label: "two",
      variant: "dashed",
      color: "rose",
    },
  },
  {
    op: "add_edge",
    edge: {
      id: "e4",
      source: "ellipse",
      target: "diamond",
      pathStyle: "curved",
      markerStart: "circle",
      markerEnd: "diamond-open",
    },
  },
  {
    op: "add_edge",
    edge: { id: "e5", source: "rounded", target: "db", label: "SQL", variant: "dotted", width: 2 },
  },
  {
    op: "add_edge",
    edge: {
      id: "e6",
      source: "db",
      target: "hex",
      pathStyle: "straight",
      markerEnd: "triangle",
      opacity: 0.6,
    },
  },
  { op: "add_edge", edge: { id: "e7", source: "hex", target: "hex", label: "retry" } },
  // class
  { op: "add_node", node: { id: "cls", label: "Order", shape: "class", x: 480, y: 300 } },
  {
    op: "update_node",
    id: "cls",
    set: {
      stereotype: "entity",
      attributes: ["-id: string", "+total: number"],
      methods: ["+pay(): void"],
    },
  },
  // sequence
  { op: "add_node", node: { id: "la", label: "Client", shape: "lifeline", x: 0, y: 520 } },
  {
    op: "add_node",
    node: { id: "lb", label: "API", shape: "lifeline", x: 320, y: 520, color: "blue" },
  },
  { op: "add_message", message: { id: "m1", from: "la", to: "lb", y: 600, label: "request()" } },
  {
    op: "add_message",
    message: { id: "m2", from: "lb", to: "la", y: 680, label: "response", variant: "dashed" },
  },
  { op: "add_message", message: { id: "m3", from: "lb", to: "lb", y: 740, label: "validate" } },
  { op: "add_message", message: { id: "m4", from: { x: -120 }, to: "la", y: 800, label: "found" } },
  { op: "add_message", message: { id: "m5", from: "lb", to: { x: 600 }, y: 820, label: "lost" } },
  { op: "add_activation", lifeline: "lb", y0: 80, y1: 200 },
  { op: "update_node", id: "lb", set: { destroyY: 330 } },
  {
    op: "add_node",
    node: {
      id: "frag",
      label: "[ok]",
      shape: "fragment",
      fragmentKind: "alt",
      branches: 2,
      x: -40,
      y: 570,
      width: 460,
      height: 150,
      color: "gray",
    },
  },
];

/**
 * The fixture as a document. A free arrow cannot be made through the bridge
 * (its ends are anchors, which only the arrow tool creates), so it is added to
 * the document directly and the result goes through `loadDoc` like a file.
 */
export const allShapesDoc = (): DiagramDoc => {
  const store = useDiagramStore.getState();
  store.loadDoc({ version: 1, title: "", nodes: [], edges: [] }, null);
  const result = useDiagramStore.getState().applyOps(ALL_SHAPES_OPS as never, true);
  if (result.errors.length > 0) throw new Error(result.errors.join("; "));
  const doc = useDiagramStore.getState().toDoc();
  const anchor = (id: string, x: number, y: number) => ({
    id,
    type: "shape",
    position: { x, y },
    width: 12,
    height: 12,
    data: { label: "", shape: "anchor" as const, color: "gray" as const },
  });
  doc.nodes.push(anchor("fa1", 720, 420) as DiagramNode, anchor("fa2", 900, 480) as DiagramNode);
  doc.edges.push({
    id: "free",
    type: "labeled",
    source: "fa1",
    target: "fa2",
    sourceHandle: "center",
    targetHandle: "center",
    data: { label: "free", markerEnd: "arrow", variant: "solid", arrow: true },
  });
  useDiagramStore.getState().loadDoc(doc, null);
  return useDiagramStore.getState().toDoc();
};
