import { nanoid } from "nanoid";

import { effectiveMarkerEnd, effectiveMarkerStart } from "../edgeUtils";
import type { DiagramEdge, DiagramEdgeData, DiagramNode, EdgeStylePatch } from "../types";
import { pickHandles } from "./nodeFactory";
import { LEGACY_DEFAULT_EDGE_WIDTH } from "./opValidation";

export const normalizeEdge = (raw: DiagramEdge, nodes: DiagramNode[]): DiagramEdge => {
  let { sourceHandle, targetHandle } = raw;
  if (!sourceHandle || !targetHandle) {
    const source = nodes.find((n) => n.id === raw.source);
    const target = nodes.find((n) => n.id === raw.target);
    if (source && target) {
      const picked = pickHandles(source, target);
      sourceHandle = sourceHandle ?? picked.sourceHandle;
      targetHandle = targetHandle ?? picked.targetHandle;
    }
  }
  const { width, ...rest } = raw.data ?? ({} as Partial<DiagramEdgeData>);
  // a line saved with the old default width stays a default line (#204)
  const data: Partial<DiagramEdgeData> =
    width === undefined || width === LEGACY_DEFAULT_EDGE_WIDTH ? rest : { ...rest, width };
  return {
    ...raw,
    type: "labeled",
    sourceHandle,
    targetHandle,
    data: {
      ...data,
      variant: data.variant ?? "solid",
      arrow: data.arrow ?? true,
      markerEnd: effectiveMarkerEnd(data),
      markerStart: effectiveMarkerStart(data),
    },
  };
};

/** Creates an edge applying the remembered last-used style. */
export const makeEdge = (
  base: Pick<DiagramEdge, "source" | "target" | "sourceHandle" | "targetHandle"> & {
    id?: string;
  },
  style: EdgeStylePatch,
  overrides: Partial<DiagramEdgeData> = {},
): DiagramEdge => ({
  id: base.id ?? nanoid(8),
  type: "labeled",
  source: base.source,
  target: base.target,
  sourceHandle: base.sourceHandle,
  targetHandle: base.targetHandle,
  data: {
    variant: "solid",
    arrow: true,
    // a new line ends in the open chevron (#210 D24); a file's lines keep theirs
    markerEnd: "open",
    markerStart: "none",
    ...style,
    ...overrides,
  },
});
