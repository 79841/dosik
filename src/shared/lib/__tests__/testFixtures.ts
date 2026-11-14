import type { DiagramDoc, DiagramEdge, DiagramNode } from "../types";

export const makeNode = (overrides: {
  id: string;
  label?: string;
  shape?: DiagramNode["data"]["shape"];
  color?: DiagramNode["data"]["color"];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): DiagramNode => ({
  id: overrides.id,
  type: "shape",
  position: { x: overrides.x ?? 0, y: overrides.y ?? 0 },
  width: overrides.width ?? 160,
  height: overrides.height ?? 56,
  data: {
    label: overrides.label ?? overrides.id,
    shape: overrides.shape ?? "rounded",
    color: overrides.color ?? "violet",
  },
});

export const makeEdge = (overrides: {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  variant?: "solid" | "dashed";
  arrow?: boolean;
}): DiagramEdge => ({
  id: overrides.id,
  type: "labeled",
  source: overrides.source,
  target: overrides.target,
  sourceHandle: overrides.sourceHandle,
  targetHandle: overrides.targetHandle,
  data: {
    label: overrides.label,
    variant: overrides.variant ?? "solid",
    arrow: overrides.arrow ?? true,
  },
});

export const makeDoc = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  title = "Test",
): DiagramDoc => ({
  version: 1,
  title,
  nodes,
  edges,
});
