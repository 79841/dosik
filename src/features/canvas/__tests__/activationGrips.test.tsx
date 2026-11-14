import { ReactFlowProvider } from "@xyflow/react";
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { ActivationGrips } from "../ShapeNode";

const seed = () => {
  useDiagramStore
    .getState()
    .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
  useDiagramStore.getState().applyOps([
    { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } },
    { op: "add_activation", lifeline: "l", y0: 100, y1: 180 },
  ]);
};

const grips = (activations: { y0: number; y1: number }[], height = 360) =>
  render(
    <ReactFlowProvider>
      <ActivationGrips nodeId="l" width={120} height={height} nodeY={0} activations={activations} />
    </ReactFlowProvider>,
  );

/** drags the grip past the 4px threshold to an absolute flow y */
const dragTo = (grip: Element, toY: number) => {
  fireEvent.pointerDown(grip, { button: 0, clientX: 0, clientY: 0 });
  fireEvent(window, new PointerEvent("pointermove", { clientX: 0, clientY: toY }));
  fireEvent(window, new PointerEvent("pointerup", { clientX: 0, clientY: toY }));
};

const bars = () => useDiagramStore.getState().nodes[0]?.data.activations;

describe("ActivationGrips", () => {
  beforeEach(seed);

  it("places two grips per bar at the span's position", () => {
    const { container } = grips([{ y0: 100, y1: 180 }]);
    const els = container.querySelectorAll("div.nodrag");
    expect(els).toHaveLength(2);
    expect((els[0] as HTMLElement).style.top).toBe("97px");
    expect((els[1] as HTMLElement).style.top).toBe("177px");
  });

  it("puts no grips on a span whose bar is not drawn", () => {
    // The bridge's add_activation has no height clamp, and resizing does not re-clamp.
    // If LifelineSvg draws nothing for a span, no grips should appear either.
    expect(grips([{ y0: 500, y1: 600 }]).container.querySelectorAll("div.nodrag")).toHaveLength(0);
    expect(grips([{ y0: 10, y1: 30 }]).container.querySelectorAll("div.nodrag")).toHaveLength(0);
  });

  it("places grips on the drawn part of a bar that only partly fits", () => {
    const { container } = grips([{ y0: 300, y1: 1000 }]);
    const els = container.querySelectorAll("div.nodrag");
    expect(els).toHaveLength(2);
    expect((els[0] as HTMLElement).style.top).toBe("297px");
    expect((els[1] as HTMLElement).style.top).toBe("357px"); // clipped at the bottom, 360
  });

  it("one drag makes a single undo frame and moves the span", () => {
    const { container } = grips([{ y0: 100, y1: 180 }]);
    const before = useDiagramStore.getState().past.length;
    const startGrip = container.querySelectorAll("div.nodrag")[0];
    if (!startGrip) throw new Error("grip missing");

    dragTo(startGrip, 140);

    expect(useDiagramStore.getState().past.length).toBe(before + 1);
    expect(bars()?.[0]?.y0).toBe(140);
    useDiagramStore.getState().undo();
    expect(bars()?.[0]?.y0).toBe(100);
  });

  it("movement below the threshold makes no commit and no change", () => {
    const { container } = grips([{ y0: 100, y1: 180 }]);
    const before = useDiagramStore.getState().past.length;
    const startGrip = container.querySelectorAll("div.nodrag")[0];
    if (!startGrip) throw new Error("grip missing");

    fireEvent.pointerDown(startGrip, { button: 0, clientX: 0, clientY: 0 });
    fireEvent(window, new PointerEvent("pointermove", { clientX: 0, clientY: 2 }));
    fireEvent(window, new PointerEvent("pointerup", { clientX: 0, clientY: 2 }));

    expect(useDiagramStore.getState().past.length).toBe(before);
    expect(bars()?.[0]).toEqual({ y0: 100, y1: 180 });
  });

  it("draws nothing when there are no bars", () => {
    const { container } = grips([]);
    expect(container.querySelectorAll("div.nodrag")).toHaveLength(0);
  });
});
