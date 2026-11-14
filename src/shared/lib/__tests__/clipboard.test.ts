import { describe, expect, it } from "vitest";

import { handlePointOnNode, isSequenceMessage } from "../edgeUtils";
import type { ClipboardFragment } from "../store/clipboard";
import { collectFragment, instantiateFragment } from "../store/clipboard";
import type { DiagramEdge, DiagramNode } from "../types";
import { makeEdge, makeNode } from "./testFixtures";

/** Marks a node/edge as selected — the only input `collectFragment` reads. */
const sel = <T extends DiagramNode | DiagramEdge>(item: T): T => ({ ...item, selected: true });

const ids = (items: { id: string }[]): string[] => items.map((i) => i.id).sort();

describe("collectFragment — what gets copied", () => {
  it("T1: includes a single selected node", () => {
    const a = sel(makeNode({ id: "a" }));
    const b = makeNode({ id: "b" });

    const fragment = collectFragment([a, b], []);

    expect(fragment).not.toBeNull();
    expect(ids(fragment!.nodes)).toEqual(["a"]);
    expect(fragment!.edges).toHaveLength(0);
  });

  it("T2: includes edges whose ends are both selected (even if the edge itself is not)", () => {
    const a = sel(makeNode({ id: "a" }));
    const b = sel(makeNode({ id: "b", x: 300 }));
    const e = makeEdge({ id: "e1", source: "a", target: "b" });

    const fragment = collectFragment([a, b], [e]);

    expect(ids(fragment!.nodes)).toEqual(["a", "b"]);
    expect(ids(fragment!.edges)).toEqual(["e1"]);
  });

  it("T3: drops edges with only one end in the selection", () => {
    const a = sel(makeNode({ id: "a" }));
    const b = makeNode({ id: "b", x: 300 });
    const e = makeEdge({ id: "e1", source: "a", target: "b" });

    const fragment = collectFragment([a, b], [e]);

    expect(ids(fragment!.nodes)).toEqual(["a"]);
    expect(fragment!.edges).toHaveLength(0);
  });

  it("T4: selecting only a free arrow's edge brings both end anchors along", () => {
    // Users pick a free arrow by its line (edge). Without pulling in the anchors,
    // "copy arrow" would silently do nothing.
    const p1 = makeNode({ id: "p1", shape: "anchor" });
    const p2 = makeNode({ id: "p2", shape: "anchor", x: 200 });
    const e = sel(makeEdge({ id: "e1", source: "p1", target: "p2" }));

    const fragment = collectFragment([p1, p2], [e]);

    expect(ids(fragment!.nodes)).toEqual(["p1", "p2"]);
    expect(ids(fragment!.edges)).toEqual(["e1"]);
  });

  it("T4b: includes a mix of selected nodes and anchors of selected edges", () => {
    const a = sel(makeNode({ id: "a" }));
    const p = makeNode({ id: "p", shape: "anchor", x: 200 });
    const e = sel(makeEdge({ id: "e1", source: "a", target: "p" }));

    const fragment = collectFragment([a, p], [e]);

    expect(ids(fragment!.nodes)).toEqual(["a", "p"]);
    expect(ids(fragment!.edges)).toEqual(["e1"]);
  });

  it("T5: selecting only anchor points copies nothing (orphan anchor pruning)", () => {
    // Pasting a lone invisible point is useless.
    const p1 = sel(makeNode({ id: "p1", shape: "anchor" }));
    const p2 = makeNode({ id: "p2", shape: "anchor", x: 200 });
    const e = makeEdge({ id: "e1", source: "p1", target: "p2" });

    expect(collectFragment([p1, p2], [e])).toBeNull();
  });

  it("T6: null for an empty selection — so the caller keeps its buffer", () => {
    expect(collectFragment([makeNode({ id: "a" })], [])).toBeNull();
    expect(collectFragment([], [])).toBeNull();
  });

  it("copies carry no selected flag", () => {
    // Paste decides the selection itself (R6).
    const a = sel(makeNode({ id: "a" }));
    const b = sel(makeNode({ id: "b", x: 300 }));
    const e = sel(makeEdge({ id: "e1", source: "a", target: "b" }));

    const fragment = collectFragment([a, b], [e]);

    expect(fragment!.nodes.every((n) => n.selected !== true)).toBe(true);
    expect(fragment!.edges.every((edge) => edge.selected !== true)).toBe(true);
  });

  it("does not mutate the source (deep copy)", () => {
    const a = sel(makeNode({ id: "a" }));
    const fragment = collectFragment([a], []);

    fragment!.nodes[0]!.position.x = 999;

    expect(a.position.x).toBe(0);
  });
});

