import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../store";
import {
  MAX_LABEL_LENGTH,
  MAX_WAYPOINTS,
  sanitizeDestroyY,
  sanitizeBranches,
  sanitizeFragmentKind,
  sanitizeZ,
  visibleDestroyY,
} from "../store/opValidation";
import type { AgentOp } from "../types";
import { makeDoc } from "./testFixtures";

const resetStore = () => {
  useDiagramStore.getState().loadDoc(makeDoc([], [], "Untitled Diagram"), null);
};

const apply = (ops: unknown[]) => useDiagramStore.getState().applyOps(ops as AgentOp[]);

describe("applyOps input validation (guarding against arbitrary JSON from the bridge)", () => {
  beforeEach(resetStore);

  it("rejects invalid shape/color enums", () => {
    const result = apply([
      { op: "add_node", node: { label: "A", shape: "triangle", x: 0, y: 0 } },
      { op: "add_node", node: { label: "B", color: "magenta", x: 0, y: 0 } },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/shape must be one of/);
    expect(result.errors[1]).toMatch(/color must be one of/);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("rejects NaN/Infinity coordinates and negative sizes", () => {
    const result = apply([
      { op: "add_node", node: { label: "A", x: Number.NaN, y: 0 } },
      { op: "add_node", node: { label: "B", x: 0, y: Number.POSITIVE_INFINITY } },
      { op: "add_node", node: { label: "C", x: 0, y: 0, width: -10 } },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(3);
  });

  it("rejects non-numeric coordinate strings", () => {
    const result = apply([{ op: "add_node", node: { label: "A", x: "10", y: 0 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toMatch(/x must be a finite number/);
  });

  it("unknown update_node keys are not injected into node data", () => {
    apply([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    const result = apply([
      { op: "update_node", id: "a", set: { label: "B", __proto__polluted: true, evil: "x" } },
    ]);
    expect(result.applied).toBe(1);
    const node = useDiagramStore.getState().nodes[0];
    expect(node?.data.label).toBe("B");
    expect(node?.data).not.toHaveProperty("evil");
    expect(node?.data).not.toHaveProperty("__proto__polluted");
  });

  it("rejects malformed activations", () => {
    apply([{ op: "add_node", node: { id: "l1", label: "A", shape: "lifeline", x: 0, y: 0 } }]);
    const cases = [
      { notArray: true },
      [{ y0: 10 }],
      [{ y0: "10", y1: 20 }],
      [{ y0: Number.NaN, y1: 20 }],
      [{ y0: 30, y1: 20 }],
      [{ y0: 20, y1: 20 }],
      Array.from({ length: 101 }, (_, i) => ({ y0: i, y1: i + 1 })),
    ];
    for (const activations of cases) {
      const result = apply([{ op: "update_node", id: "l1", set: { activations } }]);
      expect(result.applied).toBe(0);
      expect(result.errors[0]).toMatch(/activations must be/);
    }
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toBeUndefined();
  });

  it("set_diagram/loadDoc drop malformed activations (a path that bypasses per-op validation)", () => {
    const lifeline = (activations: unknown) => ({
      id: "l",
      type: "shape" as const,
      position: { x: 0, y: 0 },
      width: 120,
      height: 360,
      data: { label: "L", shape: "lifeline" as const, color: "violet" as const, activations },
    });
    // non-finite values that got through would become NaN geometry in render/export
    for (const bad of [[{ y0: "a", y1: null }], [{ y0: Number.NaN, y1: 10 }], "nope"]) {
      apply([
        { op: "set_diagram", doc: { version: 1, title: "t", nodes: [lifeline(bad)], edges: [] } },
      ]);
      expect(useDiagramStore.getState().nodes[0]?.data.activations).toBeUndefined();
    }
    // keeps valid values but drops unknown keys
    apply([
      {
        op: "set_diagram",
        doc: {
          version: 1,
          title: "t",
          nodes: [lifeline([{ y0: 100, y1: 200, junk: "leak" }])],
          edges: [],
        },
      },
    ]);
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([{ y0: 100, y1: 200 }]);
  });

  it("activations are rejected on non-lifeline nodes", () => {
    apply([{ op: "add_node", node: { id: "r", label: "R", x: 0, y: 0 } }]);
    const result = apply([
      { op: "update_node", id: "r", set: { activations: [{ y0: 10, y1: 20 }] } },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toMatch(/only valid on lifeline/);
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toBeUndefined();
    // switching to lifeline in the same op is allowed
    const ok = apply([
      { op: "update_node", id: "r", set: { shape: "lifeline", activations: [{ y0: 10, y1: 20 }] } },
    ]);
    expect(ok.applied).toBe(1);
  });

  it("update_node.activations does not store unknown keys", () => {
    apply([{ op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } }]);
    apply([{ op: "update_node", id: "l", set: { activations: [{ y0: 1, y1: 2, junk: "leak" }] } }]);
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([{ y0: 1, y1: 2 }]);
  });

  it("add_message: rejects non-lifelines, unknown nodes, non-finite y, and ranges with no overlap", () => {
    apply([
      { op: "add_node", node: { id: "l1", label: "A", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "l2", label: "B", shape: "lifeline", x: 300, y: 1000 } },
      { op: "add_node", node: { id: "r", label: "R", x: 600, y: 0 } },
    ]);
    const result = apply([
      { op: "add_message", message: { from: "l1", to: "nope", y: 100 } },
      { op: "add_message", message: { from: "l1", to: "r", y: 100 } },
      { op: "add_message", message: { from: "l1", to: "l1", y: "100" } },
      { op: "add_message", message: { from: "l1", to: "l1", y: Number.NaN } },
      { op: "add_message", message: { from: "l1", to: "l2", y: 100 } }, // vertical ranges do not overlap
      { op: "add_message", message: { from: "l1", to: "l1", y: 100, variant: "zigzag" } },
      { op: "add_message" },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(7);
    expect(useDiagramStore.getState().edges).toHaveLength(0);
  });

  it("add_activation: rejects non-lifelines and invalid spans", () => {
    apply([
      { op: "add_node", node: { id: "l1", label: "A", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "r", label: "R", x: 600, y: 0 } },
    ]);
    const result = apply([
      { op: "add_activation", lifeline: "r", y0: 10, y1: 20 },
      { op: "add_activation", lifeline: "nope", y0: 10, y1: 20 },
      { op: "add_activation", lifeline: "l1", y0: 30, y1: 20 },
      { op: "add_activation", lifeline: "l1", y0: Number.NaN, y1: 20 },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(4);
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toBeUndefined();
  });

  it("update_edge blocks unknown keys and rejects invalid enums", () => {
    apply([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
    ]);
    const bad = apply([{ op: "update_edge", id: "e1", set: { variant: "zigzag" } }]);
    expect(bad.applied).toBe(0);
    expect(bad.errors[0]).toMatch(/variant must be one of/);

    const sneaky = apply([{ op: "update_edge", id: "e1", set: { label: "ok", injected: true } }]);
    expect(sneaky.applied).toBe(1);
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.data?.label).toBe("ok");
    expect(edge?.data).not.toHaveProperty("injected");
  });

  it("validates the opacity range (0..1) and the waypoints format", () => {
    apply([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
    ]);
    const result = apply([
      { op: "add_edge", edge: { source: "a", target: "b", opacity: 3 } },
      { op: "add_edge", edge: { source: "a", target: "b", waypoints: [{ x: Number.NaN, y: 0 }] } },
      { op: "add_edge", edge: { source: "a", target: "b", waypoints: "not-array" } },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(3);
  });

  it("rejects oversized labels and too many waypoints", () => {
    apply([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
    ]);
    const result = apply([
      { op: "add_node", node: { label: "x".repeat(MAX_LABEL_LENGTH + 1), x: 0, y: 0 } },
      {
        op: "add_edge",
        edge: {
          source: "a",
          target: "b",
          waypoints: Array.from({ length: MAX_WAYPOINTS + 1 }, (_, i) => ({ x: i, y: i })),
        },
      },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(2);
  });

  it("set_diagram rejects structurally broken nodes/edges (prevents crashes)", () => {
    const result = apply([
      {
        op: "set_diagram",
        doc: {
          version: 1,
          title: "broken",
          nodes: [{ id: "a" }],
          edges: [{ id: "e", source: 1 }],
        },
      },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors.some((e) => e.includes("nodes[0]"))).toBe(true);
    expect(result.errors.some((e) => e.includes("edges[0]"))).toBe(true);
    expect(useDiagramStore.getState().title).toBe("Untitled Diagram");
  });

  it("rejects set/node that is not an object", () => {
    apply([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    const result = apply([
      { op: "add_node", node: null },
      { op: "update_node", id: "a", set: null },
      { op: "update_edge", id: "missing", set: {} },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(3);
  });
});

describe("Remaining store actions", () => {
  beforeEach(resetStore);

  it("deleteElements: deleting a node cleans up connected edges and orphan anchors", () => {
    const s = useDiagramStore.getState();
    s.applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
    ]);
    useDiagramStore.getState().deleteElements(["a"], []);
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["b"]);
    expect(edges).toHaveLength(0);
  });

  it("connectToNew: dropping on empty canvas creates and connects a new node", () => {
    const s = useDiagramStore.getState();
    s.applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    useDiagramStore.getState().connectToNew("a", "right", { x: 400, y: 30 }, "diamond");
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.data.shape).toBe("diamond");
    expect(nodes[1]?.selected).toBe(true);
    expect(edges[0]?.sourceHandle).toBe("right");
  });

  it("drawArrow: empty space → node makes an arrow from an anchor to the node", () => {
    const s = useDiagramStore.getState();
    s.applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 300, y: 0 } }]);
    useDiagramStore.getState().drawArrow({ x: 0, y: 20 }, { x: 320, y: 20 });
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.data.shape).toBe("anchor");
    expect(edges[0]?.source).toBe(nodes[1]?.id);
    expect(edges[0]?.target).toBe("a");
  });

  it("drawArrow: ignores drags under 8px", () => {
    useDiagramStore.getState().drawArrow({ x: 0, y: 0 }, { x: 3, y: 3 });
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("onConnect: body handle is replaced by one picked from relative position", () => {
    const s = useDiagramStore.getState();
    s.applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 400, y: 0 } },
    ]);
    useDiagramStore
      .getState()
      .onConnect({ source: "a", target: "b", sourceHandle: "body", targetHandle: null });
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.sourceHandle).toBe("right");
    expect(edge?.targetHandle).toBe("left");
  });

  it("clearTouched: removes only touched entries before the cutoff time", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }], true);
    expect(useDiagramStore.getState().touched.a).toBeDefined();
    useDiagramStore.getState().clearTouched(Date.now() + 10_000);
    expect(useDiagramStore.getState().touched.a).toBeUndefined();
  });

  it("updateNodeData/setTitle/setFilePath/requestEditLabel basic behavior", () => {
    const s = useDiagramStore.getState();
    s.applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    useDiagramStore.getState().updateNodeData("a", { color: "teal" });
    useDiagramStore.getState().setTitle("New Title");
    useDiagramStore.getState().setFilePath("/tmp/x.dosik.json");
    useDiagramStore.getState().requestEditLabel("a");
    const state = useDiagramStore.getState();
    expect(state.nodes[0]?.data.color).toBe("teal");
    expect(state.title).toBe("New Title");
    expect(state.filePath).toBe("/tmp/x.dosik.json");
    expect(state.editRequestId).toBe("a");
  });

  it("loadDoc: edges without handles get handles from the nodes' relative positions", () => {
    useDiagramStore.getState().loadDoc(
      {
        version: 1,
        title: "doc",
        nodes: [
          {
            id: "a",
            type: "shape",
            position: { x: 0, y: 0 },
            data: { label: "A", shape: "rounded", color: "violet" },
          },
          {
            id: "b",
            type: "shape",
            position: { x: 400, y: 0 },
            data: { label: "B", shape: "rounded", color: "violet" },
          },
        ],
        edges: [{ id: "e1", source: "a", target: "b", data: { variant: "solid", arrow: true } }],
      },
      null,
    );
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.sourceHandle).toBe("right");
    expect(edge?.targetHandle).toBe("left");
    expect(edge?.data?.markerEnd).toBe("arrow");
  });

  it("setNodePositionLive/updateEdgeDataLive apply without a history commit", () => {
    const s = useDiagramStore.getState();
    s.applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
    ]);
    const pastLength = useDiagramStore.getState().past.length;
    useDiagramStore.getState().setNodePositionLive("a", 50, 60);
    useDiagramStore.getState().updateEdgeDataLive("e1", { color: "rose" });
    const state = useDiagramStore.getState();
    expect(state.nodes[0]?.position).toEqual({ x: 50, y: 60 });
    expect(state.edges[0]?.data?.color).toBe("rose");
    expect(state.past.length).toBe(pastLength);
  });
});

describe("sanitizeDestroyY / visibleDestroyY", () => {
  it("sanitize (storage rule) ignores height — same philosophy as activation bars", () => {
    // shrinking and then growing a lifeline must bring the marker back (lossless resize)
    expect(sanitizeDestroyY(200)).toBe(200);
    expect(sanitizeDestroyY(9999)).toBe(9999);
    expect(sanitizeDestroyY(-5)).toBe(-5);
  });

  it("sanitize drops only non-finite and non-numeric values", () => {
    expect(sanitizeDestroyY(Number.NaN)).toBeNull();
    expect(sanitizeDestroyY(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sanitizeDestroyY("200")).toBeNull();
    expect(sanitizeDestroyY(undefined)).toBeNull();
  });

  it("visible (render rule) decides the range", () => {
    expect(visibleDestroyY(200, 360)).toBe(200);
    expect(visibleDestroyY(40, 360)).toBe(40);
    expect(visibleDestroyY(360, 360)).toBe(360);
    expect(visibleDestroyY(10, 360)).toBeNull();
    expect(visibleDestroyY(500, 360)).toBeNull();
    expect(visibleDestroyY(Number.NaN, 360)).toBeNull();
    expect(visibleDestroyY(undefined, 360)).toBeNull();
  });
});

describe("update_node destroyY", () => {
  beforeEach(resetStore);

  it("sets and clears destroyY on a lifeline", () => {
    apply([{ op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } }]);
    expect(apply([{ op: "update_node", id: "l", set: { destroyY: 240 } }]).applied).toBe(1);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(240);
    expect(apply([{ op: "update_node", id: "l", set: { destroyY: null } }]).applied).toBe(1);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBeUndefined();
  });

  it("rejects out-of-range destroyY and non-lifeline targets", () => {
    apply([
      { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
    ]);
    expect(apply([{ op: "update_node", id: "l", set: { destroyY: 9999 } }]).errors).toHaveLength(1);
    expect(apply([{ op: "update_node", id: "b", set: { destroyY: 100 } }]).errors).toHaveLength(1);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBeUndefined();
  });

  it("sending height with destroyY validates against the new height", () => {
    apply([{ op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } }]);
    // 450 is out of range for the old height 360, but passes against the same op's new height 500
    expect(
      apply([{ op: "update_node", id: "l", set: { height: 500, destroyY: 450 } }]).applied,
    ).toBe(1);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(450);
    // conversely, shrinking so it falls out of range is rejected
    expect(
      apply([{ op: "update_node", id: "l", set: { height: 200, destroyY: 300 } }]).errors,
    ).toHaveLength(1);
  });

  it("round trip: an in-range destroyY survives save and load", () => {
    apply([{ op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } }]);
    apply([{ op: "update_node", id: "l", set: { destroyY: 240 } }]);
    const doc = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(doc, null);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(240);
  });

  it("the stored value stays even if a resize leaves it out of range (same rule as activation bars)", () => {
    apply([{ op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } }]);
    apply([{ op: "update_node", id: "l", set: { destroyY: 300 } }]);
    // matches a canvas resize — only shrinks height
    apply([{ op: "update_node", id: "l", set: { height: 200 } }]);
    const doc = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(doc, null);
    // it must survive a reload so the marker comes back when grown again
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBe(300);
  });

  it("file load drops non-finite destroyY", () => {
    const doc = makeDoc([], [], "t");
    doc.nodes = [
      {
        id: "l",
        type: "shape",
        position: { x: 0, y: 0 },
        width: 120,
        height: 360,
        data: { label: "L", shape: "lifeline", color: "violet", destroyY: Number.NaN },
      },
    ] as typeof doc.nodes;
    useDiagramStore.getState().loadDoc(doc, null);
    expect(useDiagramStore.getState().nodes[0]?.data.destroyY).toBeUndefined();
  });
});

describe("fragment / z validation", () => {
  it("sanitizeFragmentKind lets only the whitelist through", () => {
    expect(sanitizeFragmentKind("alt")).toBe("alt");
    expect(sanitizeFragmentKind("critical")).toBe("critical");
    expect(sanitizeFragmentKind("nope")).toBeNull();
    expect(sanitizeFragmentKind(undefined)).toBeNull();
    expect(sanitizeFragmentKind(1)).toBeNull();
  });

  it("sanitizeBranches clamps to 2..5 and rounds to integers", () => {
    expect(sanitizeBranches(3)).toBe(3);
    expect(sanitizeBranches(1)).toBe(2);
    expect(sanitizeBranches(99)).toBe(5);
    expect(sanitizeBranches(2.7)).toBe(3);
    expect(sanitizeBranches(Number.NaN)).toBeNull();
    expect(sanitizeBranches("3")).toBeNull();
  });

  it("sanitizeZ lets only finite numbers through", () => {
    expect(sanitizeZ(-1)).toBe(-1);
    expect(sanitizeZ(0)).toBe(0);
    expect(sanitizeZ(Number.NaN)).toBeNull();
    expect(sanitizeZ("2")).toBeNull();
    expect(sanitizeZ(undefined)).toBeNull();
  });
});

describe("fragment node", () => {
  beforeEach(resetStore);

  it("is created with the default kind alt and a z behind edges", () => {
    apply([{ op: "add_node", node: { id: "f", label: "cond", shape: "fragment", x: 0, y: 0 } }]);
    const n = useDiagramStore.getState().nodes[0];
    expect(n?.data.fragmentKind).toBe("alt");
    expect(n?.zIndex).toBeLessThan(0);
  });

  it("update_node changes the kind and branch count", () => {
    apply([{ op: "add_node", node: { id: "f", label: "c", shape: "fragment", x: 0, y: 0 } }]);
    expect(
      apply([{ op: "update_node", id: "f", set: { fragmentKind: "loop", branches: 4 } }]).applied,
    ).toBe(1);
    const n = useDiagramStore.getState().nodes[0];
    expect(n?.data.fragmentKind).toBe("loop");
    expect(n?.data.branches).toBe(4);
  });

  it("rejects invalid kinds and non-fragment targets", () => {
    apply([
      { op: "add_node", node: { id: "f", label: "c", shape: "fragment", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 500, y: 0 } },
    ]);
    expect(
      apply([{ op: "update_node", id: "f", set: { fragmentKind: "nope" } }]).errors,
    ).toHaveLength(1);
    expect(
      apply([{ op: "update_node", id: "b", set: { fragmentKind: "alt" } }]).errors,
    ).toHaveLength(1);
  });

  it("update_node changes z, and it survives a round trip", () => {
    apply([{ op: "add_node", node: { id: "f", label: "c", shape: "fragment", x: 0, y: 0 } }]);
    apply([{ op: "update_node", id: "f", set: { z: -5 } }]);
    expect(useDiagramStore.getState().nodes[0]?.zIndex).toBe(-5);
    const doc = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(doc, null);
    const n = useDiagramStore.getState().nodes[0];
    expect(n?.zIndex).toBe(-5);
    expect(n?.data.fragmentKind).toBe("alt");
  });

  it("file load drops garbage fragmentKind and z", () => {
    const doc = makeDoc([], [], "t");
    doc.nodes = [
      {
        id: "f",
        type: "shape",
        position: { x: 0, y: 0 },
        width: 420,
        height: 200,
        zIndex: Number.NaN,
        data: {
          label: "c",
          shape: "fragment",
          color: "violet",
          fragmentKind: "bogus",
          branches: 99,
        },
      },
    ] as unknown as typeof doc.nodes;
    useDiagramStore.getState().loadDoc(doc, null);
    const n = useDiagramStore.getState().nodes[0];
    expect(n?.data.fragmentKind).toBe("alt"); // restored to the default
    expect(n?.data.branches).toBe(5); // clamped to the range
    expect(n?.zIndex).toBe(undefined);
  });
});
