import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../store";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

const selected = () =>
  useDiagramStore
    .getState()
    .nodes.filter((n) => n.selected)
    .map((n) => n.id)
    .sort();

const select = (ids: string[]) =>
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
    edges: s.edges.map((e) => ({ ...e, selected: false })),
  }));

beforeEach(() => {
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 }), makeNode({ id: "c", x: 600 })],
        [makeEdge({ id: "e", source: "a", target: "b" })],
      ),
      null,
    );
});

describe("what a right-click does to the selection (#139)", () => {
  it("right-clicking a shape outside the selection selects only that shape", () => {
    select(["a", "b"]);
    useDiagramStore.getState().selectForContextMenu("c");
    expect(selected()).toEqual(["c"]);
  });

  it("right-clicking an already selected shape keeps the selection", () => {
    // If picking five and right-clicking one narrowed it down to one,
    // the "selection" the menu talks about would differ from what actually gets exported
    select(["a", "b"]);
    useDiagramStore.getState().selectForContextMenu("a");
    expect(selected()).toEqual(["a", "b"]);
  });

  it("selects the right-clicked shape when nothing is selected", () => {
    select([]);
    useDiagramStore.getState().selectForContextMenu("b");
    expect(selected()).toEqual(["b"]);
  });

  it("clears the edge selection too when the selection moves", () => {
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: false })),
      edges: s.edges.map((e) => ({ ...e, selected: true })),
    }));
    useDiagramStore.getState().selectForContextMenu("a");
    expect(useDiagramStore.getState().edges.some((e) => e.selected)).toBe(false);
  });

  it("does not create new node objects when the selection is already right", () => {
    select(["a"]);
    const before = useDiagramStore.getState().nodes;
    useDiagramStore.getState().selectForContextMenu("a");
    // React Flow decides re-renders by node identity — if new objects appeared
    // without a selection change, every right-click would redraw the whole canvas
    expect(useDiagramStore.getState().nodes).toBe(before);
  });
});
