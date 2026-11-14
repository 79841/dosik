import {
  effectiveMarkerEnd,
  effectiveMarkerStart,
  handlePointOnNode,
  isSequenceMessage,
  nodeBounds,
} from "../../shared/lib/edgeUtils";
import { visibleActivation, visibleDestroyY } from "../../shared/lib/store/opValidation";
import { sequenceLabel } from "./mermaidEscape";
import { withOmittedNote } from "./mermaidNotes";
import type { DiagramDoc, DiagramEdge, DiagramNode } from "../../shared/lib/types";

/**
 * Mermaid `sequenceDiagram` generator.
 *
 * The canvas model has no message ordering field — **y is the only time axis**
 * (the same thing `resnapMessages` treats as the truth), so messages are sorted
 * by the absolute y of their source handle.
 *
 * Things Mermaid can't express are dropped and announced in a `%%` comment
 * rather than silently: found/lost messages (no off-diagram endpoint syntax),
 * non-sequence shapes, and activation bars that no message falls inside.
 */

/** A message paired with the absolute y that orders it. */
interface OrderedMessage {
  edge: DiagramEdge;
  y: number;
  source: DiagramNode;
  target: DiagramNode;
}

/**
 * Arrow shape plus which way it points. Mermaid always draws the head on the
 * right operand, so a start-only arrow is emitted with the operands swapped —
 * otherwise the head lands on the wrong end and Mermaid disagrees with the
 * canvas (which keeps it on the source side).
 */
const connector = (edge: DiagramEdge): { line: string; swap: boolean } => {
  const dashed = edge.data?.variant !== undefined && edge.data.variant !== "solid";
  const dash = dashed ? "--" : "-";
  const end = effectiveMarkerEnd(edge.data) !== "none";
  const start = effectiveMarkerStart(edge.data) !== "none";
  if (start && end) return { line: dashed ? "<<-->>" : "<<->>", swap: false };
  if (start) return { line: `${dash}>>`, swap: true };
  if (end) return { line: `${dash}>>`, swap: false };
  return { line: `${dash}>`, swap: false };
};

export const toMermaidSequence = (doc: DiagramDoc, ids: Map<string, string>): string => {
  const lifelines = doc.nodes.filter((n) => n.data.shape === "lifeline");
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const dropped: string[] = [];

  // participants left to right — Mermaid renders them in declaration order
  const ordered = [...lifelines].sort((a, b) => a.position.x - b.position.x);
  const lines = ["sequenceDiagram"];
  for (const n of ordered) {
    // a whitespace-only label passes the bridge's checkLabel but would emit an
    // empty alias, rendering the participant as a blank box
    const alias = sequenceLabel(n.data.label) || ids.get(n.id);
    lines.push(`    participant ${ids.get(n.id)} as ${alias}`);
  }

  const messages: OrderedMessage[] = [];
  for (const edge of doc.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    if (source.data.shape === "lifeline" && target.data.shape === "lifeline") {
      messages.push({ edge, y: handlePointOnNode(source, edge.sourceHandle).y, source, target });
      continue;
    }
    // a found/lost message has one end off-diagram; Mermaid has no syntax for it
    if (isSequenceMessage(edge, doc.nodes)) {
      dropped.push("found/lost messages");
      continue;
    }
    // free arrows drawn across the diagram aren't messages at all — they were
    // vanishing without a word, which the header comment promises not to do
    if (source.data.shape === "anchor" || target.data.shape === "anchor") {
      dropped.push("free arrows");
    }
  }
  messages.sort((a, b) => a.y - b.y);

  // activation bars are absolute y spans here but message-scoped in Mermaid —
  // approximate by wrapping the messages that fall inside each span
  const activateAfter = new Map<number, string[]>();
  const deactivateAfter = new Map<number, string[]>();
  for (const n of lifelines) {
    for (const raw of n.data.activations ?? []) {
      const b = nodeBounds(n);
      const span = visibleActivation(raw, b.height);
      if (!span) continue;
      const top = b.y + span.y0;
      const bottom = b.y + span.y1;
      const inside = messages
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.y >= top && m.y <= bottom)
        .filter(({ m }) => m.source.id === n.id || m.target.id === n.id);
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (!first || !last) {
        dropped.push("activation bars with no message inside");
        continue;
      }
      activateAfter.set(first.i, [...(activateAfter.get(first.i) ?? []), ids.get(n.id) ?? n.id]);
      deactivateAfter.set(last.i, [...(deactivateAfter.get(last.i) ?? []), ids.get(n.id) ?? n.id]);
    }
  }

  // Mermaid wants `destroy X` **before** the message that destroys it ("the
  // destroyed participant does not have an associated destroying message after
  // its declaration" otherwise), so it goes ahead of that lifeline's last message
  const destroyBefore = new Map<number, string[]>();
  for (const n of lifelines) {
    if (visibleDestroyY(n.data.destroyY, nodeBounds(n).height) === null) continue;
    let lastIndex = -1;
    messages.forEach((m, i) => {
      if (m.source.id === n.id || m.target.id === n.id) lastIndex = i;
    });
    if (lastIndex < 0) continue;
    destroyBefore.set(lastIndex, [...(destroyBefore.get(lastIndex) ?? []), ids.get(n.id) ?? n.id]);
  }

  messages.forEach((m, i) => {
    const label = sequenceLabel(m.edge.data?.label ?? "");
    for (const id of destroyBefore.get(i) ?? []) lines.push(`    destroy ${id}`);
    const { line, swap } = connector(m.edge);
    const left = ids.get(swap ? m.target.id : m.source.id);
    const right = ids.get(swap ? m.source.id : m.target.id);
    lines.push(`    ${left}${line}${right}: ${label || " "}`);
    for (const id of activateAfter.get(i) ?? []) lines.push(`    activate ${id}`);
    for (const id of deactivateAfter.get(i) ?? []) lines.push(`    deactivate ${id}`);
  });

  const nonSequence = doc.nodes.filter(
    (n) => n.data.shape !== "lifeline" && n.data.shape !== "anchor",
  );
  if (nonSequence.length > 0) dropped.push("non-sequence shapes");
  // sequenceDiagram has no per-participant style
  if (doc.nodes.some((n) => n.data.shape === "lifeline" && n.data.color !== "mono")) {
    dropped.push("colors");
  }
  return withOmittedNote(lines, "sequenceDiagram", dropped).join("\n");
};
