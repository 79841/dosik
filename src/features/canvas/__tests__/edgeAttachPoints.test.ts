import { beforeEach, describe, expect, it } from "vitest";

import { connectionLanding } from "../connectionLanding";
import { edgeSiblings, layoutEdge } from "../edgeLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";

const state = () => useDiagramStore.getState();
const edge = (id: string) => state().edges.find((e) => e.id === id)!;

describe("edge end positions (#204)", () => {
  describe("repro: two edges entering the middle of the same side", () => {
    beforeEach(() => {
      state().loadDoc(
        makeDoc(
          [
            makeNode({ id: "canvas", x: 0, y: 0 }),
            makeNode({ id: "bridge", x: 0, y: 200 }),
            makeNode({ id: "store", x: 400, y: 100 }),
          ],
          [
            makeEdge({ id: "ops", source: "canvas", target: "store", label: "ops" }),
            makeEdge({ id: "apply", source: "bridge", target: "store", label: "applyOps" }),
          ],
        ),
        null,
      );
    });

    it("after Layout the ends on store differ, and the edge from above is on top", () => {
      state().autoLayout("LR");
      const ops = edge("ops");
      const apply = edge("apply");
      expect(ops.targetHandle).not.toBe(apply.targetHandle);
      const canvasY = state().nodes.find((n) => n.id === "canvas")!.position.y;
      const bridgeY = state().nodes.find((n) => n.id === "bridge")!.position.y;
      const upper = canvasY < bridgeY ? ops : apply;
      const lower = upper === ops ? apply : ops;
      const ratio = (h: string | null | undefined) => Number((h ?? "").split("-")[1] ?? 50);
      expect(ratio(upper.targetHandle)).toBeLessThan(ratio(lower.targetHandle));
    });

    it("Layout splits bunched ends even in an already-aligned spot — a second run changes nothing", () => {
      state().autoLayout("LR");
      // The shape pre-#204 Layout left behind: ends bunched in the middle of one side
      useDiagramStore.setState({
        edges: state().edges.map((e) => ({ ...e, targetHandle: "left" })),
      });
      expect(state().autoLayout("LR")).not.toMatchObject({ reason: "unchanged" });
      expect(edge("ops").targetHandle).not.toBe(edge("apply").targetHandle);
      expect(state().autoLayout("LR")).toMatchObject({ reason: "unchanged" });
    });

    it("the bridge's add_edge attaches to a free spot, and an existing end doesn't move", () => {
      state().applyOps([{ op: "delete_edge", id: "apply" }]);
      // The existing edge is at store's left middle
      expect(edge("ops").targetHandle).toBe("left");
      state().applyOps([
        { op: "add_edge", edge: { id: "late", source: "bridge", target: "store" } },
      ]);
      expect(edge("ops").targetHandle).toBe("left");
      // Coming from below, so 16px below the middle (28px) — 44px on a 56px side
      expect(edge("late").targetHandle).toBe("left-78.57");
    });
  });

  describe("edges placed by hand", () => {
    beforeEach(() => {
      state().loadDoc(
        makeDoc(
          [
            makeNode({ id: "a", x: 0, y: 0, width: 160, height: 56 }),
            makeNode({ id: "b", x: 400, y: 0, width: 160, height: 80 }),
          ],
          [],
        ),
        null,
      );
    });

    it("dropping on the body takes the side from pickHandles and the position from the drop", () => {
      state().onConnect(
        { source: "a", target: "b", sourceHandle: "right", targetHandle: "body" },
        { target: { x: 480, y: 20 } },
      );
      const e = state().edges[0]!;
      expect(e.targetHandle).toBe("left-25");
      // The start side is the connection dot (center) — no spot was picked, so a free one; it's alone, so the center
      expect(e.sourceHandle).toBe("right");
    });

    it("snaps to the center within 8px of it", () => {
      state().onConnect(
        { source: "a", target: "b", sourceHandle: "right", targetHandle: "body" },
        { target: { x: 480, y: 46 } },
      );
      expect(state().edges[0]!.targetHandle).toBe("left");
    });

    it("dragging a second edge from the start connection dot offsets the start side", () => {
      state().onConnect(
        { source: "a", target: "b", sourceHandle: "right", targetHandle: "body" },
        { target: { x: 480, y: 20 } },
      );
      state().onConnect(
        { source: "a", target: "b", sourceHandle: "right", targetHandle: "body" },
        { target: { x: 480, y: 60 } },
      );
      const [first, second] = state().edges;
      expect(first!.sourceHandle).toBe("right");
      expect(second!.sourceHandle).not.toBe("right");
      expect(second!.targetHandle).toBe("left-75");
    });

    it("arrow tool: both ends of the stroke attach at that spot on the nearest side (D17)", () => {
      state().drawArrow({ x: 155, y: 15 }, { x: 405, y: 60 });
      const e = state().edges[0]!;
      expect(e.sourceHandle).toBe("right-26.79");
      expect(e.targetHandle).toBe("left-75");
    });

    it("arrow tool: attaches within 32px even outside the shape; farther away it's a free end", () => {
      // 10px outside B's left side — near the middle, so the middle
      state().drawArrow({ x: 155, y: 28 }, { x: 390, y: 41 });
      expect(state().edges[0]!.targetHandle).toBe("left");
      // 60px away from B — a free end in empty space (anchor)
      state().drawArrow({ x: 155, y: 28 }, { x: 340, y: 160 });
      const free = state().edges[1]!;
      expect(state().nodes.find((n) => n.id === free.target)?.data.shape).toBe("anchor");
      expect(free.sourceHandle).toBe("right");
    });

    it("previews the landing point while dragging — the same spot as saved", () => {
      const { nodes, edges } = state();
      const a = { id: "a", handle: "right" };
      const landing = connectionLanding(
        nodes,
        edges,
        a,
        { id: "b", handle: "body" },
        { x: 480, y: 20 },
      );
      expect(landing).toEqual({ nodeId: "b", handle: "left-25", point: { x: 400, y: 20 } });
      // Over a hidden handle (a placed end) behaves like the body
      expect(
        connectionLanding(nodes, edges, a, { id: "b", handle: "left-70" }, { x: 480, y: 20 })
          ?.handle,
      ).toBe("left-25");
      expect(
        connectionLanding(nodes, edges, a, { id: "a", handle: "body" }, { x: 10, y: 10 }),
      ).toBeNull();
    });

    it("dropping on a connection dot takes a free spot on that side — the center if empty (D3)", () => {
      const a = { id: "a", handle: "right" };
      expect(
        connectionLanding(
          state().nodes,
          state().edges,
          a,
          { id: "b", handle: "left" },
          { x: 395, y: 30 },
        )?.handle,
      ).toBe("left");
      state().onConnect({ source: "a", target: "b", sourceHandle: "right", targetHandle: "left" });
      expect(state().edges[0]!.targetHandle).toBe("left");
      // The second one moves aside because the center is taken — preview and saved match
      const next = connectionLanding(
        state().nodes,
        state().edges,
        a,
        { id: "b", handle: "left" },
        { x: 395, y: 30 },
      );
      state().onConnect({ source: "a", target: "b", sourceHandle: "right", targetHandle: "left" });
      expect(state().edges[1]!.targetHandle).toBe(next?.handle);
      expect(next?.handle).not.toBe("left");
    });
  });

  describe("drawing", () => {
    const nodes = [
      makeNode({ id: "a", x: 0, y: 0, width: 160, height: 80 }),
      makeNode({ id: "o", shape: "ellipse", x: 400, y: 0, width: 160, height: 80 }),
    ];

    it("draws the line to the outline when off an ellipse's center", () => {
      const e = makeEdge({
        id: "e",
        source: "a",
        target: "o",
        sourceHandle: "right",
        targetHandle: "left-30",
      });
      const layout = layoutEdge(e, nodes, { edges: [e] })!;
      const tip = layout.points[layout.points.length - 1]!;
      expect(tip.y).toBeCloseTo(24, 6);
      expect(tip.x).toBeGreaterThan(400);
      const u = (24 - 40) / 40;
      expect(tip.x).toBeCloseTo(400 + 80 * (1 - Math.sqrt(1 - u * u)), 6);
      // The end segment stays perpendicular to the side — the arrowhead doesn't tilt
      expect(layout.points[layout.points.length - 2]!.y).toBeCloseTo(24, 6);
    });

    it("applies parallel offset only to edges with the same handles at both ends", () => {
      const same1 = makeEdge({
        id: "s1",
        source: "a",
        target: "o",
        sourceHandle: "right",
        targetHandle: "left",
      });
      const same2 = makeEdge({
        id: "s2",
        source: "a",
        target: "o",
        sourceHandle: "right",
        targetHandle: "left",
      });
      const apart = makeEdge({
        id: "p",
        source: "a",
        target: "o",
        sourceHandle: "right-30",
        targetHandle: "left-40",
      });
      const edges = [same1, same2, apart];
      expect(edgeSiblings(same1, nodes, edges).parallelOffset).not.toBe(0);
      expect(edgeSiblings(apart, nodes, edges).parallelOffset).toBe(0);
    });
  });
});

