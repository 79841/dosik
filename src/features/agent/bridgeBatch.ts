import { REMOVED_PAGE_OPS } from "../../shared/lib/store/agentOps";
import type { AgentOp, NewDiagramOp } from "../../shared/lib/types";

/**
 * How the bridge cuts a batch of `POST /api/ops` (#229 D15) — pure, so the
 * order of what lands where is testable without the app.
 */

/** a `new_diagram` and the ops after it, up to the next one — what goes to that diagram */
export interface BatchPart {
  create: NewDiagramOp;
  ops: AgentOp[];
}

/**
 * The batch cut at each `new_diagram`: `lead` goes to the diagram on screen
 * (or Home's new one), each part to the diagram its `new_diagram` starts.
 */
export const splitAtNewDiagram = (ops: AgentOp[]): { lead: AgentOp[]; parts: BatchPart[] } => {
  const lead: AgentOp[] = [];
  const parts: BatchPart[] = [];
  for (const op of ops) {
    if (op.op === "new_diagram") parts.push({ create: op, ops: [] });
    else (parts.at(-1)?.ops ?? lead).push(op);
  }
  return { lead, parts };
};

/**
 * The batch up to and including its first removed page op — the store
 * refuses that op, and nothing after it may land anywhere, `new_diagram`
 * parts included. `dropped` counts the ops cut off, over the whole batch.
 */
export const cutAtRemovedOp = (
  ops: AgentOp[],
): { ops: AgentOp[]; cut: { op: string; dropped: number } | null } => {
  const at = ops.findIndex((op) => REMOVED_PAGE_OPS.has((op as { op?: unknown }).op as string));
  if (at < 0) return { ops, cut: null };
  return {
    ops: ops.slice(0, at + 1),
    cut: { op: (ops[at] as { op: string }).op, dropped: ops.length - at - 1 },
  };
};
