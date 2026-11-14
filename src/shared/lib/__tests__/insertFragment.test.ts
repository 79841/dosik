import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../store";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

const fragment = () => ({
  nodes: [makeNode({ id: "p", x: 0, y: 0 }), makeNode({ id: "q", x: 300, y: 0 })],
  edges: [makeEdge({ id: "pq", source: "p", target: "q" })],
});

describe("insertFragment — inserting a prepared fragment into the current page (#200)", () => {
  beforeEach(() => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
  });

  it("inserts with new ids, offset by the delta, and selects only what was inserted", () => {
    const ids = useDiagramStore.getState().insertFragment(fragment(), { dx: 1000, dy: 50 });
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes).toHaveLength(3);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("p");
    const fresh = nodes.filter((n) => ids.includes(n.id));
    expect(fresh.map((n) => n.position)).toEqual([
      { x: 1000, y: 50 },
      { x: 1300, y: 50 },
    ]);
    expect(
      nodes
        .filter((n) => n.selected)
        .map((n) => n.id)
        .sort(),
    ).toEqual([...ids].sort());
    expect(edges).toHaveLength(1);
    expect([edges[0]!.source, edges[0]!.target].sort()).toEqual([...ids].sort());
  });

  it("⌘Z removes it all in one step", () => {
    useDiagramStore.getState().insertFragment(fragment(), { dx: 0, dy: 0 });
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["a"]);
    expect(useDiagramStore.getState().edges).toHaveLength(0);
  });

  it("leaves a request for the view to move to the inserted shapes' box", () => {
    useDiagramStore.getState().insertFragment(fragment(), { dx: 100, dy: 10 });
    expect(useDiagramStore.getState().revealRequest).toMatchObject({
      mode: "center",
      bounds: { x: 100, y: 10, width: 460, height: 56 },
    });
  });

  it("an empty fragment does nothing — no empty undo step either", () => {
    const past = useDiagramStore.getState().past.length;
    expect(
      useDiagramStore.getState().insertFragment({ nodes: [], edges: [] }, { dx: 0, dy: 0 }),
    ).toEqual([]);
    expect(useDiagramStore.getState().past).toHaveLength(past);
  });
});
