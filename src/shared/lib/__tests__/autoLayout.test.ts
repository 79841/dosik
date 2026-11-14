import { describe, expect, it } from "vitest";

import { clearOf, computeLayout, edgeLabelBox, flowsBackward, layoutTargets } from "../autoLayout";
import { nodeBounds } from "../edgeUtils";
import { pillSize } from "../labelPill";
import type { DiagramNode, MarkerShape } from "../types";
import { makeEdge, makeNode } from "./testFixtures";

const overlap = (a: DiagramNode, b: DiagramNode, pos: Map<string, { x: number; y: number }>) => {
  const pa = pos.get(a.id)!;
  const pb = pos.get(b.id)!;
  const ba = nodeBounds(a);
  const bb = nodeBounds(b);
  return (
    pa.x < pb.x + bb.width &&
    pb.x < pa.x + ba.width &&
    pa.y < pb.y + bb.height &&
    pb.y < pa.y + ba.height
  );
};

describe("Auto layout (#3)", () => {
  // a → b → c, a → d, deliberately scattered
  const nodes = [
    makeNode({ id: "a", x: 500, y: 400 }),
    makeNode({ id: "b", x: 0, y: 0 }),
    makeNode({ id: "c", x: 300, y: 50 }),
    makeNode({ id: "d", x: 10, y: 500 }),
  ];
  const edges = [
    makeEdge({ id: "ab", source: "a", target: "b" }),
    makeEdge({ id: "bc", source: "b", target: "c" }),
    makeEdge({ id: "ad", source: "a", target: "d" }),
  ];

  it("top→bottom: layers go down along the edge direction", () => {
    const pos = computeLayout(nodes, edges, { direction: "TB" });
    expect(pos.get("a")!.y).toBeLessThan(pos.get("b")!.y);
    expect(pos.get("b")!.y).toBeLessThan(pos.get("c")!.y);
    expect(pos.get("b")!.y).toBe(pos.get("d")!.y);
  });

  it("left→right: layers go sideways", () => {
    const pos = computeLayout(nodes, edges, { direction: "LR" });
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeLessThan(pos.get("c")!.x);
  });

  describe("Shapes without edges also line up in the named direction (#182)", () => {
    // With no edges at all, dagre puts everything in one rank and lays a rank out perpendicular to the direction
    const loose = [
      makeNode({ id: "p", x: 400, y: 300 }),
      makeNode({ id: "q", x: 0, y: 0 }),
      makeNode({ id: "r", x: 200, y: 600 }),
    ];
    const centre = (id: string, pos: Map<string, { x: number; y: number }>) => {
      const node = loose.find((n) => n.id === id)!;
      const { width, height } = nodeBounds(node);
      return { x: pos.get(id)!.x + width / 2, y: pos.get(id)!.y + height / 2 };
    };

    it("Left to right — one row to the right, starting from what was leftmost", () => {
      const pos = computeLayout(loose, [], { direction: "LR" });
      expect(centre("q", pos).x).toBeLessThan(centre("r", pos).x);
      expect(centre("r", pos).x).toBeLessThan(centre("p", pos).x);
      expect(new Set(["p", "q", "r"].map((id) => centre(id, pos).y)).size).toBe(1);
    });

    it("Top to bottom — one column downward, starting from what was topmost", () => {
      const pos = computeLayout(loose, [], { direction: "TB" });
      expect(centre("q", pos).y).toBeLessThan(centre("p", pos).y);
      expect(centre("p", pos).y).toBeLessThan(centre("r", pos).y);
      expect(new Set(["p", "q", "r"].map((id) => centre(id, pos).x)).size).toBe(1);
    });

    it("shapes connected by edges still follow the edge direction", () => {
      const pos = computeLayout(
        [...loose, makeNode({ id: "s", x: 900, y: 900 })],
        [makeEdge({ id: "sp", source: "s", target: "p" })],
        { direction: "LR" },
      );
      expect(pos.get("s")!.x).toBeLessThan(pos.get("p")!.x);
      expect(pos.get("q")!.x).toBeLessThan(pos.get("r")!.x);
    });
  });

  it("no shapes overlap", () => {
    const pos = computeLayout(nodes, edges, { direction: "TB" });
    for (const a of nodes)
      for (const b of nodes) if (a !== b) expect(overlap(a, b, pos)).toBe(false);
  });

  it("starts at the original top-left — the document does not fly off across the canvas", () => {
    const pos = computeLayout(nodes, edges, { direction: "LR" });
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
  });

  it("integer coordinates — grid-snapped editing stays crisp", () => {
    for (const p of computeLayout(nodes, edges, { direction: "TB" }).values()) {
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    }
  });

  it("sequence elements and anchors are excluded — they have their own placement rules", () => {
    const mixed = [
      ...nodes,
      makeNode({ id: "ll", shape: "lifeline", x: 0, y: 0 }),
      makeNode({ id: "fr", shape: "fragment", x: 0, y: 0 }),
      makeNode({ id: "an", shape: "anchor", x: 0, y: 0 }),
    ];
    const { nodes: targets } = layoutTargets(mixed, edges);
    expect(targets.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("with a selection, only the selection moves — the rest stays put", () => {
    const { nodes: targets, edges: inside } = layoutTargets(nodes, edges, ["a", "b"]);
    expect(targets.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(inside.map((e) => e.id)).toEqual(["ab"]);
    const pos = computeLayout(nodes, edges, { direction: "TB", ids: ["a", "b"] });
    expect([...pos.keys()].sort()).toEqual(["a", "b"]);
    // starts at the selection's original top-left (0,0 — b)
    expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(0);
  });

  it("self loops and messages do not set ranks", () => {
    const { edges: used } = layoutTargets(nodes, [
      ...edges,
      makeEdge({ id: "loop", source: "a", target: "a" }),
    ]);
    expect(used.map((e) => e.id)).not.toContain("loop");
  });
});

describe("Partially selected flow — with no edges inside the selection, keep reading order (#182)", () => {
  it("A→B→C with only A and C selected: uses their current order, not the path through the unselected node", () => {
    const nodes = [
      makeNode({ id: "A", x: 600, y: 0 }),
      makeNode({ id: "B", x: 300, y: 0 }),
      makeNode({ id: "C", x: 0, y: 0 }),
    ];
    const edges = [
      makeEdge({ id: "ab", source: "A", target: "B" }),
      makeEdge({ id: "bc", source: "B", target: "C" }),
    ];
    const pos = computeLayout(nodes, edges, { direction: "LR", ids: ["A", "C"] });
    expect(pos.get("C")!.x).toBeLessThan(pos.get("A")!.x);
    expect(pos.get("C")!.y).toBe(pos.get("A")!.y);
  });
});

describe("Arranging follows the direction the arrowhead points (#182)", () => {
  // the user's flow: stored Validate → Start, drawn with the head at the source,
  // so on screen it reads Start → Validate → Pay
  const nodes = [
    makeNode({ id: "start", x: 2000, y: 0 }),
    makeNode({ id: "validate", x: 1000, y: 0 }),
    makeNode({ id: "pay", x: 0, y: 0 }),
  ];
  const backwards = (id: string, source: string, target: string) => {
    const e = makeEdge({ id, source, target });
    return {
      ...e,
      data: { ...e.data!, markerEnd: "none" as const, markerStart: "triangle" as const },
    };
  };
  const edges = [backwards("vs", "validate", "start"), backwards("pv", "pay", "validate")];

  it("Top to bottom — top to bottom, following the on-screen flow", () => {
    const pos = computeLayout(nodes, edges, { direction: "TB" });
    expect(pos.get("start")!.y).toBeLessThan(pos.get("validate")!.y);
    expect(pos.get("validate")!.y).toBeLessThan(pos.get("pay")!.y);
  });

  it("Left to right — left to right, following the on-screen flow", () => {
    const pos = computeLayout(nodes, edges, { direction: "LR" });
    expect(pos.get("start")!.x).toBeLessThan(pos.get("validate")!.x);
    expect(pos.get("validate")!.x).toBeLessThan(pos.get("pay")!.x);
  });

  it("arrowheads on both ends or none use the stored direction (source → target)", () => {
    const both = edges.map((e) => ({ ...e, data: { ...e.data, markerEnd: "arrow" as const } }));
    const pos = computeLayout(nodes, both, { direction: "TB" });
    expect(pos.get("pay")!.y).toBeLessThan(pos.get("validate")!.y);
  });
});

describe("flowsBackward — which edges read backward", () => {
  const edge = (markerStart?: MarkerShape, markerEnd?: MarkerShape) => {
    const e = makeEdge({ id: "e", source: "a", target: "b" });
    return { ...e, data: { ...e.data!, markerStart, markerEnd } };
  };

  it("reads backward when the only pointing head is at the start", () => {
    expect(flowsBackward(edge("arrow", "none"))).toBe(true);
    expect(flowsBackward(edge("open", "none"))).toBe(true);
    expect(flowsBackward(edge("triangle", "none"))).toBe(true);
  });

  it("a default arrow, heads on both ends, or no heads use the stored direction", () => {
    expect(flowsBackward(edge(undefined, undefined))).toBe(false);
    expect(flowsBackward(edge("arrow", "arrow"))).toBe(false);
    expect(flowsBackward(edge("none", "none"))).toBe(false);
  });

  it("UML·ERD symbols do not imply direction — aggregation diamond, crow's foot", () => {
    expect(flowsBackward(edge("diamond-open", "none"))).toBe(false);
    expect(flowsBackward(edge("diamond", "arrow"))).toBe(false);
    expect(flowsBackward(edge("one", "zero-many"))).toBe(false);
  });

  it("a start arrow + end crow's foot points only at the start — backward", () => {
    expect(flowsBackward(edge("arrow", "many"))).toBe(true);
  });
});

describe("Auto layout leaves room for edge labels — labels do not cover edges (#202)", () => {
  const nodes = [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 400, y: 0 })];
  const labelled = (data: { label?: string; labelStart?: string; labelEnd?: string }) => {
    const edge = makeEdge({ id: "ab", source: "a", target: "b" });
    return [{ ...edge, data: { ...edge.data!, ...data } }];
  };
  const gapOf = (
    direction: "TB" | "LR",
    data: { label?: string; labelStart?: string; labelEnd?: string },
  ) => {
    const pos = computeLayout(nodes, labelled(data), { direction });
    const a = { ...nodeBounds(nodes[0]!), ...pos.get("a")! };
    const b = pos.get("b")!;
    return direction === "LR" ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
  };

  it("left→right: the gap between shapes is label width + an edge stub on each side (16 each) — no longer", () => {
    const label = "show me the diagram";
    const need = pillSize(label).width + 2 * 16;
    expect(gapOf("LR", { label })).toBeGreaterThanOrEqual(need);
    expect(gapOf("LR", { label })).toBeLessThanOrEqual(Math.ceil(need) + 1);
  });

  it("a short label fits in the default gap — no widening (dagre adds labels to the gap)", () => {
    expect(gapOf("LR", { label: "yes" })).toBeLessThanOrEqual(81);
  });

  it("top→bottom: label height already fits in the default gap — no widening", () => {
    expect(gapOf("TB", { label: "show me the diagram" })).toBeLessThanOrEqual(81);
  });

  it("with end labels too, enough room that the three do not overlap", () => {
    const data = { label: "places", labelStart: "1", labelEnd: "0..*" };
    const need = pillSize("places").width + pillSize("1").width + pillSize("0..*").width + 4 * 16;
    expect(gapOf("LR", data)).toBeGreaterThanOrEqual(need);
    expect(gapOf("LR", data)).toBeLessThanOrEqual(Math.ceil(need) + 1);
  });

  it("the label slot is centered on the edge — the app draws the pill at the center", () => {
    const edge = { ...makeEdge({ id: "ab", source: "a", target: "b" }) };
    const box = edgeLabelBox({ ...edge, data: { ...edge.data!, label: "x" } }, "LR", 80);
    expect(box).toMatchObject({ labelpos: "c" });
  });

  it("edges without labels keep the current gap", () => {
    expect(gapOf("LR", {})).toBe(80);
  });
});

describe("Four directions — bottom→top and right→left too (#206)", () => {
  const nodes = [
    makeNode({ id: "a", x: 500, y: 400 }),
    makeNode({ id: "b", x: 0, y: 0 }),
    makeNode({ id: "c", x: 300, y: 50 }),
  ];
  const edges = [
    makeEdge({ id: "ab", source: "a", target: "b" }),
    makeEdge({ id: "bc", source: "b", target: "c" }),
  ];

  it("bottom→top: layers go up along the edge direction", () => {
    const pos = computeLayout(nodes, edges, { direction: "BT" });
    expect(pos.get("a")!.y).toBeGreaterThan(pos.get("b")!.y);
    expect(pos.get("b")!.y).toBeGreaterThan(pos.get("c")!.y);
  });

  it("right→left: layers go leftward", () => {
    const pos = computeLayout(nodes, edges, { direction: "RL" });
    expect(pos.get("a")!.x).toBeGreaterThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeGreaterThan(pos.get("c")!.x);
  });

  it("flipped directions still start at the original top-left", () => {
    for (const direction of ["BT", "RL"] as const) {
      const pos = computeLayout(nodes, edges, { direction });
      expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(0);
      expect(Math.min(...[...pos.values()].map((p) => p.y))).toBe(0);
    }
  });

  it("shapes without edges keep reading order — bottom→top starts from the bottom, right→left from the right", () => {
    const loose = [
      makeNode({ id: "top", x: 0, y: 0 }),
      makeNode({ id: "mid", x: 300, y: 300 }),
      makeNode({ id: "low", x: 600, y: 600 }),
    ];
    const bt = computeLayout(loose, [], { direction: "BT" });
    expect(bt.get("top")!.y).toBeLessThan(bt.get("mid")!.y);
    expect(bt.get("mid")!.y).toBeLessThan(bt.get("low")!.y);
    expect(bt.get("top")!.x).toBe(bt.get("low")!.x);
    const rl = computeLayout(loose, [], { direction: "RL" });
    expect(rl.get("top")!.x).toBeLessThan(rl.get("mid")!.x);
    expect(rl.get("mid")!.x).toBeLessThan(rl.get("low")!.x);
    expect(rl.get("top")!.y).toBe(rl.get("low")!.y);
  });

  it("label box: right→left requests the horizontal length, bottom→top the vertical length", () => {
    const edge = makeEdge({ id: "ab", source: "a", target: "b" });
    const labelled = { ...edge, data: { ...edge.data!, label: "show me the diagram" } };
    expect(edgeLabelBox(labelled, "RL", 80)).toEqual(edgeLabelBox(labelled, "LR", 80));
    expect(edgeLabelBox(labelled, "BT", 80)).toEqual(edgeLabelBox(labelled, "TB", 80));
  });
});

describe("Pushing aside only looks at the axis — flipped directions also push down / right (#206 D5)", () => {
  const moving = [
    {
      box: { x: 0, y: 0, width: 100, height: 50 },
      avoid: [{ x: 50, y: 20, width: 80, height: 40 }],
    },
  ];

  it.each(["TB", "BT"] as const)("%s — down only", (direction) => {
    const shift = clearOf(moving, direction);
    expect(shift.x).toBe(0);
    expect(shift.y).toBeGreaterThan(0);
  });

  it.each(["LR", "RL"] as const)("%s — right only", (direction) => {
    const shift = clearOf(moving, direction);
    expect(shift.y).toBe(0);
    expect(shift.x).toBeGreaterThan(0);
  });
});
