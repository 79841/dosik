import { Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { LabeledEdge } from "../LabeledEdge";

/**
 * #93 — the editor for a label hidden behind a box used to open invisible.
 *
 * The fix comes down to **which layer the pill goes to**: only the one being edited goes to
 * `ViewportPortal` (rendered after nodes → drawn above them); the rest stay in
 * `EdgeLabelRenderer` (rendered before nodes → drawn behind them, as #91 intended).
 *
 * This can't be checked with the real DOM — both containers only exist inside a real
 * `<ReactFlow>`, and jsdom can't measure nodes, so edges never render. So the two
 * containers are swapped for marker-only shells to pin **which one was chosen**.
 * Whether it actually shows on screen is up to the PR's How to verify.
 */
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => (
      <div data-layer="behind-nodes">{children}</div>
    ),
    ViewportPortal: ({ children }: { children?: React.ReactNode }) => (
      <div data-layer="above-nodes">{children}</div>
    ),
  };
});

const seed = () => {
  useDiagramStore.getState().loadDoc(
    makeDoc(
      [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 400, y: 0 })],
      [
        {
          ...makeEdge({ id: "e", source: "a", target: "b", label: "middle" }),
          sourceHandle: "right",
          targetHandle: "left",
          data: { variant: "solid", arrow: true, label: "middle", labelStart: "from" },
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
          targetX={400}
          targetY={28}
          sourcePosition={Position.Right}
          targetPosition={Position.Left}
          sourceHandleId={edge.sourceHandle}
          targetHandleId={edge.targetHandle}
          data={edge.data}
        />
      </svg>
    </ReactFlowProvider>,
  );
};

const layerOf = (el: Element | null) => el?.closest("[data-layer]")?.getAttribute("data-layer");

describe("a self message's label rises with its line (#99)", () => {
  const seedSelfMessage = () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "L", shape: "lifeline", x: 0, y: 0, width: 120, height: 400 })],
        [
          {
            ...makeEdge({ id: "e", source: "L", target: "L", label: "validate" }),
            sourceHandle: "right-25",
            targetHandle: "right-40",
            data: { variant: "solid", arrow: true, label: "validate", pathStyle: "straight" },
          },
        ],
      ),
      null,
    );
    useCanvasUiStore.getState().setEdgeLabelEdit(null);
  };

  const renderSelf = () => {
    const edge = useDiagramStore.getState().edges[0]!;
    return render(
      <ReactFlowProvider>
        <svg aria-label="canvas">
          <LabeledEdge
            id="e"
            source="L"
            target="L"
            sourceX={60}
            sourceY={100}
            targetX={60}
            targetY={160}
            sourcePosition={Position.Right}
            targetPosition={Position.Right}
            sourceHandleId={edge.sourceHandle}
            targetHandleId={edge.targetHandle}
            data={edge.data}
          />
        </svg>
      </ReactFlowProvider>,
    ).container;
  };

  it("renders on the layer above nodes even when not editing", () => {
    seedSelfMessage();
    const container = renderSelf();
    const above = container.querySelector('[data-layer="above-nodes"]');
    // The line is raised to z 13, so a label left on the back layer would have its text covered by the line
    expect(above?.textContent).toContain("validate");
    expect(container.querySelector('[data-layer="behind-nodes"]')?.textContent).not.toContain(
      "validate",
    );
  });
});

describe("only the label being edited goes to the layer above nodes (#93)", () => {
  beforeEach(seed);

  it("does not create the layer above nodes at all when nothing is edited", () => {
    const { container } = renderEdge();
    expect(container.querySelector('[data-layer="above-nodes"]')).toBeNull();
    // the label patch (#210 D7)
    expect(
      container.querySelectorAll('[data-layer="behind-nodes"] .rounded-\\[2px\\]').length,
    ).toBe(2);
  });

  it.each(["center", "start"] as const)(
    "renders the %s editor on the layer above nodes",
    (which) => {
      useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which });
      const { container } = renderEdge();
      const input = container.querySelector("input");
      expect(input).not.toBeNull();
      expect(layerOf(input)).toBe("above-nodes");
    },
  );

  it("keeps labels not being edited on the layer behind nodes — #91 isn't reverted", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "e", which: "center" });
    const { container } = renderEdge();
    const behind = container.querySelector('[data-layer="behind-nodes"]');
    // The start label ("from") isn't being edited, so it stays behind
    expect(behind?.textContent).toContain("from");
    expect(behind?.querySelector("input")).toBeNull();
    // The center pill being edited doesn't remain on the back layer (not drawn twice)
    expect(behind?.textContent).not.toContain("middle");
  });

  it("does not raise this edge when another edge is being edited", () => {
    useCanvasUiStore.getState().setEdgeLabelEdit({ edgeId: "other", which: "center" });
    const { container } = renderEdge();
    expect(container.querySelector('[data-layer="above-nodes"]')).toBeNull();
  });
});
