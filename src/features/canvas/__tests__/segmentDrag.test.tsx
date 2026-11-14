import { Position, ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { LabeledEdge } from "../LabeledEdge";

/**
 * Canvas drags can't be driven through the real app in this environment
 * (coordinate clicks don't reach the Tauri webview), so the gesture that issue
 * #43 replaced — grab the line, get a new bend — is pinned here instead.
 */
const seedStraight = () => {
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 300, y: 0 })],
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
};

const renderEdge = (targetId = "b") => {
  const edge = useDiagramStore.getState().edges[0]!;
  return render(
    <ReactFlowProvider>
      <svg aria-label="canvas">
        <LabeledEdge
          id="e"
          source="a"
          target={targetId}
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

const dragBody = (body: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(body, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent(window, new PointerEvent("pointermove", { clientX: to.x, clientY: to.y }));
  fireEvent(window, new PointerEvent("pointerup", { clientX: to.x, clientY: to.y }));
};

/** Gives the edge two corners so it has a middle segment to grab. */
const bend = () => {
  useDiagramStore.getState().updateEdgeData("e", {
    waypoints: [
      { x: 200, y: 28 },
      { x: 200, y: 150 },
    ],
  });
};

const edgeNow = () => useDiagramStore.getState().edges.find((e) => e.id === "e");

describe("edge body drag (#43)", () => {
  beforeEach(seedStraight);

  it("creates no waypoints when dragging a straight line", () => {
    const { container } = renderEdge();
    const body = container.querySelector('path[stroke="transparent"]');
    if (!body) throw new Error("edge hit path not rendered");

    dragBody(body, { x: 230, y: 28 }, { x: 230, y: 90 });

    // the line must actually have moved, otherwise "no waypoints" proves nothing
    expect(edgeNow()?.sourceHandle).not.toBe("right-50");
    expect(edgeNow()?.data?.waypoints ?? []).toEqual([]);
  });

  it("dragging a bent line's middle segment doesn't add bends on every grab", () => {
    bend();
    const first = renderEdge();
    const body = () => document.querySelector('path[stroke="transparent"]')!;

    // Grab the middle segment (the vertical one at x=200) and drag sideways
    const initial = JSON.stringify(edgeNow()?.data?.waypoints);
    dragBody(body(), { x: 200, y: 90 }, { x: 250, y: 90 });
    // the drag must really have moved the bend, else the counts below prove nothing
    expect(JSON.stringify(edgeNow()?.data?.waypoints)).not.toBe(initial);
    const afterOne = edgeNow()?.data?.waypoints?.length ?? 0;
    first.unmount();

    const second = renderEdge();
    dragBody(body(), { x: 250, y: 90 }, { x: 260, y: 90 });
    const afterTwo = edgeNow()?.data?.waypoints?.length ?? 0;
    second.unmount();

    expect(afterOne).toBeGreaterThan(0);
    expect(afterTwo).toBe(afterOne);
  });

  it("segments holding an endpoint don't respond to dragging", () => {
    bend();
    renderEdge();
    const before = edgeNow()?.data?.waypoints;

    // The segment right next to the start (the first one) isn't draggable
    dragBody(
      document.querySelector('path[stroke="transparent"]')!,
      { x: 170, y: 28 },
      { x: 170, y: 120 },
    );

    expect(edgeNow()?.data?.waypoints).toEqual(before);
  });
  it("dragging a curved edge's body moves the line too (not a dead control)", () => {
    useDiagramStore.getState().updateEdgeData("e", { pathStyle: "curved" });
    renderEdge();

    dragBody(
      document.querySelector('path[stroke="transparent"]')!,
      { x: 230, y: 28 },
      { x: 230, y: 90 },
    );

    expect(edgeNow()?.sourceHandle).not.toBe("right-50");
    expect(edgeNow()?.data?.waypoints ?? []).toEqual([]);
  });

  it("dragging a parallel (straight) edge's body moves the line too", () => {
    // With two edges on the same node pair, the router inserts an offset midpoint, making 3 points
    useDiagramStore.setState((st) => ({
      edges: [
        ...st.edges,
        {
          ...st.edges[0]!,
          id: "e2",
          selected: false,
        },
      ],
    }));
    useDiagramStore.getState().updateEdgeData("e", { pathStyle: "straight" });
    renderEdge();

    dragBody(
      document.querySelector('path[stroke="transparent"]')!,
      { x: 230, y: 28 },
      { x: 230, y: 90 },
    );

    expect(edgeNow()?.sourceHandle).not.toBe("right-50");
  });

  it("a straight line with an anchor leaves no undo frame", () => {
    useDiagramStore.setState((st) => ({
      nodes: [st.nodes[0]!, { ...makeNode({ id: "p", shape: "anchor", x: 300, y: 0 }) }],
      edges: [{ ...st.edges[0]!, target: "p", targetHandle: "center" }],
      past: [],
    }));
    renderEdge("p");

    dragBody(
      document.querySelector('path[stroke="transparent"]')!,
      { x: 230, y: 28 },
      { x: 230, y: 90 },
    );

    expect(useDiagramStore.getState().past).toHaveLength(0);
  });
});
