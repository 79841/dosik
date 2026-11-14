import { LAYOUT_DIRECTIONS, type LayoutDirection } from "../../../shared/lib/autoLayout";
import type { AgentOp } from "../../../shared/lib/types";

/** the Mermaid diagrams the canvas can draw (#200) — the four the export writes */
export type ImportKind = "flowchart" | "sequence" | "class" | "er";

/** a subgraph: the frame's id and what it holds — shapes, or the frames of inner subgraphs */
export interface Cluster {
  id: string;
  members: string[];
}

/**
 * What a Mermaid diagram becomes (#200 D4): agent ops that build it in an
 * empty store, what could not come along, and how to arrange it — null for a
 * sequence diagram, whose ops already place every part.
 */
export interface ImportPlan {
  kind: ImportKind;
  ops: AgentOp[];
  omitted: string[];
  layout: { direction: LayoutDirection; clusters: Cluster[] } | null;
}

/** the message a toast shows, as is — the paste path tells it to the user (D6) */
export class MermaidImportError extends Error {}

/** Mermaid's `TB`/`TD`/`BT`/`LR`/`RL` as the layout's direction — `TD` is `TB` (#206) */
export const layoutDirection = (direction: string | undefined): LayoutDirection =>
  LAYOUT_DIRECTIONS.find((d) => d === direction) ?? "TB";
