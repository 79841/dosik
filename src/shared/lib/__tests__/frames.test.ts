import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { routingObstacles } from "../edgeUtils";
import { FRAME_DEFAULT_Z, FRAME_TITLE_H, isBackdrop } from "../palette";
import { nodeBounds } from "../edgeUtils";
import { useDiagramStore } from "../store";
import { arrangeableSelection } from "../store/layout";
import {
  dragRiders,
  frameContents,
  withFrameRiders,
  withoutTouchedBackdrops,
} from "../store/frames";
import { createShapeNode, normalizeNode } from "../store/nodeFactory";
import type { DiagramNode } from "../types";
import { makeDoc } from "./testFixtures";

const store = () => useDiagramStore.getState();
const node = (id: string) => store().nodes.find((n) => n.id === id)!;
const pos = (id: string) => node(id).position;

/** a 400×300 frame at the origin; "in" wholly inside, "edge" across its border, "out" outside */
const setup = () => {
  store().loadDoc(makeDoc([], []), null);
  store().applyOps([
    {
      op: "add_node",
      node: { id: "f", label: "VPC", shape: "frame", x: 0, y: 0, width: 400, height: 300 },
    },
    { op: "add_node", node: { id: "in", label: "In", x: 40, y: 60 } },
    { op: "add_node", node: { id: "edge", label: "Edge", x: 340, y: 60 } },
    { op: "add_node", node: { id: "out", label: "Out", x: 600, y: 60 } },
  ]);
};

/** what React Flow sends while a node is dragged to (x, y) */
const drag = (id: string, x: number, y: number) =>
  store().onNodesChange([{ type: "position", id, position: { x, y }, dragging: true }]);

