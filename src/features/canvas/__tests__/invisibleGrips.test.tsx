import { Position, ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { lifelineHandleAtY } from "../../../shared/lib/edgeUtils";
import { useDiagramStore } from "../../../shared/lib/store";
import { LabeledEdge } from "../LabeledEdge";

// the grips ride EdgeLabelRenderer and ViewportPortal, whose targets only a
// full canvas has — render them in place here
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children,
}));

/** classes that would paint a grip: a fill, a ring, a rounded border */
const PAINT = /\b(bg-|border|ring-|shadow)/;
/** the harness renders inside `<svg>`, where `className` is not a string */
const cls = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";

/**
 * A selected line's grips are not drawn (user, 2026-10-26): the pill on a middle
 * segment and the ring at each end are gone, but each still sits in place,
 * takes the pointer and shows its cursor — dragging works as before.
 */
describe("a selected line's grips are invisible but still there (#210)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 300, y: 200 })],
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
  });

  const renderEdge = () => {
    const edge = useDiagramStore.getState().edges[0]!;
    return render(
      <ReactFlowProvider>
        <svg>
          <LabeledEdge
            id="e"
            source="a"
            target="b"
            sourceX={160}
            sourceY={28}
            targetX={300}
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
    ).container;
  };

  it("the middle segment's grip draws nothing but still slides the segment", () => {
    const c = renderEdge();
    const grip = c.querySelector('[title="Drag to move this segment"]');
    expect(grip).not.toBeNull();
    expect(cls(grip)).not.toMatch(PAINT);
    expect(cls(grip)).toMatch(/cursor-(ew|ns)-resize/);
  });

  it("each end's grip draws nothing but still takes the pointer", () => {
    const c = renderEdge();
    const ends = [...c.querySelectorAll("[data-line-end]")];
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      expect(cls(end)).toContain("cursor-grab");
      expect(cls(end)).not.toMatch(PAINT);
      // no ring drawn inside it either
      expect(end.children).toHaveLength(0);
    }
  });
});

describe("a self-message's grips are invisible too (#210)", () => {
  it("its width and height grips draw nothing but keep their cursors", () => {
    const l = makeNode({ id: "L", shape: "lifeline", x: 0, y: 0, width: 120, height: 400 });
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [l],
        [
          {
            ...makeEdge({ id: "m", source: "L", target: "L" }),
            sourceHandle: lifelineHandleAtY(l, 120, "right"),
            targetHandle: lifelineHandleAtY(l, 170, "right"),
            selected: true,
          },
        ],
      ),
      null,
    );
    const edge = useDiagramStore.getState().edges[0]!;
    const c = render(
      <ReactFlowProvider>
        <svg>
          <LabeledEdge
            id="m"
            source="L"
            target="L"
            sourceX={60}
            sourceY={120}
            targetX={60}
            targetY={170}
            sourcePosition={Position.Right}
            targetPosition={Position.Right}
            sourceHandleId={edge.sourceHandle}
            targetHandleId={edge.targetHandle}
            selected
            data={edge.data}
          />
        </svg>
      </ReactFlowProvider>,
    ).container;
    const grips = [
      ...c.querySelectorAll(
        '[title="Drag to widen the loop"], [title="Drag to change the loop height"]',
      ),
    ];
    expect(grips).toHaveLength(3);
    for (const grip of grips) {
      expect(cls(grip)).not.toMatch(PAINT);
      expect(cls(grip)).toMatch(/cursor-(ew|ns)-resize/);
    }
  });
});
