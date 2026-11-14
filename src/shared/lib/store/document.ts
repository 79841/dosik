import type { DiagramDoc, DiagramEdge, DiagramNode } from "../types";
import { isBackdrop } from "../palette";
import { normalizeEdge } from "./edgeFactory";
import { cloneSnapshot, withoutRuntimeFields } from "./history";
import { dropLoneGroupIds } from "./groups";
import { type NodeFallback, normalizeNode, pruneOrphanAnchors } from "./nodeFactory";
import { diagramDocErrors } from "./opValidation";
import type { DiagramState } from "./state";

/**
 * A diagram is one canvas (#229 D1): `{version: 1, title, nodes, edges}`.
 * What a file is checked against before it opens, how a load leaves it, and
 * what goes back to disk. Multi-page documents (v2, #7) were never shipped:
 * they are refused wherever they turn up, never migrated (D2).
 */

/**
 * Whether parsed JSON is a `.dosik.json` this app opens: an object whose
 * `nodes` and `edges` are arrays, with no `pages` key. The rest is
 * `docErrors`' job. The same test as Rust's `is_one_canvas`.
 */
export const isDiagramDocShape = (value: unknown): value is DiagramDoc => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as { nodes?: unknown; edges?: unknown };
  return !isMultiPage(value) && Array.isArray(v.nodes) && Array.isArray(v.edges);
};

/** whether parsed JSON is a multi-page document — a `pages` key at the top, whatever it holds */
export const isMultiPage = (value: unknown): boolean =>
  !!value && typeof value === "object" && !Array.isArray(value) && "pages" in value;

/** what the user reads when a document with pages is opened (#229 D2) */
export const MULTI_PAGE_ERROR = "This diagram has pages — Dosik now opens one-canvas diagrams only";

/** what is wrong with a document before it can be loaded */
export const docErrors = (doc: DiagramDoc): string[] =>
  diagramDocErrors({ ...doc, nodes: doc.nodes ?? [], edges: doc.edges ?? [] });

/**
 * A document as a file load leaves it: nodes normalized, edges that could
 * never render dropped. Backdrops (fragments, frames) have no handles, so an
 * edge touching one would sit invisible in the document and the exports;
 * every creation path rejects these, so a file that still carries one is
 * corrupt. Dropping an edge can strand the anchor that held its free end.
 */
export const normalizeDoc = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  fallback?: NodeFallback,
): { nodes: DiagramNode[]; edges: DiagramEdge[] } => {
  const normalizedNodes = dropLoneGroupIds(nodes.map((n) => normalizeNode(n, fallback)));
  const frames = new Set(normalizedNodes.filter((n) => isBackdrop(n.data.shape)).map((n) => n.id));
  const keptEdges = edges
    .filter((e) => !frames.has(e.source) && !frames.has(e.target))
    .map((e) => normalizeEdge(e, normalizedNodes));
  return { nodes: pruneOrphanAnchors(normalizedNodes, keptEdges), edges: keptEdges };
};

/**
 * The document as it goes to disk — the live store, or a tab's snapshot
 * (#218): a deep copy without selection or live-UI fields. Always v1.
 */
export const documentFile = (
  state: Pick<DiagramState, "title" | "nodes" | "edges">,
): DiagramDoc => {
  const snapshot = cloneSnapshot({ title: state.title, nodes: state.nodes, edges: state.edges });
  return {
    version: 1,
    title: state.title,
    nodes: snapshot.nodes.map(withoutRuntimeFields),
    edges: snapshot.edges,
  };
};

/**
 * Whether anything the file or the bridge carries may have changed between
 * two store states — the title, the nodes or the edges. Selection and
 * measurement churn rewrite `nodes` too; callers that write compare bytes
 * after this.
 */
export const documentMayHaveChanged = (
  a: Pick<DiagramState, "title" | "nodes" | "edges">,
  b: Pick<DiagramState, "title" | "nodes" | "edges">,
): boolean => a.nodes !== b.nodes || a.edges !== b.edges || a.title !== b.title;
