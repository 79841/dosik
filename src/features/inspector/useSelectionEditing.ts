import { DEFAULT_NODE_SIZE, LIFELINE_HEADER_H } from "../../shared/lib/palette";
import { useDiagramStore } from "../../shared/lib/store";
import {
  clampActivation,
  MIN_ACTIVATION_H,
  sanitizeActivations,
  visibleDestroyY,
} from "../../shared/lib/store/opValidation";
import type {
  DiagramEdge,
  DiagramNode,
  LifelineActivation,
  PaletteColor,
  ShapeKind,
} from "../../shared/lib/types";

export interface SelectionEditing {
  /** selected nodes excluding anchor dots (free-arrow endpoints) */
  shapeNodes: DiagramNode[];
  selectedNodes: DiagramNode[];
  selectedEdges: DiagramEdge[];
  firstNode: DiagramNode | undefined;
  firstEdge: DiagramEdge | undefined;
  /** the selection is exactly one lifeline — activation editing target */
  soleLifeline: DiagramNode | undefined;
  setNodeColor: (color: PaletteColor) => void;
  setNodeShape: (shape: ShapeKind) => void;
  patchEdges: (patch: Partial<NonNullable<DiagramEdge["data"]>>) => void;
  /** Replaces a lifeline's activations (sanitized; unusable input is a no-op). */
  patchActivations: (nodeId: string, activations: LifelineActivation[]) => void;
  /** Edits one end of one bar, clamped into the lifeline like the canvas grips. */
  setActivationEnd: (nodeId: string, index: number, end: "y0" | "y1", value: number) => void;
  /** Appends an activation in free space below the last bar. */
  addActivation: (nodeId: string) => void;
  /** false when the lifeline has no room left — the Add control disables on this. */
  canAddActivation: boolean;
  /** Sets or clears (null) the destroy marker; out-of-line values are ignored. */
  setDestroyY: (nodeId: string, y: number | null) => void;
  /** every selected lifeline — the align actions operate on these */
  selectedLifelines: DiagramNode[];
  alignLifelines: (mode: "tops" | "distribute") => void;
  /** false when any selected node has edges — a frame has no handles to keep them */
  canBecomeFragment: boolean;
  /** the selection is exactly one fragment — frame editing target */
  soleFragment: DiagramNode | undefined;
  /** the one selected class box, when exactly one shape is selected */
  soleClass: DiagramNode | undefined;
  /** the one selected ERD entity, when exactly one shape is selected (#5) */
  soleEntity: DiagramNode | undefined;
  /** every selected edge runs between two entities — the ERD presets apply */
  erdEdges: boolean;
  setNodeZ: (to: "front" | "back") => void;
  removeActivation: (nodeId: string, index: number) => void;
  deleteSelection: () => void;
  reverseSelectedEdges: () => void;
}

/**
 * The selected shapes an edit applies to — free-arrow ends (anchors) are not
 * shapes to colour, order or decorate. The edit bar and the shape menu both
 * pick through this, so the two can never disagree (#159).
 */
export const pickedShapes = (nodes: DiagramNode[]): DiagramNode[] =>
  nodes.filter((n) => n.selected && n.data.shape !== "anchor");

/**
 * Selection-derived state and multi-select edit actions for the edit bar (#159,
 * once the inspector) and the shape menu.
 * Every action applies to the whole selection, not just the first element.
 */