const D16 = { dx: 16, dy: 16 };

/** Node id → the copy's id, for asserting an edge was rewired. */
const newIdOf = (fragment: ClipboardFragment, index: number): string => fragment.nodes[index]!.id;

describe("instantiateFragment — making copies", () => {
  it("T8: moves by the delta", () => {
    const fragment = { nodes: [makeNode({ id: "a", x: 100, y: 50 })], edges: [] };

    const pasted = instantiateFragment(fragment, D16);

    expect(pasted.nodes[0]!.position).toEqual({ x: 116, y: 66 });
  });

  it("T9: a larger delta moves further (the basis of the cascading offset)", () => {
    const fragment = { nodes: [makeNode({ id: "a", x: 100, y: 50 })], edges: [] };

    expect(instantiateFragment(fragment, { dx: 32, dy: 32 }).nodes[0]!.position).toEqual({
      x: 132,
      y: 82,
    });
    expect(instantiateFragment(fragment, { dx: 48, dy: 48 }).nodes[0]!.position).toEqual({
      x: 148,
      y: 98,
    });
  });

  it("T11: relative positions within the group are preserved", () => {
    const fragment = {
      nodes: [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 300, y: 120 })],
      edges: [],
    };

    const pasted = instantiateFragment(fragment, D16);

    const [a, b] = pasted.nodes;
    expect(b!.position.x - a!.position.x).toBe(300);
    expect(b!.position.y - a!.position.y).toBe(120);
  });

  it("T12: issues new ids and does not reuse the source ids", () => {
    const fragment = {
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      edges: [makeEdge({ id: "e1", source: "a", target: "b" })],
    };

    const pasted = instantiateFragment(fragment, D16);

    expect(pasted.nodes.map((n) => n.id)).not.toContain("a");
    expect(pasted.nodes.map((n) => n.id)).not.toContain("b");
    expect(pasted.edges[0]!.id).not.toBe("e1");
    expect(new Set(pasted.nodes.map((n) => n.id)).size).toBe(2);
  });

  it("T13: copied edges point at the copied nodes", () => {
    const fragment = {
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      edges: [makeEdge({ id: "e1", source: "a", target: "b" })],
    };

    const pasted = instantiateFragment(fragment, D16);

    expect(pasted.edges[0]!.source).toBe(newIdOf(pasted, 0));
    expect(pasted.edges[0]!.target).toBe(newIdOf(pasted, 1));
  });

  it("T14: carries handle strings over as is", () => {
    // Handles are fixed at creation (pickHandles). Recomputing them would change the shape.
    const fragment = {
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      edges: [
        makeEdge({
          id: "e1",
          source: "a",
          target: "b",
          sourceHandle: "bottom",
          targetHandle: "left",
        }),
      ],
    };

    const pasted = instantiateFragment(fragment, D16);

    expect(pasted.edges[0]!.sourceHandle).toBe("bottom");
    expect(pasted.edges[0]!.targetHandle).toBe("left");
  });

  it("T15: lifeline activation bars and destroy markers come along", () => {
    const lifeline: DiagramNode = {
      ...makeNode({ id: "l1", shape: "lifeline", height: 400 }),
      data: {
        label: "Client",
        shape: "lifeline",
        color: "violet",
        activations: [
          { y0: 60, y1: 140 },
          { y0: 200, y1: 260 },
        ],
        destroyY: 340,
      },
    };

    const pasted = instantiateFragment({ nodes: [lifeline], edges: [] }, D16);

    expect(pasted.nodes[0]!.data.activations).toEqual([
      { y0: 60, y1: 140 },
      { y0: 200, y1: 260 },
    ]);
    expect(pasted.nodes[0]!.data.destroyY).toBe(340);
  });

  it("T16: class box attributes, methods, and stereotypes come along", () => {
    const cls: DiagramNode = {
      ...makeNode({ id: "c1", shape: "class" }),
      data: {
        label: "Repo",
        shape: "class",
        color: "blue",
        stereotype: "interface",
        isAbstract: true,
        attributes: ["+ id: string"],
        methods: ["+ find(): Item"],
      },
    };

    const pasted = instantiateFragment({ nodes: [cls], edges: [] }, D16);

    expect(pasted.nodes[0]!.data.stereotype).toBe("interface");
    expect(pasted.nodes[0]!.data.isAbstract).toBe(true);
    expect(pasted.nodes[0]!.data.attributes).toEqual(["+ id: string"]);
    expect(pasted.nodes[0]!.data.methods).toEqual(["+ find(): Item"]);
  });

  it("T17: fragment kind and branch count come along", () => {
    const frag: DiagramNode = {
      ...makeNode({ id: "f1", shape: "fragment", width: 400, height: 300 }),
      data: { label: "retry", shape: "fragment", color: "gray", fragmentKind: "loop", branches: 3 },
    };

    const pasted = instantiateFragment({ nodes: [frag], edges: [] }, D16);

    expect(pasted.nodes[0]!.data.fragmentKind).toBe("loop");
    expect(pasted.nodes[0]!.data.branches).toBe(3);
  });

  it("T18: zIndex is preserved", () => {
    const node: DiagramNode = { ...makeNode({ id: "a" }), zIndex: 7 };

    const pasted = instantiateFragment({ nodes: [node], edges: [] }, D16);

    expect(pasted.nodes[0]!.zIndex).toBe(7);
  });

  it("T19: messages between lifelines of different heights stay horizontal", () => {
    // When heights differ, resnapMessages takes the source's absolute y as truth and
    // re-fits the target pct — saved values in real documents are asymmetric like this. Only carrying
    // the handles over as is and pushing both nodes by the same delta keeps the copy horizontal.
    const l1 = makeNode({ id: "l1", shape: "lifeline", x: 0, y: 0, height: 400 });
    const l2 = makeNode({ id: "l2", shape: "lifeline", x: 300, y: 40, height: 250 });
    const msg = makeEdge({
      id: "m1",
      source: "l1",
      target: "l2",
      sourceHandle: "right-25",
      targetHandle: "left-24",
    });
    const yOf = (edge: DiagramEdge, nodes: DiagramNode[], end: "source" | "target") =>
      handlePointOnNode(
        nodes.find((n) => n.id === edge[end])!,
        end === "source" ? edge.sourceHandle : edge.targetHandle,
      ).y;

    const before = yOf(msg, [l1, l2], "source") - yOf(msg, [l1, l2], "target");
    const pasted = instantiateFragment({ nodes: [l1, l2], edges: [msg] }, D16);
    const copy = pasted.edges[0]!;

    expect(isSequenceMessage(copy, pasted.nodes)).toBe(true);
    // a horizontal source gives a horizontal copy — the y gap between the two ends is preserved
    expect(yOf(copy, pasted.nodes, "source") - yOf(copy, pasted.nodes, "target")).toBe(before);
    expect(yOf(copy, pasted.nodes, "source")).toBe(yOf(msg, [l1, l2], "source") + 16);
  });

  it("T26: waypoints move by the same delta too (they are absolute coordinates)", () => {
    // waypoints do not follow nodes. Left as is, the copied edge would
    // route through the original spot across the canvas.
    const edge: DiagramEdge = {
      ...makeEdge({ id: "e1", source: "a", target: "b" }),
      data: {
        variant: "solid",
        arrow: true,
        waypoints: [
          { x: 100, y: 200 },
          { x: 150, y: 260 },
        ],
      },
    };
    const fragment = {
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      edges: [edge],
    };

    const pasted = instantiateFragment(fragment, D16);

    expect(pasted.edges[0]!.data?.waypoints).toEqual([
      { x: 116, y: 216 },
      { x: 166, y: 276 },
    ]);
  });

  it("does not create an empty array for edges without waypoints", () => {
    const fragment = {
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      edges: [makeEdge({ id: "e1", source: "a", target: "b" })],
    };

    const pasted = instantiateFragment(fragment, D16);

    expect(pasted.edges[0]!.data?.waypoints).toBeUndefined();
  });

  it("does not mutate the source fragment", () => {
    const fragment = { nodes: [makeNode({ id: "a", x: 100, y: 50 })], edges: [] };

    instantiateFragment(fragment, D16);

    expect(fragment.nodes[0]!.position).toEqual({ x: 100, y: 50 });
    expect(fragment.nodes[0]!.id).toBe("a");
  });
});