describe("old default width (#204)", () => {
  it("loads an edge saved at 1.6px as the default line and keeps other widths", () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [
          {
            ...makeEdge({ id: "old", source: "a", target: "b" }),
            data: { variant: "solid", arrow: true, width: 1.6 },
          },
          {
            ...makeEdge({ id: "bold", source: "a", target: "b" }),
            data: { variant: "solid", arrow: true, width: 2.5 },
          },
        ],
      ),
      null,
    );
    const edges = useDiagramStore.getState().edges;
    expect(edges.find((e) => e.id === "old")!.data?.width).toBeUndefined();
    expect(edges.find((e) => e.id === "bold")!.data?.width).toBe(2.5);
  });
});

describe("attach point follow-ups (#205)", () => {
  const ratio = (h: string | null | undefined) => Number((h ?? "").split("-")[1] ?? 50);
  const centreY = (id: string) => {
    const n = state().nodes.find((x) => x.id === id)!;
    return n.position.y + (n.height ?? 0) / 2;
  };

  it("places add_edges in one batch together — an edge from below doesn't attach on top", () => {
    state().loadDoc(
      makeDoc(
        [
          makeNode({ id: "a", x: 0, y: 0 }),
          makeNode({ id: "b", x: 0, y: 120 }),
          makeNode({ id: "d", x: 0, y: 240 }),
          makeNode({ id: "c", x: 400, y: 120 }),
        ],
        [],
      ),
      null,
    );
    state().applyOps([
      { op: "add_edge", edge: { id: "ac", source: "a", target: "c" } },
      { op: "add_edge", edge: { id: "bc", source: "b", target: "c" } },
      { op: "add_edge", edge: { id: "dc", source: "d", target: "c" } },
    ]);
    expect(["ac", "bc", "dc"].map((id) => edge(id).targetHandle)).toEqual([
      "left-21.43",
      "left",
      "left-78.57",
    ]);
  });

  it("keeps two ends that arrive in one batch through a narrow gap from overlapping at one point", () => {
    state().loadDoc(
      makeDoc(
        [
          makeNode({ id: "up", x: 0, y: 0 }),
          makeNode({ id: "lo1", x: 0, y: 300 }),
          makeNode({ id: "lo2", x: 0, y: 400 }),
          makeNode({ id: "c", x: 400, y: 100 }),
        ],
        [
          makeEdge({
            id: "old",
            source: "up",
            target: "c",
            sourceHandle: "right",
            targetHandle: "left-57.14",
          }),
        ],
      ),
      null,
    );
    state().applyOps([
      { op: "add_edge", edge: { id: "n1", source: "lo1", target: "c" } },
      { op: "add_edge", edge: { id: "n2", source: "lo2", target: "c" } },
    ]);
    const spots = ["old", "n1", "n2"].map((id) => edge(id).targetHandle);
    expect(new Set(spots).size).toBe(3);
  });

  it("another op in between closes the batch there — existing ends don't move", () => {
    state().loadDoc(
      makeDoc([makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "c", x: 400, y: 0 })], []),
      null,
    );
    state().applyOps([
      { op: "add_edge", edge: { id: "first", source: "a", target: "c" } },
      { op: "set_title", title: "t" },
      { op: "add_edge", edge: { id: "second", source: "a", target: "c" } },
    ]);
    expect(edge("first").targetHandle).toBe("left");
    expect(edge("second").targetHandle).not.toBe("left");
  });

  it("an arrow-tool line drawn from empty space to a lifeline attaches to the bare side and is not a message", () => {
    state().loadDoc(
      makeDoc(
        [makeNode({ id: "ll", shape: "lifeline", x: 200, y: 0, width: 120, height: 400 })],
        [],
      ),
      null,
    );
    state().drawArrow({ x: 0, y: 380 }, { x: 230, y: 380 });
    const e = state().edges[0]!;
    expect(e.targetHandle).toBe("left");
  });

  it("treats 1.6px as the default line whichever path it comes by", () => {
    state().loadDoc(
      makeDoc([makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "c", x: 400, y: 0 })], []),
      null,
    );
    state().applyOps([
      { op: "add_edge", edge: { id: "w", source: "a", target: "c", width: 1.6 } },
      { op: "add_edge", edge: { id: "bold", source: "a", target: "c", width: 2.5 } },
    ]);
    expect(edge("w").data?.width).toBeUndefined();
    state().applyOps([{ op: "update_edge", id: "bold", set: { width: 1.6 } }]);
    expect(edge("bold").data?.width).toBeUndefined();
  });

  it("the Mermaid ⌘V path (buildFragment → insertFragment) also splits ends and keeps order", async () => {
    const { parseMermaid } = await import("../../mermaid/import/parseMermaid");
    const { buildFragment } = await import("../../mermaid/import/buildFragment");
    state().loadDoc(makeDoc([], []), null);
    const fragment = buildFragment(await parseMermaid("graph LR\n A-->C\n B-->C\n D-->C"));
    state().insertFragment(fragment, { dx: 0, dy: 0 });
    const into = state().edges;
    expect(new Set(into.map((e) => e.targetHandle)).size).toBe(3);
    const byY = [...into].sort((p, q) => centreY(p.source) - centreY(q.source));
    const spots = byY.map((e) => ratio(e.targetHandle));
    expect(spots).toEqual([...spots].sort((p, q) => p - q));
  });
});
