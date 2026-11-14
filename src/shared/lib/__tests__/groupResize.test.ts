import { beforeEach, describe, expect, it } from "vitest";

import { resizeFloor } from "../resizeFloor";
import { useDiagramStore } from "../store";
import { groupBox, resizeBox, scaleGroup, scaleFloor } from "../store/groupResize";
import type { DiagramNode } from "../types";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

const grouped = (n: DiagramNode, g = "g1"): DiagramNode => ({
  ...n,
  data: { ...n.data, groupId: g },
});

// a 100×50 at (0,0) and a 100×50 at (200,100): the group box is 300×150
const a = grouped(makeNode({ id: "a", x: 0, y: 0, width: 100, height: 50 }));
const b = grouped(makeNode({ id: "b", x: 200, y: 100, width: 100, height: 50 }));
const out = makeNode({ id: "out", x: 900, y: 900, width: 100, height: 50 });
const at = (nodes: DiagramNode[], id: string) => nodes.find((n) => n.id === id)!;

describe("groupBox", () => {
  it("a box enclosing all members", () => {
    expect(groupBox([a, b])).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });
});

describe("scaleGroup — changing the group box scales members proportionally (#179)", () => {
  it("doubling doubles both the size and the distance from the origin", () => {
    const { nodes } = scaleGroup([a, b, out], [], ["a", "b"], {
      x: 0,
      y: 0,
      width: 600,
      height: 300,
    });
    expect(at(nodes, "a")).toMatchObject({ position: { x: 0, y: 0 }, width: 200, height: 100 });
    expect(at(nodes, "b")).toMatchObject({ position: { x: 400, y: 200 }, width: 200, height: 100 });
  });

  it("shrinking by moving the top-left gathers toward it — the bottom-right stays", () => {
    const { nodes } = scaleGroup([a, b], [], ["a", "b"], {
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
    expect(at(nodes, "a")).toMatchObject({ position: { x: 100, y: 50 }, width: 67, height: 33 });
    expect(at(nodes, "b")).toMatchObject({ position: { x: 233, y: 117 }, width: 67, height: 33 });
  });

  it("shapes outside the group stay put", () => {
    const { nodes } = scaleGroup([a, b, out], [], ["a", "b"], {
      x: 0,
      y: 0,
      width: 600,
      height: 300,
    });
    expect(at(nodes, "out")).toBe(out);
  });

  it("edges between members scale their bend points too — edges leaving the group stay put", () => {
    const inner = { ...makeEdge({ id: "ab", source: "a", target: "b" }) };
    inner.data = { ...inner.data!, waypoints: [{ x: 150, y: 25 }] };
    const leaving = { ...makeEdge({ id: "bo", source: "b", target: "out" }) };
    leaving.data = { ...leaving.data!, waypoints: [{ x: 600, y: 125 }] };
    const { edges } = scaleGroup([a, b, out], [inner, leaving], ["a", "b"], {
      x: 0,
      y: 0,
      width: 600,
      height: 300,
    });
    expect(edges.find((e) => e.id === "ab")!.data!.waypoints).toEqual([{ x: 300, y: 50 }]);
    expect(edges.find((e) => e.id === "bo")).toBe(leaving);
  });

  it("coordinates and sizes are integers", () => {
    const { nodes } = scaleGroup([a, b], [], ["a", "b"], { x: 0, y: 0, width: 301, height: 151 });
    for (const n of nodes) {
      expect(Number.isInteger(n.position.x) && Number.isInteger(n.position.y)).toBe(true);
      expect(Number.isInteger(n.width!) && Number.isInteger(n.height!)).toBe(true);
    }
  });
});

describe("scaleFloor — the scale at which no member shrinks below its own minimum size", () => {
  it("the scale never exceeds 1 even if a member is already below its floor — the group does not jump bigger (#179)", () => {
    const tiny = grouped(makeNode({ id: "t", x: 400, y: 0, width: 10, height: 10 }));
    const least = scaleFloor([a, tiny]);
    expect(least.x).toBeLessThanOrEqual(1);
    expect(least.y).toBeLessThanOrEqual(1);
  });

  it("the member that hits its floor first decides", () => {
    const floor = resizeFloor(a.data);
    expect(scaleFloor([a, b])).toEqual({ x: floor.width / 100, y: floor.height / 50 });
  });
});

describe("resizeBox — the new group box after dragging a handle", () => {
  const from = { x: 0, y: 0, width: 300, height: 150 };
  const free = { minWidth: 30, minHeight: 15, keepAspect: false };

  it("bottom-right handle: the top-left is fixed", () => {
    expect(resizeBox(from, "bottom-right", 100, 50, free)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
  });

  it("top-left handle: the bottom-right is fixed", () => {
    expect(resizeBox(from, "top-left", 100, 50, free)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    });
  });

  it("edge handles move one axis only", () => {
    expect(resizeBox(from, "right", 100, 999, free)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 150,
    });
    expect(resizeBox(from, "top", 999, -50, free)).toEqual({
      x: 0,
      y: -50,
      width: 300,
      height: 200,
    });
  });

  it("does not shrink below the minimum size, and the fixed side does not move", () => {
    expect(resizeBox(from, "top-left", 1000, 1000, free)).toEqual({
      x: 270,
      y: 135,
      width: 30,
      height: 15,
    });
  });

  it("keeping the aspect ratio (when the group has an image): follows the axis that moved more", () => {
    const box = resizeBox(from, "bottom-right", 300, 10, { ...free, keepAspect: true });
    expect(box).toEqual({ x: 0, y: 0, width: 600, height: 300 });
  });
});

describe("resizeGroup — store (#179)", () => {
  const store = () => useDiagramStore.getState();
  beforeEach(() => {
    store().loadDoc(makeDoc([], []), null);
    store().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 100, height: 50 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 100, width: 100, height: 50 } },
      { op: "add_node", node: { id: "c", label: "C", x: 900, y: 0, width: 100, height: 50 } },
      { op: "group", ids: ["a", "b"], id: "g1" },
    ]);
  });

  it("computes from the starting state throughout the drag and comes back with a single undo", () => {
    const before = store().nodes;
    const undoDepth = store().past.length;
    store().beginGroupResize("g1");
    store().resizeGroup({ x: 0, y: 0, width: 450, height: 225 });
    store().resizeGroup({ x: 0, y: 0, width: 600, height: 300 });
    store().endGroupResize();
    expect(at(store().nodes, "b")).toMatchObject({ position: { x: 400, y: 200 }, width: 200 });
    expect(at(store().nodes, "c").position).toEqual({ x: 900, y: 0 });
    expect(store().past.length).toBe(undoDepth + 1);
    store().undo();
    expect(at(store().nodes, "b").position).toEqual(at(before, "b").position);
    expect(at(store().nodes, "b").width).toBe(100);
  });

  it("leaves no undo step when it ends without moving", () => {
    const undoDepth = store().past.length;
    store().beginGroupResize("g1");
    store().endGroupResize();
    expect(store().past.length).toBe(undoDepth);
  });

  it("does nothing for a non-group", () => {
    store().beginGroupResize("nope");
    store().resizeGroup({ x: 0, y: 0, width: 600, height: 300 });
    expect(at(store().nodes, "b").width).toBe(100);
  });

  it("drops now-useless bend points of edges leaving the group when it ends — same as resizing one shape (#179)", () => {
    store().applyOps([{ op: "add_edge", edge: { id: "ac", source: "a", target: "c" } }]);
    useDiagramStore.setState((st) => ({
      edges: st.edges.map((e) =>
        e.id === "ac" ? { ...e, data: { ...e.data!, waypoints: [{ x: 300, y: 30 }] } } : e,
      ),
    }));
    store().beginGroupResize("g1");
    store().resizeGroup({ x: 0, y: 0, width: 1500, height: 750 });
    // still there mid-drag — dragging back must find it again
    expect(store().edges.find((e) => e.id === "ac")!.data!.waypoints).toEqual([{ x: 300, y: 30 }]);
    store().endGroupResize();
    expect(store().edges.find((e) => e.id === "ac")!.data!.waypoints).toBeUndefined();
  });

  it("undoing mid-drag ends the resize — remaining steps are not applied without undo", () => {
    store().beginGroupResize("g1");
    store().resizeGroup({ x: 0, y: 0, width: 450, height: 225 });
    store().undo();
    expect(store().groupResizing).toBeNull();
    store().resizeGroup({ x: 0, y: 0, width: 600, height: 300 });
    expect(at(store().nodes, "b").width).toBe(100);
  });

  it("bend points of edges between members remain after halving — they scaled along (D14, #179)", () => {
    store().applyOps([{ op: "add_edge", edge: { id: "ab", source: "a", target: "b" } }]);
    useDiagramStore.setState((st) => ({
      edges: st.edges.map((e) =>
        e.id === "ab" ? { ...e, data: { ...e.data!, waypoints: [{ x: 150, y: 25 }] } } : e,
      ),
    }));
    store().beginGroupResize("g1");
    store().resizeGroup({ x: 0, y: 0, width: 150, height: 75 });
    const mid = store().edges.find((e) => e.id === "ab")!.data!.waypoints;
    store().endGroupResize();
    expect(store().edges.find((e) => e.id === "ab")!.data!.waypoints).toEqual(mid);
    expect(mid).toHaveLength(1);
  });
});

describe("Changing shape raises to the new shape's minimum size (#179)", () => {
  const store = () => useDiagramStore.getState();
  beforeEach(() => {
    store().loadDoc(makeDoc([], []), null);
    store().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 160, height: 56 } },
    ]);
  });

  it("edit bar: a 160×56 box turned into a lifeline → height 120 (so the first resize does not jump)", () => {
    store().updateNodeData("a", { shape: "lifeline" });
    const a = store().nodes.find((n) => n.id === "a")!;
    expect(a).toMatchObject({ width: 160, height: 120 });
  });

  it("the bridge update_node does the same", () => {
    store().applyOps([{ op: "update_node", id: "a", set: { shape: "lifeline" } }]);
    expect(store().nodes.find((n) => n.id === "a")!.height).toBe(120);
  });

  it("stays as is when larger than the minimum size", () => {
    store().updateNodeData("a", { shape: "diamond" });
    expect(store().nodes.find((n) => n.id === "a")).toMatchObject({ width: 160, height: 56 });
  });
});
