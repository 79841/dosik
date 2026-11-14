import type { DiagramEdge, DiagramNode } from "../types";
import type { Snapshot } from "./state";

export const HISTORY_LIMIT = 100;

export const deepClone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

/** Selection is live UI state — it never rides along into a snapshot or the clipboard. */
export const withoutSelection = <T extends { selected?: boolean }>(items: T[]): T[] =>
  items.map(({ selected: _selected, ...rest }) => rest as T);

/**
 * Deep copy of the nodes, except that pictures are shared. A `src` is an
 * immutable string of up to 2 MB, only ever replaced — but a structured clone
 * copies strings, so each of the 100 undo frames held its own copy of every
 * picture: about 95 MB per image (#155).
 */
const cloneNodes = (nodes: DiagramNode[]): DiagramNode[] =>
  nodes.map((node) => {
    const { src } = node.data;
    if (src === undefined) return deepClone(node);
    const { src: _src, ...data } = node.data;
    const copy = deepClone({ ...node, data });
    return { ...copy, data: { ...copy.data, src } };
  });

/**
 * Deep copy of the document with the selection stripped.
 *
 * Selection is live UI state, not document state. Storing it meant undo
 * *resurrected* a selection the user had just cleared — and since #47 the
 * revived selection silently re-scoped the next AI turn to that node (#56).
 * It also reached disk: `toDoc` clones the same way, so a saved `.dosik.json`
 * carried whatever happened to be selected when the user hit save, and
 * reopening the file restored it.
 *
 * `restoreSnapshot` puts the *live* selection back on the way out, so an undo
 * neither revives an old selection nor drops the current one.
 */
export const cloneSnapshot = (s: Snapshot): Snapshot => ({
  title: s.title,
  nodes: withoutSelection(cloneNodes(s.nodes)),
  edges: withoutSelection(deepClone(s.edges)),
});

/**
 * Re-applies the live selection to a snapshot on its way back into the store.
 * Ids that no longer exist in the restored document simply drop out — undoing
 * past a node's creation deselects it because there is nothing left to select.
 */
export const restoreSnapshot = (
  snapshot: Snapshot,
  live: { nodes: DiagramNode[]; edges: DiagramEdge[] },
): Snapshot => {
  const nodeIds = new Set(live.nodes.filter((n) => n.selected).map((n) => n.id));
  const edgeIds = new Set(live.edges.filter((e) => e.selected).map((e) => e.id));
  if (nodeIds.size === 0 && edgeIds.size === 0) return snapshot;
  return {
    title: snapshot.title,
    nodes: snapshot.nodes.map((n) => (nodeIds.has(n.id) ? { ...n, selected: true } : n)),
    edges: snapshot.edges.map((e) => (edgeIds.has(e.id) ? { ...e, selected: true } : e)),
  };
};

/**
 * Strips React Flow's live-UI fields from a node on its way to disk. `measured`
 * is the DOM size cache and `dragging` the drag flag — `applyNodeChanges`
 * writes both onto store nodes, and neither is part of the document
 * (`openapi.yaml` has no such fields). `selected` is stripped one level up by
 * `cloneSnapshot`, because history needs that one gone too.
 */
export const withoutRuntimeFields = <N extends { measured?: unknown; dragging?: unknown }>({
  measured: _measured,
  dragging: _dragging,
  ...node
}: N) => node as Omit<N, "measured" | "dragging">;
