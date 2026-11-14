import { describe, expect, it } from "vitest";

import {
  connectionEndShape,
  findSnapTarget,
  lifelineHandleAtY,
  newMessageMarkerEnd,
  outlinePointOnNode,
} from "../edgeUtils";
import { LIFELINE_ACTIVATION_W } from "../palette";
import { useDiagramStore } from "../store";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";
import type { DiagramNode } from "../types";

const lifeline = (activations?: { y0: number; y1: number }[]): DiagramNode =>
  ({
    id: "l",
    type: "shape",
    position: { x: 100, y: 0 },
    width: 120,
    height: 400,
    data: { label: "API", shape: "lifeline", color: "mono", activations },
  }) as DiagramNode;

describe("a message ends at the edge of the bar it lands on (#210)", () => {
  it("on a bare line the end is the line itself", () => {
    const l = lifeline();
    const p = outlinePointOnNode(l, lifelineHandleAtY(l, 150, "left"));
    expect(p.x).toBe(160);
    expect(p.y).toBeCloseTo(150, 5);
  });

  it("over an activation bar the end stops at the bar's facing edge — the arrowhead stays visible", () => {
    const l = lifeline([{ y0: 100, y1: 200 }]);
    expect(outlinePointOnNode(l, lifelineHandleAtY(l, 150, "left")).x).toBe(
      160 - LIFELINE_ACTIVATION_W / 2,
    );
    expect(outlinePointOnNode(l, lifelineHandleAtY(l, 150, "right")).x).toBe(
      160 + LIFELINE_ACTIVATION_W / 2,
    );
    // the call that opens the bar lands on it too
    expect(outlinePointOnNode(l, lifelineHandleAtY(l, 100, "left")).x).toBe(
      160 - LIFELINE_ACTIVATION_W / 2,
    );
  });

  it("a message put exactly where a bar starts lands on it, whatever the rounding of its handle", () => {
    // a 360-tall lifeline at y 80: a handle's percentage keeps two decimals,
    // so y 200 comes back as 199.988 — just above the bar that starts there
    const l = { ...lifeline([{ y0: 120, y1: 240 }]), position: { x: 100, y: 80 }, height: 360 };
    const handle = lifelineHandleAtY(l, 200, "left");
    expect(outlinePointOnNode(l, handle).x).toBe(160 - LIFELINE_ACTIVATION_W / 2);
  });

  it("a snap onto a bar shows its dot where the line will end", () => {
    const l = lifeline([{ y0: 100, y1: 200 }]);
    const snap = findSnapTarget([l], { x: 150, y: 150 })!;
    expect(snap.point.x).toBe(160 - LIFELINE_ACTIVATION_W / 2);
  });

  it("an end on the lifeline's head (top) is not a message end — no bar to stop at", () => {
    const l = lifeline([{ y0: 0, y1: 400 }]);
    expect(outlinePointOnNode(l, "top").x).toBe(160);
  });

  it("outside every bar's span the end is back on the line", () => {
    const l = lifeline([{ y0: 100, y1: 200 }]);
    expect(outlinePointOnNode(l, lifelineHandleAtY(l, 260, "left")).x).toBe(160);
  });
});