describe("Frame — shapes fully inside move with it (#170 D4)", () => {
  beforeEach(setup);

  it("only what is inside; overlapping and outside shapes stay put", () => {
    expect(frameContents(store().nodes, node("f"))).toEqual(["in"]);
    store().beginNodeDrag(["f"]);
    drag("f", 100, 50);
    store().endNodeDrag();
    expect(pos("f")).toEqual({ x: 100, y: 50 });
    expect(pos("in")).toEqual({ x: 140, y: 110 });
    expect(pos("edge")).toEqual({ x: 340, y: 60 });
    expect(pos("out")).toEqual({ x: 600, y: 60 });
  });

  it("does not pick up shapes the frame passes over mid-drag — membership is set when the drag starts", () => {
    store().beginNodeDrag(["f"]);
    drag("f", 400, 0); // now "out" lies inside the frame's box
    drag("f", 500, 0);
    store().endNodeDrag();
    expect(pos("out")).toEqual({ x: 600, y: 60 });
    expect(pos("in")).toEqual({ x: 540, y: 60 });
  });

  it("shapes selected and dragged together move only once (D5)", () => {
    store().beginNodeDrag(["f", "in"]);
    store().onNodesChange([
      { type: "position", id: "f", position: { x: 10, y: 0 }, dragging: true },
      { type: "position", id: "in", position: { x: 50, y: 60 }, dragging: true },
    ]);
    expect(pos("in")).toEqual({ x: 50, y: 60 });
  });

  it("frames inside the frame and their shapes come along too", () => {
    store().applyOps([
      {
        op: "add_node",
        node: { id: "g", label: "Subnet", shape: "frame", x: 20, y: 160, width: 200, height: 120 },
      },
      { op: "add_node", node: { id: "deep", label: "Deep", x: 40, y: 210 } },
    ]);
    store().beginNodeDrag(["f"]);
    drag("f", 0, 100);
    store().endNodeDrag();
    expect(pos("g")).toEqual({ x: 20, y: 260 });
    expect(pos("deep")).toEqual({ x: 40, y: 310 });
  });

  it("arrow keys bring the inner shapes along too — outside a drag, it is what is inside at that moment", () => {
    // React Flow sends a keyboard move with dragging: false
    store().onNodesChange([
      { type: "position", id: "f", position: { x: 5, y: 0 }, dragging: false },
    ]);
    expect(pos("in")).toEqual({ x: 45, y: 60 });
  });

  it("resizing from the left/top border leaves the inner shapes in place (#170)", () => {
    // NodeResizer moves the frame and resizes it in one batch, with no dragging key
    store().onNodesChange([
      { type: "position", id: "f", position: { x: -50, y: 0 } },
      { type: "dimensions", id: "f", dimensions: { width: 450, height: 300 }, setAttributes: true },
    ]);
    expect(pos("in")).toEqual({ x: 40, y: 60 });
  });

  it("when the drag ends, the shapes that came along leave the dragging state too (#170)", () => {
    store().beginNodeDrag(["f"]);
    drag("f", 100, 50);
    expect(node("in").dragging).toBe(true);
    store().onNodesChange([
      { type: "position", id: "f", position: { x: 100, y: 50 }, dragging: false },
    ]);
    expect(node("in").dragging).toBe(false);
    store().endNodeDrag();
    expect(store().nodes.some((n) => n.dragging)).toBe(false);
  });

  it("inner edges move their bend points along too (#170)", () => {
    store().applyOps([
      { op: "add_node", node: { id: "in2", label: "In2", x: 200, y: 200 } },
      {
        op: "add_edge",
        edge: { id: "e", source: "in", target: "in2", waypoints: [{ x: 120, y: 230 }] },
      },
    ]);
    store().beginNodeDrag(["f"]);
    drag("f", 100, 0);
    store().endNodeDrag();
    expect(store().edges.find((e) => e.id === "e")?.data?.waypoints).toEqual([{ x: 220, y: 230 }]);
  });

  it("the selection box does not pick a frame it only overlaps — only when fully enclosed (#170)", () => {
    const changes = [
      { type: "select" as const, id: "f", selected: true },
      { type: "select" as const, id: "in", selected: true },
    ];
    const inside = { x: 30, y: 50, width: 200, height: 80 };
    expect(
      withoutTouchedBackdrops(changes, store().nodes, inside).map((c) => (c as { id: string }).id),
    ).toEqual(["in"]);
    const whole = { x: -10, y: -10, width: 500, height: 400 };
    expect(withoutTouchedBackdrops(changes, store().nodes, whole)).toBe(changes);
  });

  it("resizing affects only the frame", () => {
    store().onNodesChange([
      { type: "dimensions", id: "f", dimensions: { width: 200, height: 200 }, setAttributes: true },
    ]);
    expect(pos("in")).toEqual({ x: 40, y: 60 });
  });

  it("dragging a box brings nothing along", () => {
    expect(dragRiders(store().nodes, ["in"])).toEqual({});
    const changes = [{ type: "position" as const, id: "in", position: { x: 0, y: 0 } }];
    expect(withFrameRiders(changes, store().nodes, null)).toBe(changes);
  });

  it("one undo brings back the frame and its inner shapes together", () => {
    store().commit(); // what onNodeDragStart does
    store().beginNodeDrag(["f"]);
    drag("f", 100, 0);
    store().endNodeDrag();
    store().undo();
    expect(pos("f")).toEqual({ x: 0, y: 0 });
    expect(pos("in")).toEqual({ x: 40, y: 60 });
  });
});

