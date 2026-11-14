import { scratchDiagramStore } from "../../../shared/lib/store";
import type { ClipboardFragment } from "../../../shared/lib/store/clipboard";
import { withoutSelection } from "../../../shared/lib/store/history";
import { applyLayout } from "../../../shared/lib/store/layout";
import { arrangeImport } from "./arrange";
import { type ImportPlan, MermaidImportError } from "./plan";

/**
 * An import plan built into a detached piece of document (#200 D4): its ops
 * applied to an empty throwaway store — the same validation, sizing and
 * fixed edge sides an agent's ops get — then arranged. Positions start at
 * the origin; landing it is the caller's.
 */
export const buildFragment = (plan: ImportPlan): ClipboardFragment => {
  const work = scratchDiagramStore();
  const { errors } = work.getState().applyOps(plan.ops);
  if (errors.length > 0) {
    throw new MermaidImportError(`Could not draw the Mermaid diagram: ${errors[0]}`);
  }
  if (plan.layout) {
    const { nodes, edges } = work.getState();
    const arrangement = arrangeImport(nodes, edges, plan.layout.direction, plan.layout.clusters);
    applyLayout(work.getState, work.setState, arrangement);
  }
  const { nodes, edges } = work.getState();
  return { nodes: withoutSelection(nodes), edges: withoutSelection(edges) };
};
