import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../store";
import { makeEdge } from "../store/edgeFactory";
import { makeDoc, makeNode } from "./testFixtures";

/** New lines take the open chevron; sequence calls keep the filled UML arrow (#210 D24). */
describe("default arrowhead for new lines", () => {
  beforeEach(() => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [
            makeNode({ id: "a", shape: "rect", x: 0, y: 0 }),
            makeNode({ id: "b", shape: "rect", x: 400, y: 0 }),
            makeNode({ id: "L1", shape: "lifeline", x: 0, y: 200, width: 120, height: 360 }),
            makeNode({ id: "L2", shape: "lifeline", x: 300, y: 200, width: 120, height: 360 }),
          ],
          [],
        ),
        null,
      );
  });

  const edgeOf = (id: string) => useDiagramStore.getState().edges.find((e) => e.id === id);

  it("makeEdge without a style gives the open chevron", () => {
    expect(makeEdge({ source: "a", target: "b" }, {}).data?.markerEnd).toBe("open");
  });

  it("add_edge: open by default, none for the legacy arrow:false, the given end otherwise", () => {
    const r = useDiagramStore.getState().applyOps([
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
      { op: "add_edge", edge: { id: "e2", source: "a", target: "b", arrow: false } },
      { op: "add_edge", edge: { id: "e3", source: "a", target: "b", markerEnd: "arrow" } },
    ]);
    expect(r.errors).toEqual([]);
    expect(edgeOf("e1")?.data?.markerEnd).toBe("open");
    expect(edgeOf("e2")?.data?.markerEnd).toBe("none");
    expect(edgeOf("e3")?.data?.markerEnd).toBe("arrow");
  });

  it("add_edge between two lifelines is a message too — the filled arrow, as on the canvas", () => {
    const r = useDiagramStore.getState().applyOps([
      { op: "add_edge", edge: { id: "e1", source: "L1", target: "L2" } },
      { op: "add_edge", edge: { id: "e2", source: "L1", target: "L2", markerEnd: "open" } },
      { op: "add_edge", edge: { id: "e3", source: "L1", target: "a" } },
      { op: "add_edge", edge: { id: "e4", source: "L1", target: "L2", arrow: false } },
    ]);
    expect(r.errors).toEqual([]);
    expect(edgeOf("e1")?.data?.markerEnd).toBe("arrow");
    expect(edgeOf("e2")?.data?.markerEnd).toBe("open");
    // the legacy arrow:false still means no head, message or not
    expect(edgeOf("e4")?.data?.markerEnd).toBe("none");
    // a lifeline to a box is no message
    expect(edgeOf("e3")?.data?.markerEnd).toBe("open");
  });

  it("add_message keeps the filled arrow of a UML call", () => {
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "m", from: "L1", to: "L2", y: 300 } }]);
    expect(r.errors).toEqual([]);
    expect(edgeOf("m")?.data?.markerEnd).toBe("arrow");
  });

  it("drawing on the canvas: a box line gets the chevron, a lifeline message the arrow", () => {
    const store = useDiagramStore.getState();
    store.onConnect({ source: "a", target: "b", sourceHandle: null, targetHandle: null });
    store.onConnect({ source: "L1", target: "L2", sourceHandle: null, targetHandle: null });
    const [box, message] = useDiagramStore.getState().edges;
    expect(box?.data?.markerEnd).toBe("open");
    expect(message?.data?.markerEnd).toBe("arrow");
  });

  it("an end the user chose last is kept — by a box line and a message alike", () => {
    useDiagramStore.setState({ lastEdgeStyle: { markerEnd: "diamond" } });
    try {
      const store = useDiagramStore.getState();
      store.onConnect({ source: "a", target: "b", sourceHandle: null, targetHandle: null });
      store.onConnect({ source: "L1", target: "L2", sourceHandle: null, targetHandle: null });
      const [box, message] = useDiagramStore.getState().edges;
      expect(box?.data?.markerEnd).toBe("diamond");
      expect(message?.data?.markerEnd).toBe("diamond");
      // a message is still straight, whatever the last line looked like
      expect(message?.data?.pathStyle).toBe("straight");
    } finally {
      useDiagramStore.setState({ lastEdgeStyle: {} });
    }
  });

  it("an old file's line with no arrowhead field still opens with the filled arrow", () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 400 })],
        [
          {
            id: "old",
            type: "labeled",
            source: "a",
            target: "b",
            data: { variant: "solid" },
          } as never,
        ],
      ),
      null,
    );
    expect(edgeOf("old")?.data?.markerEnd).toBe("arrow");
  });
});