describe("a line end dropped on a lifeline faces the line's other end (#210)", () => {
  const twoLifelines = (): DiagramNode[] => [
    { ...lifeline(), id: "L1", position: { x: 0, y: 0 } } as DiagramNode,
    { ...lifeline([{ y0: 100, y1: 300 }]), id: "L2", position: { x: 300, y: 0 } } as DiagramNode,
  ];

  it("the snap takes the side towards the other end, wherever the pointer is on the line", () => {
    const nodes = twoLifelines();
    // the pointer is on L2's far (right) half; the line comes from the left
    const snap = findSnapTarget(nodes, { x: 365, y: 150 }, [], undefined, { x: 60, y: 150 })!;
    expect(snap.handle.startsWith("left")).toBe(true);
    expect(snap.point.x).toBe(360 - LIFELINE_ACTIVATION_W / 2);
    // without another end the pointer's side decides, as before
    expect(findSnapTarget(nodes, { x: 365, y: 150 })!.handle.startsWith("right")).toBe(true);
  });

  it("rewiring an end onto another lifeline turns it to face the line's source", () => {
    const store = useDiagramStore.getState();
    store.loadDoc(
      makeDoc(
        [
          ...twoLifelines(),
          makeNode({ id: "a", shape: "anchor", x: 500, y: 144, width: 12, height: 12 }),
        ],
        [
          makeEdge({
            id: "m",
            source: "L1",
            target: "a",
            sourceHandle: lifelineHandleAtY(twoLifelines()[0]!, 150, "right"),
          }),
        ],
      ),
      null,
    );
    store.rewireAnchorToNode("a", "L2", lifelineHandleAtY(twoLifelines()[1]!, 150, "right"));
    const m = useDiagramStore.getState().edges.find((e) => e.id === "m")!;
    expect(m.target).toBe("L2");
    // the side turns; the height stays
    expect(m.targetHandle).toBe(lifelineHandleAtY(twoLifelines()[1]!, 150, "left"));
  });

  it("the end that stayed turns too when the line now runs the other way", () => {
    // L0 | L1 (bar) | L2: a message L1 → L2 has its end moved to L0
    const nodes = [
      { ...lifeline(), id: "L0", position: { x: -300, y: 0 } } as DiagramNode,
      { ...lifeline([{ y0: 100, y1: 300 }]), id: "L1", position: { x: 0, y: 0 } } as DiagramNode,
      { ...lifeline(), id: "L2", position: { x: 300, y: 0 } } as DiagramNode,
    ];
    const store = useDiagramStore.getState();
    store.loadDoc(
      makeDoc(
        // the end starts out on the right of L1, as when it sat on L2
        [...nodes, makeNode({ id: "a", shape: "anchor", x: 500, y: 144, width: 12, height: 12 })],
        [
          makeEdge({
            id: "m",
            source: "L1",
            target: "a",
            sourceHandle: lifelineHandleAtY(nodes[1]!, 150, "right"),
          }),
        ],
      ),
      null,
    );
    store.rewireAnchorToNode("a", "L0", lifelineHandleAtY(nodes[0]!, 150, "left"));
    const m = useDiagramStore.getState().edges.find((e) => e.id === "m")!;
    expect(m.targetHandle).toBe(lifelineHandleAtY(nodes[0]!, 150, "right"));
    // the source now faces L0, so it leaves from the bar's left edge
    expect(m.sourceHandle).toBe(lifelineHandleAtY(nodes[1]!, 150, "left"));
  });

  it("a self-message keeps its sides", () => {
    const l = { ...lifeline(), id: "L1", position: { x: 0, y: 0 } } as DiagramNode;
    const store = useDiagramStore.getState();
    store.loadDoc(
      makeDoc(
        // a lost message at y 150 (its anchor's centre)
        [l, makeNode({ id: "a", shape: "anchor", x: 200, y: 144, width: 12, height: 12 })],
        [
          makeEdge({
            id: "m",
            source: "L1",
            target: "a",
            sourceHandle: lifelineHandleAtY(l, 150, "right"),
          }),
        ],
      ),
      null,
    );
    store.rewireAnchorToNode("a", "L1", lifelineHandleAtY(l, 200, "right"));
    const m = useDiagramStore.getState().edges.find((e) => e.id === "m")!;
    expect(m.sourceHandle).toBe(lifelineHandleAtY(l, 150, "right"));
    expect(m.targetHandle).toBe(lifelineHandleAtY(l, 200, "right"));
  });
});

describe("the arrowhead a new line will get (#210)", () => {
  it("a message keeps UML's filled arrow unless an end was chosen", () => {
    expect(newMessageMarkerEnd({})).toBe("arrow");
    expect(newMessageMarkerEnd({ markerEnd: "open" })).toBe("open");
    expect(newMessageMarkerEnd({ arrow: false })).toBe("none");
  });

  it("the drag preview shows the end the drop will make", () => {
    expect(connectionEndShape({}, true)).toBe("arrow");
    expect(connectionEndShape({}, false)).toBe("open");
    expect(connectionEndShape({ markerEnd: "diamond" }, true)).toBe("diamond");
  });
});