describe("Frames are background (#170 D2·D3·D8)", () => {
  beforeEach(setup);

  it("a new frame sits behind edges and fragments (z −2) and passes clicks through", () => {
    const f = createShapeNode("frame", { x: 0, y: 0 });
    expect(f.zIndex).toBe(FRAME_DEFAULT_Z);
    expect(f.style).toEqual({ pointerEvents: "none" });
    expect(isBackdrop("frame")).toBe(true);
    expect(isBackdrop("rect")).toBe(false);
  });

  it("from a file without z, uses the default z and restores the style", () => {
    const raw = {
      id: "f",
      type: "shape",
      position: { x: 0, y: 0 },
      data: { label: "A", shape: "frame", color: "mono" },
    } as unknown as DiagramNode;
    const n = normalizeNode(raw);
    expect(n.zIndex).toBe(FRAME_DEFAULT_Z);
    expect(n.style).toEqual({ pointerEvents: "none" });
  });

  it("cannot be an edge endpoint — via the bridge either", () => {
    const r = store().applyOps([{ op: "add_edge", edge: { source: "f", target: "in" } }]);
    expect(r.errors[0]).toContain("fragments and frames cannot be edge endpoints");
    expect(store().edges).toHaveLength(0);
  });

  it("does not change shape — neither from a frame nor into one", () => {
    const r = store().applyOps([
      { op: "update_node", id: "f", set: { shape: "rect" } },
      { op: "update_node", id: "in", set: { shape: "frame" } },
    ]);
    expect(r.errors).toHaveLength(2);
    expect(node("f").data.shape).toBe("frame");
    expect(node("in").data.shape).toBe("rect");
  });

  it("moving via the bridge moves only the frame (D6)", () => {
    store().applyOps([{ op: "update_node", id: "f", set: { x: 100 } }]);
    expect(pos("in")).toEqual({ x: 40, y: 60 });
  });

  it("is not an obstacle that edges route around", () => {
    expect(routingObstacles([node("f")])).toEqual([]);
  });

  it("is left out of auto layout", () => {
    store().applyOps([{ op: "layout" }]);
    expect(pos("f")).toEqual({ x: 0, y: 0 });
  });

  it("auto layout does not push shapes out of a frame (#172)", () => {
    store().applyOps([
      { op: "delete_node", id: "edge" },
      { op: "delete_node", id: "out" },
      { op: "add_node", node: { id: "in2", label: "In2", x: 200, y: 60 } },
      { op: "add_edge", edge: { source: "in", target: "in2" } },
      { op: "layout", direction: "LR" },
    ]);
    for (const id of ["in", "in2"]) {
      expect(pos(id).x).toBeLessThan(400);
      expect(pos(id).y).toBeLessThan(300);
    }
  });
});

