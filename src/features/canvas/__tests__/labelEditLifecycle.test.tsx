import { Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { LabeledEdge } from "../LabeledEdge";

// the line-end grips ride ViewportPortal (#204 D15), whose target only a full
// canvas has — render them in place here
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * #76-1 — if an edge is deleted while its label is being edited, the edit state (edgeLabelEdit) must clear.
 * If it lingers, an edge recreated with the same ID mounts in edit mode,
 * and the #74 guard reads that stale state and hides the handles too.
 */
const seed = () => {
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 300, y: 0 })],
      [
        {
          ...makeEdge({ id: "e", source: "a", target: "b", label: "flow" }),
          sourceHandle: "right-50",
          targetHandle: "left-50",
          selected: true,
        },
      ],
    ),
    null,
  );
  useCanvasUiStore.getState().setEdgeLabelEdit(null);
};

const renderEdge = () => {
  const edge = useDiagramStore.getState().edges.find((e) => e.id === "e")!;
  return render(
    <ReactFlowProvider>
      <svg aria-label="canvas">
        <LabeledEdge
          id="e"
          source="a"
          target="b"
          sourceX={160}
          sourceY={28}
          targetX={300}
          targetY={28}
          sourcePosition={Position.Right}
          targetPosition={Position.Left}
          sourceHandleId={edge.sourceHandle}
          targetHandleId={edge.targetHandle}
          selected
          data={edge.data}
        />
      </svg>
    </ReactFlowProvider>,
  );
};

const editState = () => useCanvasUiStore.getState().edgeLabelEdit;

describe("label edit state lifecycle (#76)", () => {
  beforeEach(seed);

  it("deleting an edge on the canvas clears the edit state", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore.getState().onEdgesChange([{ id: "e", type: "remove" }]);
    expect(editState()).toBeNull();
  });

  it("the bridge's delete_edge also clears the edit state", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    const result = useDiagramStore.getState().applyOps([{ op: "delete_edge", id: "e" }]);
    expect(result.errors).toEqual([]);
    expect(editState()).toBeNull();
  });

  it("the bridge's clear also clears the edit state", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore.getState().applyOps([{ op: "clear" }]);
    expect(editState()).toBeNull();
  });

  it("an edge created with the same ID after deletion doesn't mount in edit mode", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore.getState().onEdgesChange([{ id: "e", type: "remove" }]);
    // The agent recreates the edge with the same ID (the bridge lets the client choose IDs)
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_edge", edge: { id: "e", source: "a", target: "b" } }]);

    renderEdge();
    // If the stale edit state had lingered, the #74 guard would hide the endpoint handles
    expect(document.querySelectorAll("[data-line-end]").length).toBe(2);
  });

  it("deleting another edge leaves the edit state alone", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_edge", edge: { id: "e2", source: "a", target: "b" } }]);
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore.getState().applyOps([{ op: "delete_edge", id: "e2" }]);
    expect(editState()).toEqual({ edgeId: "e", which: "center" });
  });

  it("delete_node's cascading edge deletion also clears the edit state", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore.getState().applyOps([{ op: "delete_node", id: "a" }]);
    expect(editState()).toBeNull();
  });

  it("loading another document clears the edit state", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore.getState().loadDoc(makeDoc([], [], "New"), null);
    expect(editState()).toBeNull();
  });

  it("replacing with a document containing the same ID (loadDoc) also clears the edit state", () => {
    // A wholesale replace is a single set, so an existence check can't catch it — docVersion does
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
          [makeEdge({ id: "e", source: "a", target: "b" })],
          "Same ids",
        ),
        null,
      );
    expect(editState()).toBeNull();
  });

  it("set_diagram containing the same ID also clears the edit state", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    const result = useDiagramStore.getState().applyOps([
      {
        op: "set_diagram",
        doc: makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
          [makeEdge({ id: "e", source: "a", target: "b" })],
          "Same ids",
        ),
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(editState()).toBeNull();
  });

  it("clears the edit state when undo removes the edge", () => {
    useDiagramStore.getState().commit();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_edge", edge: { id: "e3", source: "a", target: "b" } }]);
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e3", which: "center" });
    useDiagramStore.getState().undo();
    expect(editState()).toBeNull();
  });

  it("closes the edge context menu too when the edge disappears", () => {
    // Another symptom of the same cause — a menu pointing at a dead edge must not stay open
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 10, clientY: 10 });
    useDiagramStore.getState().applyOps([{ op: "delete_edge", id: "e" }]);
    expect(useCanvasUiStore.getState().edgeMenu).toBeNull();
  });
});
