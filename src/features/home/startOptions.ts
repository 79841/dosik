import {
  ArrowLeftRight,
  Boxes,
  Code,
  Database,
  type LucideIcon,
  Plus,
  Workflow,
} from "lucide-react";

import type { StartKind } from "./newDiagram";

/** what START offers (D6) — a kind to make, or `mermaid`: the From Mermaid… dialog */
export type StartChoice = StartKind | "mermaid";

export interface StartOption {
  choice: StartChoice;
  label: string;
  /** the second line on a tile without a picture */
  sub?: string;
  /** the New menu's icon (D11, #231 D9) */
  icon: LucideIcon;
}

/** the six, in START's order — the dashboard's tiles and the New menu share it */
export const START_OPTIONS: readonly StartOption[] = [
  { choice: "blank", label: "Blank diagram", sub: "Empty canvas", icon: Plus },
  { choice: "flowchart", label: "Flowchart", icon: Workflow },
  { choice: "sequence", label: "Sequence", icon: ArrowLeftRight },
  { choice: "class", label: "Class", icon: Boxes },
  { choice: "er", label: "ERD", icon: Database },
  { choice: "mermaid", label: "From Mermaid…", sub: "Paste text", icon: Code },
];
