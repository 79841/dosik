import { LIFELINE_HEADER_H } from "../../shared/lib/palette";
import type { ClipboardFragment } from "../../shared/lib/store/clipboard";
import { documentFile } from "../../shared/lib/store/document";
import type { AgentOp, DiagramDoc, PaletteColor, ShapeKind } from "../../shared/lib/types";
import { buildFragment } from "../mermaid/import/buildFragment";
import {
  ACTIVATION_LEAD,
  ACTIVATION_TAIL,
  COLUMN,
  FIRST_GAP,
  ROW,
} from "../mermaid/import/fromSequence";
import type { ImportKind, ImportPlan } from "../mermaid/import/plan";

/**
 * Home's START templates (#220 D7). Each is an agent-op plan shaped like a
 * Mermaid import's, built by the same `buildFragment` in a throwaway store —
 * so op validation, fixed edge sides (`pickHandles`), message handles and the
 * dagre layout are the paste's own (#200), and no mermaid.js is loaded. The
 * colours and shapes pair with the START tiles' little pictures. Text in a
 * diagram is English, like the rest of the app.
 */

export const STARTER_KINDS: readonly ImportKind[] = ["flowchart", "sequence", "class", "er"];

/** a new diagram's title — its kind's name; From Mermaid… names its result the same way (D15) */
export const STARTER_TITLE: Record<ImportKind, string> = {
  flowchart: "Flowchart",
  sequence: "Sequence diagram",
  class: "Class diagram",
  er: "ER diagram",
};

type NodeOp = Extract<AgentOp, { op: "add_node" }>;

/** a shape at the origin — the layout (or `extra`) places it */
const node = (
  id: string,
  label: string,
  shape: ShapeKind,
  color: PaletteColor,
  extra: Partial<NodeOp["node"]> = {},
): NodeOp => ({ op: "add_node", node: { id, label, shape, color, x: 0, y: 0, ...extra } });

const flowchart = (): ImportPlan => ({
  kind: "flowchart",
  ops: [
    node("start", "Start", "rounded", "ink"),
    node("check", "Valid input?", "diamond", "violet"),
    node("save", "Save", "rect", "green"),
    node("error", "Show error", "rect", "rose"),
    { op: "add_edge", edge: { id: "e0", source: "start", target: "check" } },
    { op: "add_edge", edge: { id: "e1", source: "check", target: "save", label: "Yes" } },
    { op: "add_edge", edge: { id: "e2", source: "check", target: "error", label: "No" } },
  ],
  omitted: [],
  layout: { direction: "LR", clusters: [] },
});

/** placed by its ops, at the import's spacing — four rows of messages under the headers */
const sequence = (): ImportPlan => {
  const lifelines = [
    ["client", "Client", "blue"],
    ["server", "Server", "mono"],
    ["db", "Database", "teal"],
  ] as const;
  const messages = [
    ["client", "server", "GET /items", "solid", "arrow"],
    ["server", "db", "SELECT items", "solid", "arrow"],
    ["db", "server", "rows", "dashed", "open"],
    ["server", "client", "200 OK", "dashed", "open"],
  ] as const;
  const firstY = LIFELINE_HEADER_H + FIRST_GAP;
  const lastY = firstY + (messages.length - 1) * ROW;
  const height = firstY + messages.length * ROW + ROW;
  return {
    kind: "sequence",
    ops: [
      ...lifelines.map(([id, label, color], i) =>
        node(id, label, "lifeline", color, { x: i * COLUMN, height }),
      ),
      ...messages.map(
        ([from, to, label, variant, markerEnd], i): AgentOp => ({
          op: "add_message",
          message: { id: `m${i}`, from, to, y: firstY + i * ROW, label, variant, markerEnd },
        }),
      ),
      {
        op: "add_activation",
        lifeline: "server",
        y0: firstY - ACTIVATION_LEAD,
        y1: lastY + ACTIVATION_TAIL,
      },
    ],
    omitted: [],
    layout: null,
  };
};

/** `Animal <|-- Dog`: the triangle sits at the parent, which the layout ranks first (#206) */
const classes = (): ImportPlan => ({
  kind: "class",
  ops: [
    node("animal", "Animal", "class", "violet"),
    node("dog", "Dog", "class", "blue"),
    {
      op: "update_node",
      id: "animal",
      set: { attributes: ["+ name: string"], methods: ["+ speak(): void"] },
    },
    { op: "update_node", id: "dog", set: { methods: ["+ fetch(): void"] } },
    {
      op: "add_edge",
      edge: {
        id: "e0",
        source: "animal",
        target: "dog",
        markerStart: "triangle",
        markerEnd: "none",
      },
    },
  ],
  omitted: [],
  layout: { direction: "LR", clusters: [] },
});

const er = (): ImportPlan => ({
  kind: "er",
  ops: [
    node("customer", "CUSTOMER", "entity", "teal", {
      columns: ["id uuid PK", "name text", "email text"],
    }),
    node("order", "ORDER", "entity", "amber", {
      columns: ["id uuid PK", "customer_id uuid FK", "total numeric", "created_at timestamp"],
    }),
    {
      op: "add_edge",
      edge: {
        id: "e0",
        source: "customer",
        target: "order",
        markerStart: "one",
        markerEnd: "zero-many",
        label: "places",
      },
    },
  ],
  omitted: [],
  layout: { direction: "LR", clusters: [] },
});

const PLANS: Record<ImportKind, () => ImportPlan> = { flowchart, sequence, class: classes, er };

export const starterPlan = (kind: ImportKind): ImportPlan => PLANS[kind]();

/**
 * A built piece of diagram as a document — written the way the
 * store writes a diagram (`documentFile`: a copy, no live-UI fields), so its
 * bytes are what autosave would write.
 */
export const docFromFragment = (fragment: ClipboardFragment, title: string): DiagramDoc =>
  documentFile({ title, nodes: fragment.nodes, edges: fragment.edges });

export const starterDoc = (kind: ImportKind): DiagramDoc =>
  docFromFragment(buildFragment(starterPlan(kind)), STARTER_TITLE[kind]);
