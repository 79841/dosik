import type { DiagramEdge, DiagramNode } from "../../shared/lib/types";

/** Items listed by id before the block collapses into "…and N more". */
const MAX_LISTED = 20;
/** Labels longer than this are cut — the AI can read the full text from the document. */
const MAX_LABEL = 20;
/**
 * Ids are cut too. They come from files and bridge ops, which only check that
 * they are strings, so an id can carry newlines — and this block sits at the
 * top of the user's turn, the most obeyed position in the prompt.
 */
const MAX_ID = 40;

export type SelectionSummary = {
  /** Selected nodes, minus the anchor dots that are just free-arrow endpoints. */
  nodeIds: string[];
  /** Selected edges, plus edges whose endpoints are both selected. */
  edgeIds: string[];
  /** Edges with exactly one endpoint inside — context, not part of the selection. */
  boundary: { id: string; source: string; target: string }[];
};

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Folds anything that could forge structure in the block, then neutralises the
 * quote that delimits labels.
 *
 * `\s` alone is not enough. It misses U+0085 (NEL) — a mandatory Unicode line
 * break that ECMAScript leaves out — along with the other C0/C1 controls,
 * zero-width joiners and bidi overrides (verified in Node). Ids reach here from
 * files and bridge ops, which only check that they are strings, and this block
 * sits at the top of the user's turn.
 *
 * NUL matters beyond forgery: the CLI provider passes the prompt as an argv
 * entry, and Rust refuses to spawn a process with an interior NUL, so one such
 * id would kill every chat turn while that node stayed selected.
 */
const oneLine = (text: string): string =>
  text
    .replace(/[\s\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/"/g, "'")
    .trim();

const cut = (text: string, max: number): string => {
  const flat = oneLine(text);
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const listed = (items: string[]): string => {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  const rest = items.length - MAX_LISTED;
  return rest > 0 ? `${shown}, …and ${rest} more` : shown;
};

/**
 * Reduces the canvas selection to the ids the AI needs. Edges follow the
 * clipboard convention every graph editor uses — only those with both
 * endpoints inside belong to the selection. Returns null when the selection
 * holds nothing worth naming.
 *
 * Anchors stay in the membership set so a selected free arrow still counts as
 * connected, but they are not reported: they carry no label and the inspector
 * already treats them as invisible to the user.
 */
export const summarizeSelection = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): SelectionSummary | null => {
  const selected = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
  const nodeIds = nodes.filter((n) => n.selected && n.data.shape !== "anchor").map((n) => n.id);
  const edgeIds: string[] = [];
  const boundary: SelectionSummary["boundary"] = [];

  for (const edge of edges) {
    const from = selected.has(edge.source);
    const to = selected.has(edge.target);
    if ((from && to) || edge.selected) edgeIds.push(edge.id);
    else if (from !== to) boundary.push({ id: edge.id, source: edge.source, target: edge.target });
  }

  if (nodeIds.length === 0 && edgeIds.length === 0) return null;
  return { nodeIds, edgeIds, boundary };
};

/** What the AI is told when the canvas has no selection at all. */
const NO_SELECTION =
  "[Selection] The user has nothing selected on the canvas. Ignore any selection named earlier in this conversation.";

/**
 * The block prepended to the outgoing message. Ids only — both providers can
 * read the full document themselves, so resending node properties would just
 * burn tokens on data the model already has access to.
 */
export const selectionContextBlock = (
  summary: SelectionSummary,
  nodes: DiagramNode[],
  edges: DiagramEdge[] = [],
): string => {
  const labelOf = new Map(nodes.map((n) => [n.id, n.data.label]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const parts: string[] = [];
  if (summary.nodeIds.length > 0) parts.push(count(summary.nodeIds.length, "node"));
  if (summary.edgeIds.length > 0) parts.push(count(summary.edgeIds.length, "edge"));

  const lines = [`[Selection] The user has selected ${parts.join(" and ")} on the canvas.`];
  const ends = (e: DiagramEdge): string => ` (${cut(e.source, MAX_ID)} → ${cut(e.target, MAX_ID)})`;

  if (summary.nodeIds.length > 0) {
    const named = summary.nodeIds.map((id) => {
      const label = labelOf.get(id);
      const safe = cut(id, MAX_ID);
      return label && label !== id ? `${safe} "${cut(label, MAX_LABEL)}"` : safe;
    });
    lines.push(`Nodes: ${listed(named)}`);
  }
  if (summary.edgeIds.length > 0) {
    // endpoints included so "make this dashed" on a lone edge needs no lookup
    const named = summary.edgeIds.map((id) => {
      const edge = edgeById.get(id);
      return `${cut(id, MAX_ID)}${edge ? ends(edge) : ""}`;
    });
    lines.push(`Edges: ${listed(named)}`);
  }
  if (summary.boundary.length > 0) {
    const described = summary.boundary.map(
      (e) => `${cut(e.id, MAX_ID)} (${cut(e.source, MAX_ID)} → ${cut(e.target, MAX_ID)})`,
    );
    lines.push(
      `${count(summary.boundary.length, "edge")} ${summary.boundary.length === 1 ? "leaves" : "leave"} this selection: ${listed(described)}.`,
    );
  }

  lines.push(
    'When the user says "this", "these", or "the selection", they mean these items.',
    "Focus your edits there unless they clearly ask for something else.",
  );
  return lines.join("\n");
};

/**
 * Prepends the selection block to a chat message. An empty selection still
 * says so: the CLI provider resumes its session, so a block from an earlier
 * turn would otherwise keep scoping edits after the user cleared the canvas.
 */
export const withSelectionContext = (
  text: string,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
): string => {
  const summary = summarizeSelection(nodes, edges);
  const block = summary ? selectionContextBlock(summary, nodes, edges) : NO_SELECTION;
  return `${block}\n\n${text}`;
};

/** Short label for the chip above the chat input, e.g. "3 nodes, 1 edge". */
export const selectionChipLabel = (summary: SelectionSummary): string =>
  [
    summary.nodeIds.length > 0 ? count(summary.nodeIds.length, "node") : null,
    summary.edgeIds.length > 0 ? count(summary.edgeIds.length, "edge") : null,
  ]
    .filter(Boolean)
    .join(", ");
