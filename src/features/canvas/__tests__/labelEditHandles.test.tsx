import { Position, ReactFlowProvider } from "@xyflow/react";
import { act, render } from "@testing-library/react";
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
 * #74 — while a label is being edited, handles must not overlap the label.
 * The double-click gesture can't be reproduced in this environment (same reason as the #43 harness),
 * so the edit state is put straight into the store and visibility is pinned.
 *
 * Middle segment grips live inside the EdgeLabelRenderer portal and don't render in this
 * harness — the endpoint handles verify the same `editingLabel` guard (grips share the
 * same guard; checking on a real device is up to the PR's How to verify).
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
  const edge = useDiagramStore.getState().edges[0]!;
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

/** Count of endpoint handles (r=6 circles) — a selected box-to-box edge normally has 2 */
const endpointHandles = () => document.querySelectorAll("[data-line-end]").length;

describe("handle visibility while editing a label (#74)", () => {
  beforeEach(seed);

  it.each(["center", "start", "end"] as const)(
    "%s label editing hides the endpoint handles when it starts and restores them when it ends",
    (which) => {
      renderEdge();
      expect(endpointHandles()).toBe(2);

      act(() => {
        useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which });
      });
      expect(endpointHandles()).toBe(0);

      act(() => {
        useCanvasUiStore.getState().setEdgeLabelEdit(null);
      });
      expect(endpointHandles()).toBe(2);
    },
  );

  it("editing another edge's label doesn't affect this edge's handles", () => {
    renderEdge();
    expect(endpointHandles()).toBe(2);

    act(() => {
      useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "other", which: "center" });
    });
    expect(endpointHandles()).toBe(2);
  });
});