describe("Copy/paste regression cases", () => {
  it("a self loop's ends both point at the same copied node", () => {
    // source and target are the same id. Mapping only one side plugs the copy back into the source.
    const fragment = {
      nodes: [makeNode({ id: "a" })],
      edges: [
        makeEdge({
          id: "e1",
          source: "a",
          target: "a",
          sourceHandle: "right",
          targetHandle: "top",
        }),
      ],
    };

    const pasted = instantiateFragment(fragment, D16);

    const copyId = pasted.nodes[0]!.id;
    expect(pasted.edges[0]!.source).toBe(copyId);
    expect(pasted.edges[0]!.target).toBe(copyId);
    expect(pasted.edges[0]!.source).not.toBe("a");
  });

  it("multiple edges between the same two nodes each get a new id", () => {
    const fragment = {
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      edges: [
        makeEdge({ id: "e1", source: "a", target: "b" }),
        makeEdge({ id: "e2", source: "a", target: "b" }),
      ],
    };

    const pasted = instantiateFragment(fragment, D16);

    expect(new Set(pasted.edges.map((e) => e.id)).size).toBe(2);
    expect(pasted.edges.every((e) => e.source === pasted.nodes[0]!.id)).toBe(true);
  });

  it("fragment copies regain the click-through style", () => {
    // style is derived again from shape. Without it the frame covers its contents and swallows clicks.
    const frag: DiagramNode = {
      ...makeNode({ id: "f1", shape: "fragment", width: 400, height: 300 }),
      data: { label: "alt", shape: "fragment", color: "gray", fragmentKind: "alt" },
    };

    const pasted = instantiateFragment({ nodes: [frag], edges: [] }, D16);

    expect(pasted.nodes[0]!.style).toBeDefined();
  });

  it("found messages (anchor↔lifeline) stay messages", () => {
    const line = makeNode({ id: "l1", shape: "lifeline", x: 200, height: 400 });
    const point = makeNode({ id: "p1", shape: "anchor", x: 40, y: 120 });
    const found = sel(makeEdge({ id: "m1", source: "p1", target: "l1", targetHandle: "left-30" }));

    // lifelines are selected directly; anchors are pulled in by the selected message
    const fragment = collectFragment([sel(line), point], [found]);
    const pasted = instantiateFragment(fragment!, D16);

    expect(isSequenceMessage(pasted.edges[0]!, pasted.nodes)).toBe(true);
    expect(pasted.edges[0]!.targetHandle).toBe("left-30");
  });

  it("an empty fragment gives an empty result", () => {
    const pasted = instantiateFragment({ nodes: [], edges: [] }, D16);

    expect(pasted.nodes).toHaveLength(0);
    expect(pasted.edges).toHaveLength(0);
  });

  it("delta 0 creates in place (the caller decides the offset)", () => {
    const fragment = { nodes: [makeNode({ id: "a", x: 100, y: 50 })], edges: [] };

    const pasted = instantiateFragment(fragment, { dx: 0, dy: 0 });

    expect(pasted.nodes[0]!.position).toEqual({ x: 100, y: 50 });
    expect(pasted.nodes[0]!.id).not.toBe("a");
  });
});