export const useSelectionEditing = (): SelectionEditing => {
  const nodes = useDiagramStore((s) => s.nodes);
  const edges = useDiagramStore((s) => s.edges);
  const updateNodeData = useDiagramStore((s) => s.updateNodeData);
  const updateEdgeData = useDiagramStore((s) => s.updateEdgeData);
  const deleteElements = useDiagramStore((s) => s.deleteElements);
  const reverseEdge = useDiagramStore((s) => s.reverseEdge);
  const alignLifelines = useDiagramStore((s) => s.alignLifelines);
  const setNodeZ = useDiagramStore((s) => s.setNodeZ);
  const setNodeStyleForShape = useDiagramStore((s) => s.setNodeStyleForShape);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const shapeNodes = pickedShapes(nodes);
  const selectedLifelines = shapeNodes.filter((n) => n.data.shape === "lifeline");
  const soleFragment =
    shapeNodes.length === 1 && shapeNodes[0]?.data.shape === "fragment" ? shapeNodes[0] : undefined;
  const soleLifeline =
    shapeNodes.length === 1 && shapeNodes[0]?.data.shape === "lifeline" ? shapeNodes[0] : undefined;
  const soleClass =
    shapeNodes.length === 1 && shapeNodes[0]?.data.shape === "class" ? shapeNodes[0] : undefined;
  const soleEntity =
    shapeNodes.length === 1 && shapeNodes[0]?.data.shape === "entity" ? shapeNodes[0] : undefined;
  // ERD presets only mean something between two tables (#5)
  const entityIds = new Set(nodes.filter((n) => n.data.shape === "entity").map((n) => n.id));
  const erdEdges =
    selectedEdges.length > 0 &&
    selectedEdges.every((e) => entityIds.has(e.source) && entityIds.has(e.target));

  /** Span a new bar would take, or null when the line has no room left. */
  const nextActivationSpan = (node: DiagramNode): LifelineActivation | null => {
    const h = node.height ?? DEFAULT_NODE_SIZE.lifeline.height;
    // the object stops existing at the destroy marker — no new bar past it
    const bottom = visibleDestroyY(node.data.destroyY, h) ?? h;
    const lastEnd = (node.data.activations ?? []).reduce(
      (max, a) => Math.max(max, a.y1),
      LIFELINE_HEADER_H,
    );
    // always below the last bar — pinning to the bottom instead would stack a
    // duplicate span on the last one once the line is full
    const y0 = lastEnd + 8;
    const y1 = Math.min(y0 + 40, bottom);
    return y1 - y0 < MIN_ACTIVATION_H ? null : { y0, y1 };
  };

  const patchActivations = (nodeId: string, activations: LifelineActivation[]): void => {
    const sanitized = sanitizeActivations(activations);
    if (sanitized === null && activations.length > 0) return;
    updateNodeData(nodeId, { activations: sanitized ?? [] });
  };

  return {
    shapeNodes,
    selectedNodes,
    selectedEdges,
    firstNode: shapeNodes[0],
    firstEdge: selectedEdges[0],
    soleLifeline,
    setNodeColor: (color) =>
      useDiagramStore.getState().setNodesColor(
        shapeNodes.map((n) => n.id),
        color,
      ),
    setNodeShape: (shape) => {
      for (const n of shapeNodes) {
        // a frame is an area, not a box — it neither becomes nor turns into one (#170 D8)
        if (shape === "frame" || n.data.shape === "frame") continue;
        // a frame has no handles, so a connected node turned into one would
        // strand its edges (present in the file, absent on canvas)
        if (
          shape === "fragment" &&
          n.data.shape !== "fragment" &&
          edges.some((e) => e.source === n.id || e.target === n.id)
        )
          continue;
        // an image is its picture (#8): nothing becomes one without a picture
        if (shape === "image" && n.data.shape !== "image") continue;
        updateNodeData(n.id, { shape });
        // style follows the shape (frames are click-through, boxes are not)
        setNodeStyleForShape(n.id, shape);
      }
    },
    patchEdges: (patch) => {
      for (const edge of selectedEdges) updateEdgeData(edge.id, patch);
    },
    patchActivations,
    setActivationEnd: (nodeId, index, end, value) => {
      if (!Number.isFinite(value)) return;
      const node = useDiagramStore.getState().nodes.find((n) => n.id === nodeId);
      if (node?.data.shape !== "lifeline") return;
      const acts = node.data.activations;
      const target = acts?.[index];
      if (!acts || !target) return;
      const h = node.height ?? DEFAULT_NODE_SIZE.lifeline.height;
      // clamp rather than reject — typing "250" into y0 while y1 is 180 should
      // push the bar down, not silently snap the field back to its old value
      const next = clampActivation(
        end === "y0" ? value : target.y0,
        end === "y1" ? value : target.y1,
        h,
      );
      // re-typing the same number (or one that clamps back to it) shouldn't
      // leave an undo frame that appears to do nothing
      if (next.y0 === target.y0 && next.y1 === target.y1) return;
      patchActivations(
        nodeId,
        acts.map((a, i) => (i === index ? next : a)),
      );
    },
    canAddActivation: soleLifeline ? nextActivationSpan(soleLifeline) !== null : false,
    canBecomeFragment: shapeNodes.every(
      (n) =>
        n.data.shape === "fragment" || !edges.some((e) => e.source === n.id || e.target === n.id),
    ),
    soleFragment,
    soleClass,
    soleEntity,
    erdEdges,
    setNodeZ: (to) =>
      setNodeZ(
        shapeNodes.map((n) => n.id),
        to,
      ),
    selectedLifelines,
    alignLifelines: (mode) =>
      alignLifelines(
        selectedLifelines.map((n) => n.id),
        mode,
      ),
    setDestroyY: (nodeId, y) => {
      const node = useDiagramStore.getState().nodes.find((n) => n.id === nodeId);
      if (node?.data.shape !== "lifeline") return;
      const h = node.height ?? DEFAULT_NODE_SIZE.lifeline.height;
      if (y === null) {
        if (node.data.destroyY === undefined) return;
        updateNodeData(nodeId, { destroyY: undefined });
        return;
      }
      const next = visibleDestroyY(y, h);
      // out of the line has no sensible place to move to — ignore rather than
      // silently snapping the marker somewhere the user didn't ask for
      if (next === null || next === node.data.destroyY) return;
      updateNodeData(nodeId, { destroyY: next });
    },
    addActivation: (nodeId) => {
      // read fresh state — two edits in a row must not act on a stale snapshot
      const node = useDiagramStore.getState().nodes.find((n) => n.id === nodeId);
      if (node?.data.shape !== "lifeline") return;
      const span = nextActivationSpan(node);
      if (!span) return; // no room left on the line
      patchActivations(nodeId, [...(node.data.activations ?? []), span]);
    },
    removeActivation: (nodeId, index) => {
      const node = useDiagramStore.getState().nodes.find((n) => n.id === nodeId);
      const acts = node?.data.activations;
      if (!acts || index < 0 || index >= acts.length) return;
      patchActivations(
        nodeId,
        acts.filter((_, i) => i !== index),
      );
    },
    deleteSelection: () =>
      deleteElements(
        selectedNodes.map((n) => n.id),
        selectedEdges.map((e) => e.id),
      ),
    reverseSelectedEdges: () => {
      for (const e of selectedEdges) reverseEdge(e.id);
    },
  };
};
