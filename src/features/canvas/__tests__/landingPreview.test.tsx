import { type ConnectionLineComponentProps, Position, ReactFlowProvider } from "@xyflow/react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { pickHandles } from "../../../shared/lib/store/nodeFactory";
import { useCanvasUiStore } from "../canvasUiStore";
import { ConnectionLine } from "../ConnectionLine";
import { landedEdge, layoutEdge } from "../edgeLayout";
import { LabeledEdge } from "../LabeledEdge";

vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * While a line's end is dragged onto a shape, the line is drawn the way the
 * drop will make it — attached to that shape's spot, routed with its stub —
 * not run to the free end along the shape's face (user, 2026-10-26).
 */
describe("a dragged end shows the line it will land as (#210)", () => {
  beforeEach(() => {
    useCanvasUiStore.getState().setSnapTarget(null);
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [
          makeNode({ id: "q", x: 56, y: 142, width: 160, height: 134 }),
          makeNode({ id: "g", x: 703, y: 302, width: 300, height: 120 }),
          // the free end being dragged, already pulled onto g's top face
          makeNode({ id: "a", shape: "anchor", x: 883, y: 296, width: 12, height: 12 }),
        ],
        [{ ...makeEdge({ id: "e", source: "q", target: "a" }), sourceHandle: "right" }],
      ),
      null,
    );
  });

  it("landedEdge swaps the dragged end for the shape it lands on, without old bends", () => {
    const edge = {
      ...useDiagramStore.getState().edges[0]!,
      data: { waypoints: [{ x: 1, y: 2 }] },
    };
    const landed = landedEdge(edge, "a", { nodeId: "g", handle: "top-62" });
    expect(landed).toMatchObject({ source: "q", target: "g", targetHandle: "top-62" });
    expect(landed.data?.waypoints).toBeUndefined();
    // an edge the drag is not on stays as it is
    expect(landedEdge(edge, "other", { nodeId: "g", handle: "top" })).toBe(edge);
  });

  const renderEdge = () => {
    const edge = useDiagramStore.getState().edges[0]!;
    return render(
      <ReactFlowProvider>
        <svg>
          <LabeledEdge
            id="e"
            source="q"
            target="a"
            sourceX={216}
            sourceY={209}
            targetX={889}
            targetY={302}
            sourcePosition={Position.Right}
            targetPosition={Position.Top}
            sourceHandleId={edge.sourceHandle}
            targetHandleId={edge.targetHandle}
            selected
            data={edge.data}
          />
        </svg>
      </ReactFlowProvider>,
    ).container;
  };
  /** the drawn line — the first path that is neither halo nor hit area */
  const lineOf = (c: Element) =>
    [...c.querySelectorAll("path")].find((p) =>
      p.getAttribute("class")?.includes("react-flow__edge-path"),
    );

  it("snapped onto a shape, the line is drawn routed to that shape's spot", () => {
    const c = renderEdge();
    act(() =>
      useCanvasUiStore
        .getState()
        .setSnapTarget({ nodeId: "g", handle: "top-62", point: { x: 889, y: 302 } }, "a"),
    );
    const { nodes, edges } = useDiagramStore.getState();
    const expected = layoutEdge(
      landedEdge(edges[0]!, "a", { nodeId: "g", handle: "top-62" }),
      nodes,
      {
        edges,
      },
    )!;
    expect(lineOf(c)?.getAttribute("d")).toBe(expected.d);
  });

  it("with no snap — or a snap for another drag — the line runs to the free end", () => {
    const c = renderEdge();
    const { nodes, edges } = useDiagramStore.getState();
    const free = layoutEdge(edges[0]!, nodes, { edges })!;
    expect(lineOf(c)?.getAttribute("d")).toBe(free.d);
    act(() =>
      useCanvasUiStore
        .getState()
        .setSnapTarget({ nodeId: "g", handle: "top", point: { x: 853, y: 302 } }, "someone-else"),
    );
    expect(lineOf(c)?.getAttribute("d")).toBe(free.d);
  });
});

describe("a new line dragged onto a shape previews its route (#210)", () => {
  beforeEach(() => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "q", x: 56, y: 142, width: 160, height: 134 }),
            makeNode({ id: "g", x: 703, y: 302, width: 300, height: 120 }),
          ],
          [],
        ),
        null,
      );
    useDiagramStore.setState({ lastEdgeStyle: {} });
  });

  it("over a shape, the preview is the route the connection will take", () => {
    act(() =>
      useCanvasUiStore
        .getState()
        .setSnapTarget({ nodeId: "g", handle: "top-62", point: { x: 889, y: 302 } }),
    );
    const c = render(
      <svg>
        <ConnectionLine
          {...({
            fromX: 216,
            fromY: 209,
            toX: 880,
            toY: 290,
            fromPosition: Position.Right,
            toPosition: Position.Top,
            fromNode: { id: "q", data: { shape: "rect" } },
            fromHandle: { id: "right" },
            toNode: { id: "g", data: { shape: "rect" } },
          } as unknown as ConnectionLineComponentProps)}
        />
      </svg>,
    ).container;
    const { nodes } = useDiagramStore.getState();
    const expected = layoutEdge(
      { id: "preview", source: "q", target: "g", sourceHandle: "right", targetHandle: "top-62" },
      nodes,
      { edges: [] },
    )!;
    // the line, not the arrowhead's path in its <marker>
    const line = [...c.querySelectorAll("path")].find((p) => !p.closest("marker"));
    expect(line?.getAttribute("d")).toBe(expected.d);
    act(() => useCanvasUiStore.getState().setSnapTarget(null));
  });

  it("from a lifeline's strip it starts where the connection will — mid-line, facing the shape", () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "L", shape: "lifeline", x: 0, y: 0, width: 120, height: 400 }),
            makeNode({ id: "B", x: 400, y: 150, width: 160, height: 60 }),
          ],
          [],
        ),
        null,
      );
    act(() =>
      useCanvasUiStore
        .getState()
        .setSnapTarget({ nodeId: "B", handle: "left", point: { x: 400, y: 180 } }),
    );
    const c = render(
      <svg>
        <ConnectionLine
          {...({
            fromX: 60,
            fromY: 200,
            toX: 390,
            toY: 180,
            fromPosition: Position.Right,
            toPosition: Position.Left,
            fromNode: { id: "L", data: { shape: "lifeline" } },
            // the strip handle's DOM id — onConnect places it as the shapes face
            fromHandle: { id: "line" },
            toNode: { id: "B", data: { shape: "rect" } },
          } as unknown as ConnectionLineComponentProps)}
        />
      </svg>,
    ).container;
    const { nodes } = useDiagramStore.getState();
    const [L, B] = nodes;
    const expected = layoutEdge(
      {
        id: "preview",
        source: "L",
        target: "B",
        sourceHandle: pickHandles(L!, B!).sourceHandle,
        targetHandle: "left",
      },
      nodes,
      { edges: [] },
    )!;
    const line = [...c.querySelectorAll("path")].find((p) => !p.closest("marker"));
    expect(line?.getAttribute("d")).toBe(expected.d);
    act(() => useCanvasUiStore.getState().setSnapTarget(null));
  });
});
