import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import type { ShapeKind } from "../../../shared/lib/types";
import { ShapeNode } from "../ShapeNode";

/**
 * #204 — React Flow doesn't draw an edge whose handle id isn't in the DOM. For every end that saved
 * a spot on a side (`left-30`), an invisible handle must sit at that spot for the edge to show.
 */
const renderNode = (id: string, shape: ShapeKind, width: number, height: number) =>
  render(
    <ReactFlowProvider>
      {/* @ts-expect-error passes only the props ShapeNode reads */}
      <ShapeNode
        id={id}
        selected={false}
        width={width}
        height={height}
        data={{ label: id, shape, color: "mono" }}
      />
    </ReactFlowProvider>,
  ).container;

const handle = (c: Element, id: string) =>
  c.querySelector<HTMLElement>(`.react-flow__handle[data-handleid="${id}"]`);

describe("handles for placed ends (#204)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [
          makeNode({ id: "a" }),
          makeNode({ id: "b", x: 400 }),
          makeNode({ id: "ll", shape: "lifeline", x: 800, width: 110, height: 320 }),
        ],
        [
          makeEdge({
            id: "e1",
            source: "a",
            target: "b",
            sourceHandle: "right",
            targetHandle: "left-30",
          }),
          makeEdge({
            id: "e2",
            source: "a",
            target: "b",
            sourceHandle: "top-75",
            targetHandle: "left",
          }),
          makeEdge({
            id: "m",
            source: "b",
            target: "ll",
            sourceHandle: "right",
            targetHandle: "left",
          }),
        ],
      ),
      null,
    );
  });

  it("boxes put a handle on the border for every saved spot", () => {
    const b = renderNode("b", "rounded", 160, 56);
    const placed = handle(b, "left-30");
    expect(placed).not.toBeNull();
    expect(placed!.style.left).toBe("0px");
    expect(placed!.style.top).toBe("30%");
    const a = renderNode("a", "rounded", 160, 56);
    expect(handle(a, "top-75")!.style.left).toBe("75%");
    expect(handle(a, "top-75")!.style.top).toBe("0px");
    // The center has only the connection dot — not drawn twice
    expect(b.querySelectorAll('.react-flow__handle[data-handleid="left"]').length).toBe(1);
  });

  it("lifelines have no dots, so they get bare side handles too — left and right on the center line", () => {
    const ll = renderNode("ll", "lifeline", 110, 320);
    expect(handle(ll, "left")!.style.left).toBe("50%");
  });
});
