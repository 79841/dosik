import { Position, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { LabeledEdge } from "../LabeledEdge";

/**
 * #53 — dragging a middle segment past the stub with a body drag must stop at the stub.
 * Real-device drags aren't possible in this environment, so this pins it the same way as the #43 harness.
 */
const seedBent = () => {
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 400, y: 200 })],
      [
        {
          ...makeEdge({ id: "e", source: "a", target: "b" }),
          sourceHandle: "right-50",
          targetHandle: "left-50",
          selected: true,
        },
      ],
    ),
    null,
  );
  // Set up a middle vertical segment (a staple shape)
  useDiagramStore.getState().updateEdgeData("e", {
    waypoints: [
      { x: 280, y: 28 },
      { x: 280, y: 228 },
    ],
  });
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
          targetX={400}
          targetY={228}
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

const dragBody = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const body = document.querySelector('path[stroke="transparent"]');
  if (!body) throw new Error("edge hit path not rendered");
  fireEvent.pointerDown(body, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent(window, new PointerEvent("pointermove", { clientX: to.x, clientY: to.y }));
  fireEvent(window, new PointerEvent("pointerup", { clientX: to.x, clientY: to.y }));
};

const waypointsNow = () =>
  useDiagramStore.getState().edges.find((e) => e.id === "e")?.data?.waypoints ?? [];

describe("stub clamp on body drag (#53)", () => {
  beforeEach(seedBent);

  it("stops at the stub (x=176) even when dragged inside the source stub", () => {
    renderEdge();
    dragBody({ x: 280, y: 120 }, { x: 40, y: 120 });

    const xs = waypointsNow().map((w) => w.x);
    expect(xs.length).toBeGreaterThan(0);
    // Stops exactly at the stub — not an inequality that "didn't move at all" would also pass
    for (const x of xs) expect(x).toBeCloseTo(176, 0);
  });

  it("a normal slide between the stubs follows as is", () => {
    renderEdge();
    dragBody({ x: 280, y: 120 }, { x: 240, y: 120 });

    const xs = waypointsNow().map((w) => w.x);
    for (const x of xs) expect(x).toBeCloseTo(240, 0);
  });

  it("does not clamp the straight style — stubs are an orthogonal routing concept", () => {
    // straight/curved draw waypoints as is, so there's no stub line in the render.
    // Blocking here would snag the drag where there's no obstacle at all.
    useDiagramStore.getState().updateEdgeData("e", { pathStyle: "straight" });
    renderEdge();
    dragBody({ x: 280, y: 120 }, { x: 40, y: 120 });

    const xs = waypointsNow().map((w) => w.x);
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(x).toBeCloseTo(40, 0);
  });
});