describe("Arranging does not empty frames — the frame grows if they overflow (#182)", () => {
  const four = () => {
    store().loadDoc(makeDoc([], []), null);
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 0, y: 0, width: 480, height: 300 },
      },
      { op: "add_node", node: { id: "s1", label: "1", x: 20, y: 40 } },
      { op: "add_node", node: { id: "s2", label: "2", x: 200, y: 40 } },
      { op: "add_node", node: { id: "s3", label: "3", x: 20, y: 120 } },
      { op: "add_node", node: { id: "s4", label: "4", x: 200, y: 120 } },
    ]);
  };
  const inside = (id: string) => {
    const f = nodeBounds(node("f"));
    const b = nodeBounds(node(id));
    return (
      b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height
    );
  };

  for (const direction of ["TB", "LR"] as const) {
    it(`frame only selected, ${direction} — all four shapes stay inside the frame`, () => {
      four();
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "f" })),
      }));
      const r = store().autoLayout(direction, arrangeableSelection(store().nodes));
      expect(r.moved).toBe(4);
      for (const id of ["s1", "s2", "s3", "s4"]) expect(inside(id)).toBe(true);
      expect(pos("f")).toEqual({ x: 0, y: 0 });
    });
  }

  it("the bridge layout does the same — one undo restores the frame size too", () => {
    four();
    store().applyOps([{ op: "layout", direction: "LR" }]);
    for (const id of ["s1", "s2", "s3", "s4"]) expect(inside(id)).toBe(true);
    store().undo();
    expect(node("f").width).toBe(480);
  });

  const frameOnly = () =>
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: n.id === "f" })),
    }));

  for (const [direction, other] of [
    ["TB", { id: "out", label: "Out", x: 100, y: 350 }],
    ["LR", { id: "out", label: "Out", x: 520, y: 40 }],
    ["TB", { id: "out", label: "L", shape: "lifeline", x: 100, y: 350, width: 120, height: 200 }],
  ] as const) {
    it(`the grown frame does not swallow unrelated shapes — ${direction}, ${other.label} (#182)`, () => {
      four();
      store().applyOps([{ op: "add_node", node: other }]);
      const outBefore = { ...pos("out") };
      frameOnly();
      store().autoLayout(direction, arrangeableSelection(store().nodes));
      for (const id of ["s1", "s2", "s3", "s4"]) expect(inside(id)).toBe(true);
      expect(inside("out")).toBe(false);
      expect(pos("out")).toEqual(outBefore);
      // and nothing it did not arrange sits under the grown frame
      const f = nodeBounds(node("f"));
      const o = nodeBounds(node("out"));
      const overlap =
        f.x < o.x + o.width && o.x < f.x + f.width && f.y < o.y + o.height && o.y < f.y + f.height;
      expect(overlap).toBe(false);
    });
  }

  it("the frame keeps its shapes even when the selection spills past its left/top (#182)", () => {
    four();
    store().applyOps([{ op: "add_node", node: { id: "lead", label: "Lead", x: -400, y: -300 } }]);
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({
        ...n,
        selected: ["lead", "s1", "s2", "s3", "s4"].includes(n.id),
      })),
    }));
    const r = store().autoLayout("LR", arrangeableSelection(store().nodes));
    expect(r.framesAdjusted).toBe(1);
    for (const id of ["s1", "s2", "s3", "s4"]) expect(inside(id)).toBe(true);
    // the title strip stays above the shapes it holds
    const f = nodeBounds(node("f"));
    for (const id of ["s1", "s2", "s3", "s4"])
      expect(pos(id).y).toBeGreaterThanOrEqual(f.y + FRAME_TITLE_H);
  });

  it("arranging part of a frame's contents keeps the unselected shapes in the frame (#182)", () => {
    store().loadDoc(makeDoc([], []), null);
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 0, y: 0, width: 480, height: 300 },
      },
      { op: "add_node", node: { id: "a", label: "A", x: 20, y: 40 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 40 } },
      { op: "add_node", node: { id: "c", label: "C", x: 20, y: 200 } },
    ]);
    const before = frameContents(store().nodes, node("f")).sort();
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: n.id === "a" || n.id === "b" })),
    }));
    store().autoLayout("TB", arrangeableSelection(store().nodes));
    expect(frameContents(store().nodes, node("f")).sort()).toEqual(before);
    expect(pos("f")).toEqual({ x: 0, y: 0 });
  });

  it("known limitation: a frame growing in place covers shapes between it and the pushed block (#182)", () => {
    store().loadDoc(makeDoc([], []), null);
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 0, y: 0, width: 480, height: 300 },
      },
      { op: "add_node", node: { id: "a", label: "A", x: 20, y: 40 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 40 } },
      { op: "add_node", node: { id: "c", label: "C", x: 20, y: 200 } },
      { op: "add_node", node: { id: "out", label: "Out", x: 100, y: 400 } },
    ]);
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: n.id === "a" || n.id === "b" })),
    }));
    store().autoLayout("TB", arrangeableSelection(store().nodes));
    // a deliberate trade: keeping `c` in the frame wins over keeping `out` out
    expect(frameContents(store().nodes, node("f"))).toContain("c");
    expect(frameContents(store().nodes, node("f"))).toContain("out");
  });

  it("shapes that already overlapped the title band do not make the frame grow upward", () => {
    store().loadDoc(makeDoc([], []), null);
    store().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "F", shape: "frame", x: 0, y: 0, width: 480, height: 400 },
      },
      { op: "add_node", node: { id: "a", label: "A", x: 20, y: 10 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 10 } },
    ]);
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: n.id === "f" })),
    }));
    const r = store().autoLayout("TB", arrangeableSelection(store().nodes));
    expect(pos("f")).toEqual({ x: 0, y: 0 });
    expect(r.framesAdjusted).toBe(0);
  });

  it("the frame stays as is when everything fits", () => {
    four();
    store().applyOps([
      { op: "delete_node", id: "s3" },
      { op: "delete_node", id: "s4" },
      { op: "layout", direction: "TB" },
    ]);
    expect(node("f")).toMatchObject({ width: 480, height: 300 });
  });
});

describe("Selecting does not bring to front (#170 D7)", () => {
  it("the canvas turns off React Flow's elevateNodesOnSelect", () => {
    const source = readFileSync(
      join(__dirname, "../../../features/canvas/DiagramCanvas.tsx"),
      "utf8",
    );
    expect(source).toContain("elevateNodesOnSelect={false}");
  });

  it("CSS does not raise the z of selected nodes either", () => {
    const css = readFileSync(join(__dirname, "../../../App.css"), "utf8");
    expect(css).not.toMatch(/\.react-flow__node\.selected\s*\{[^}]*z-index/);
  });
});
