import { describe, expect, it } from "vitest";

import { makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { LIFT_EDGE_Z, LIFT_NODE_Z, LIFT_SELF_MESSAGE_Z, liftForView } from "../canvasLifts";

const nodes = () => [
  makeNode({ id: "a", x: 0, y: 0 }),
  makeNode({ id: "b", x: 400, y: 0 }),
  makeNode({ id: "cover", x: 180, y: 0 }),
];
const edges = () => [
  makeEdge({ id: "e", source: "a", target: "b", label: "flow" }),
  makeEdge({ id: "other", source: "b", target: "cover" }),
];

describe("raising to the front while editing a label (#93)", () => {
  it("returns the array as is when not editing — the same reference", () => {
    const n = nodes();
    const e = edges();
    const out = liftForView(n, e, null);
    // Reference identity means no update goes to React Flow
    expect(out.nodes).toBe(n);
    expect(out.edges).toBe(e);
  });

  it("returns it as is even when pointing at an edge that is gone", () => {
    const n = nodes();
    const e = edges();
    const out = liftForView(n, e, "gone");
    expect(out.nodes).toBe(n);
    expect(out.edges).toBe(e);
  });

  it("raises only the edge being edited and its two end nodes", () => {
    const out = liftForView(nodes(), edges(), "e");
    const z = (id: string) => out.nodes.find((n) => n.id === id)?.zIndex;
    expect(z("a")).toBe(LIFT_NODE_Z);
    expect(z("b")).toBe(LIFT_NODE_Z);
    // A third box covering the line is left alone — its going under is the point
    expect(z("cover")).toBeUndefined();
    expect(out.edges.find((e) => e.id === "e")?.zIndex).toBe(LIFT_EDGE_Z);
    expect(out.edges.find((e) => e.id === "other")?.zIndex).toBeUndefined();
  });

  it("keeps the line below its own two boxes", () => {
    // If the edge rises above its endpoint boxes, the stubs show across the boxes.
    // Only the box that covered it needs to sink
    expect(LIFT_EDGE_Z).toBeLessThan(LIFT_NODE_Z);
  });

  it("is above the selected node's z-index 10 (App.css !important)", () => {
    expect(LIFT_EDGE_Z).toBeGreaterThan(10);
  });

  it("does not touch the original array or node objects — nothing leaks into the store", () => {
    const n = nodes();
    const e = edges();
    const snapshot = JSON.stringify({ n, e });
    liftForView(n, e, "e");
    expect(JSON.stringify({ n, e })).toBe(snapshot);
  });

  it("keeps object references for untouched nodes", () => {
    const n = nodes();
    const out = liftForView(n, edges(), "e");
    expect(out.nodes[2]).toBe(n[2]);
  });
});

describe("self messages always sit above their lifeline (#99)", () => {
  const life = (id: string, x: number) =>
    makeNode({ id, shape: "lifeline", x, y: 0, width: 120, height: 400 });
  const msg = (id: string, from: string, to: string) => ({
    ...makeEdge({ id, source: from, target: to }),
    sourceHandle: "right-25",
    targetHandle: from === to ? "right-40" : "left-25",
  });
  const scene = () => ({
    nodes: [life("a", 0), life("b", 300), makeNode({ id: "box", x: 700 })],
    edges: [
      msg("self", "a", "a"),
      msg("cross", "a", "b"),
      makeEdge({ id: "plain", source: "box", target: "box" }),
    ],
  });

  it("raises self messages even when not editing", () => {
    const { nodes, edges } = scene();
    const out = liftForView(nodes, edges, null);
    const z = (id: string) => out.edges.find((e) => e.id === id)?.zIndex;
    expect(z("self")).toBe(LIFT_SELF_MESSAGE_Z);
    // Messages between lifelines are grabbed in empty space, so they are left alone
    expect(z("cross")).toBeUndefined();
    // A box's self loop isn't a target either — it extends outside the node and is already grabbable
    expect(z("plain")).toBeUndefined();
  });

  it("is above a selected lifeline (z 10)", () => {
    expect(LIFT_SELF_MESSAGE_Z).toBeGreaterThan(10);
  });

  it("is above even a lifeline raised by label editing (z 12)", () => {
    // If this flips, the loop hides under the lifeline while its label is edited
    expect(LIFT_SELF_MESSAGE_Z).toBeGreaterThan(LIFT_NODE_Z);
  });

  it("uses the self-message z, not the label-edit z, when editing a self message", () => {
    const { nodes, edges } = scene();
    const out = liftForView(nodes, edges, "self");
    expect(out.edges.find((e) => e.id === "self")?.zIndex).toBe(LIFT_SELF_MESSAGE_Z);
    expect(out.edges.find((e) => e.id === "self")?.zIndex).not.toBe(LIFT_EDGE_Z);
    // The end node (the same lifeline) still rises
    expect(out.nodes.find((n) => n.id === "a")?.zIndex).toBe(LIFT_NODE_Z);
  });

  it("keeps the array reference when there are no self messages and no editing", () => {
    const nodes = [makeNode({ id: "x" })];
    const edges = [makeEdge({ id: "e", source: "x", target: "x" })];
    const out = liftForView(nodes, edges, null);
    expect(out.nodes).toBe(nodes);
    expect(out.edges).toBe(edges);
  });

  it("does not touch the original array", () => {
    const { nodes, edges } = scene();
    const snapshot = JSON.stringify({ nodes, edges });
    liftForView(nodes, edges, "self");
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
  });
});

describe("the node whose label is being edited rises (#170)", () => {
  it("selection alone doesn't raise it, so the box being edited rises — frames excluded", () => {
    const box = makeNode({ id: "a" });
    const frame = {
      ...makeNode({ id: "f" }),
      data: { ...makeNode({ id: "f" }).data, shape: "frame" as const },
    };
    const lifted = liftForView([box, frame], [], null, "a");
    expect(lifted.nodes.find((n) => n.id === "a")?.zIndex).toBe(LIFT_NODE_Z);
    const framed = liftForView([box, frame], [], null, "f");
    expect(framed.nodes.find((n) => n.id === "f")?.zIndex).toBeUndefined();
    expect(liftForView([box], [], null, null).nodes[0]).toBe(box);
  });
});
