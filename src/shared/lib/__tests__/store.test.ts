import { beforeEach, describe, expect, it } from "vitest";

import { findSnapTarget, handlePointOnNode, nodeBounds } from "../edgeUtils";
import { useDiagramStore } from "../store";
import type { AgentOp, DiagramEdge, DiagramNode } from "../types";
import { UML_RELATION_STYLE, UML_RELATIONS } from "../classShape";
import { makeDoc, makeEdge, makeNode } from "./testFixtures";

const resetStore = () => {
  useDiagramStore.getState().loadDoc(makeDoc([], [], "Untitled Diagram"), null);
};

describe("useDiagramStore.applyOps", () => {
  beforeEach(resetStore);

  it("applies add_node/add_edge", () => {
    const result = useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "Start", x: 0, y: 0 } },
      {
        op: "add_node",
        node: { id: "b", label: "End", shape: "diamond", color: "amber", x: 200, y: 0 },
      },
      { op: "add_edge", edge: { source: "a", target: "b", label: "next" } },
    ]);
    expect(result.applied).toBe(3);
    expect(result.errors).toEqual([]);

    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.data.shape).toBe("diamond");
    expect(nodes[1]?.data.color).toBe("amber");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data?.label).toBe("next");
  });

  it("update_node changes position/data", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "Start", x: 0, y: 0 } },
      { op: "update_node", id: "a", set: { label: "Changed", x: 50, color: "rose" } },
    ]);
    const node = useDiagramStore.getState().nodes[0];
    expect(node?.data.label).toBe("Changed");
    expect(node?.data.color).toBe("rose");
    expect(node?.position).toEqual({ x: 50, y: 0 });
  });

  it("delete_node also deletes connected edges", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
      { op: "delete_node", id: "a" },
    ]);
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["b"]);
    expect(edges).toHaveLength(0);
  });

  it("puts invalid ops in errors and keeps applying the rest", () => {
    const result = useDiagramStore.getState().applyOps([
      { op: "add_edge", edge: { source: "ghost", target: "phantom" } },
      { op: "add_node", node: { id: "a", label: "Valid", x: 0, y: 0 } },
      { op: "delete_node", id: "ghost" },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors).toHaveLength(2);
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("rejects adding a node with a duplicate id", () => {
    const result = useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "1", x: 0, y: 0 } },
      { op: "add_node", node: { id: "a", label: "2", x: 100, y: 0 } },
    ]);
    expect(result.applied).toBe(1);
    expect(result.errors[0]).toContain("already exists");
  });

  it("set_diagram replaces and normalizes the whole document", () => {
    const doc = makeDoc([makeNode({ id: "x", label: "Replaced" })], [], "New Doc");
    useDiagramStore.getState().applyOps([{ op: "set_diagram", doc }]);
    const state = useDiagramStore.getState();
    expect(state.title).toBe("New Doc");
    expect(state.nodes[0]?.type).toBe("shape");
  });

  it("records changed elements in touched when fromAgent=true", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }], true);
    expect(useDiagramStore.getState().touched.a).toBeTypeOf("number");
  });
});

describe("edge handles and free arrows", () => {
  beforeEach(resetStore);

  it("add_edge pins handles by the nodes' relative position (left→right)", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 400, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
    ]);
    const edge = useDiagramStore.getState().edges[0]!;
    expect(edge.sourceHandle).toBe("right");
    expect(edge.targetHandle).toBe("left");
  });

  it("add_edge pins handles (top→bottom)", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 0, y: 400 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
    ]);
    const edge = useDiagramStore.getState().edges[0]!;
    expect(edge.sourceHandle).toBe("bottom");
    expect(edge.targetHandle).toBe("top");
  });

  it("can add/change an edge colour", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 400, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b", color: "rose" } },
      { op: "update_edge", id: "e1", set: { color: "teal" } },
    ]);
    expect(useDiagramStore.getState().edges[0]?.data?.color).toBe("teal");
  });

  it("addFreeArrow creates 2 anchors and 1 edge using center handles", () => {
    useDiagramStore.getState().addFreeArrow({ x: 100, y: 100 });
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.data.shape === "anchor")).toBe(true);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.sourceHandle).toBe("center");
    expect(edges[0]?.targetHandle).toBe("center");
  });

  it("deleting a free arrow's edge also cleans up the orphan anchors", () => {
    useDiagramStore.getState().addFreeArrow({ x: 0, y: 0 });
    const edgeId = useDiagramStore.getState().edges[0]!.id;
    useDiagramStore.getState().applyOps([{ op: "delete_edge", id: edgeId }]);
    const { nodes, edges } = useDiagramStore.getState();
    expect(edges).toHaveLength(0);
    expect(nodes).toHaveLength(0);
  });
});

describe("arrow editing operations", () => {
  beforeEach(resetStore);

  const twoNodes = () =>
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 400, y: 0 } },
      {
        op: "add_edge",
        edge: {
          id: "e1",
          source: "a",
          target: "b",
          label: "L",
          markerStart: "circle",
          markerEnd: "arrow",
          labelStart: "1",
          labelEnd: "N",
        },
      },
    ]);

  it("reverseEdge turns the line around — the arrowhead moves to the other end, end labels stay put (#204)", () => {
    twoNodes();
    useDiagramStore.getState().reverseEdge("e1");
    const edge = useDiagramStore.getState().edges[0]!;
    expect(edge.source).toBe("b");
    expect(edge.target).toBe("a");
    expect(edge.sourceHandle).toBe("left");
    expect(edge.targetHandle).toBe("right");
    // Markers keep their role (start/end) — the ends swapped, so the arrowhead is drawn on a's side
    expect(edge.data?.markerStart).toBe("circle");
    expect(edge.data?.markerEnd).toBe("arrow");
    expect(edge.data?.labelStart).toBe("N");
    expect(edge.data?.labelEnd).toBe("1");
  });

  it("legacy arrow:false is normalized to markerEnd none", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 400, y: 0 } },
      { op: "add_edge", edge: { id: "e1", source: "a", target: "b", arrow: false } },
    ]);
    expect(useDiagramStore.getState().edges[0]?.data?.markerEnd).toBe("none");
  });

  it("a style change is remembered as lastEdgeStyle and applied to new edges", () => {
    twoNodes();
    useDiagramStore
      .getState()
      .updateEdgeData("e1", { color: "rose", width: 2.5, variant: "dashed" });
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "c", label: "C", x: 0, y: 300 } }]);
    useDiagramStore.getState().onConnect({
      source: "b",
      target: "c",
      sourceHandle: null,
      targetHandle: null,
    });
    const edge = useDiagramStore.getState().edges.find((e) => e.source === "b" && e.target === "c");
    expect(edge?.data?.color).toBe("rose");
    expect(edge?.data?.width).toBe(2.5);
    expect(edge?.data?.variant).toBe("dashed");
  });

  it("reconnectEdge moves an endpoint to another node", () => {
    twoNodes();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "c", label: "C", x: 400, y: 300 } }]);
    useDiagramStore.getState().reconnectEdge("e1", { source: "a", target: "c" });
    const edge = useDiagramStore.getState().edges[0]!;
    expect(edge.target).toBe("c");
    expect(edge.targetHandle).toBeTruthy();
  });

  /**
   * Drop-split removed (#91): dropping a node onto an edge should just place it
   * there, with nothing else happening.
   *
   * **The first assertion below is the only regression guard** — it is the only line that
   * fails on the pre-removal code (running this file against the old store gives 1 failed /
   * 121 passed; deleting that line makes all 122 pass). The position assertions that follow
   * passed even before the removal: the split was called from `DiagramCanvas.onNodeDragStop`,
   * not from `onNodesChange`. So **putting a split directly inside that handler, without a store
   * action, would not be caught by this test** — covering that path needs a component test
   * harness that did not exist, so it was left out of this PR's scope.
   */
  it("does not split an edge when a node is moved onto it (#91)", () => {
    twoNodes();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "mid", label: "M", x: 600, y: 400 } }]);

    expect("trySplitEdgeWithNode" in useDiagramStore.getState()).toBe(false);

    // move it to the a→b edge's midpoint through the store path that changes node positions
    useDiagramStore
      .getState()
      .onNodesChange([
        { id: "mid", type: "position", position: { x: 200, y: 0 }, dragging: false },
      ]);
    const { nodes, edges } = useDiagramStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe("a");
    expect(edges[0]?.target).toBe("b");
    expect(nodes.find((n) => n.id === "mid")?.position).toEqual({ x: 200, y: 0 });
  });

  it("addAdjacentNode creates and connects a node of the same shape", () => {
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "a", label: "A", shape: "diamond", color: "amber", x: 0, y: 0 },
      },
    ]);
    const newId = useDiagramStore.getState().addAdjacentNode("a", "right");
    const { nodes, edges } = useDiagramStore.getState();
    const created = nodes.find((n) => n.id === newId);
    expect(created?.data.shape).toBe("diamond");
    expect(created?.data.color).toBe("amber");
    expect(edges[0]?.sourceHandle).toBe("right");
    expect(edges[0]?.targetHandle).toBe("left");
  });

  it("drawArrow: node→empty space creates an arrow from the node to an anchor", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 160, height: 56 } },
      ]);
    useDiagramStore.getState().drawArrow({ x: 80, y: 28 }, { x: 400, y: 200 });
    const { nodes, edges } = useDiagramStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe("a");
    const anchor = nodes.find((n) => n.data.shape === "anchor");
    expect(anchor).toBeTruthy();
    expect(edges[0]?.target).toBe(anchor!.id);
  });

  it("drawArrow: node→node connects the two nodes", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 160, height: 56 } },
      { op: "add_node", node: { id: "b", label: "B", x: 400, y: 0, width: 160, height: 56 } },
    ]);
    useDiagramStore.getState().drawArrow({ x: 80, y: 28 }, { x: 480, y: 28 });
    const { edges, nodes } = useDiagramStore.getState();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.source).toBe("a");
    expect(edges[0]?.target).toBe("b");
    expect(nodes.every((n) => n.data.shape !== "anchor")).toBe(true);
  });

  it("detachEndpointToAnchor: the endpoint detaches to an anchor and reconnects on a node drop", () => {
    twoNodes();
    const anchorId = useDiagramStore
      .getState()
      .detachEndpointToAnchor("e1", "target", { x: 600, y: 200 });
    expect(anchorId).toBeTruthy();
    let edge = useDiagramStore.getState().edges[0]!;
    expect(edge.target).toBe(anchorId);
    expect(edge.targetHandle).toBe("center");

    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "z", label: "Z", x: 580, y: 180, width: 160, height: 56 } },
      ]);
    useDiagramStore.getState().rewireAnchorToNode(anchorId!, "z");
    edge = useDiagramStore.getState().edges[0]!;
    expect(edge.target).toBe("z");
    expect(useDiagramStore.getState().nodes.some((n) => n.id === anchorId)).toBe(false);
  });

  it("findSnapTarget: finds the nearest main handle near a box", async () => {
    const { findSnapTarget } = await import("../edgeUtils");
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "a", label: "A", x: 100, y: 100, width: 160, height: 56 } },
      ]);
    const nodes = useDiagramStore.getState().nodes;
    // 20px outside the right side → right handle
    const nearRight = findSnapTarget(nodes, { x: 280, y: 128 });
    expect(nearRight).toMatchObject({ nodeId: "a", handle: "right" });
    expect(nearRight?.point).toEqual({ x: 260, y: 128 });
    // near the top side (inside the box) → top handle
    const nearTop = findSnapTarget(nodes, { x: 180, y: 105 });
    expect(nearTop?.handle).toBe("top");
    // out of range
    expect(findSnapTarget(nodes, { x: 500, y: 400 })).toBeNull();
    // exclusion list
    expect(findSnapTarget(nodes, { x: 280, y: 128 }, ["a"])).toBeNull();
  });

  it("rewireAnchorToNode: connects through the given handle", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 160, height: 56 } },
      ]);
    useDiagramStore.getState().drawArrow({ x: 80, y: 28 }, { x: 400, y: 28 });
    const anchor = useDiagramStore.getState().nodes.find((n) => n.data.shape === "anchor")!;
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "b", label: "B", x: 380, y: 0, width: 160, height: 56 } },
      ]);
    useDiagramStore.getState().rewireAnchorToNode(anchor.id, "b", "bottom");
    expect(useDiagramStore.getState().edges[0]?.targetHandle).toBe("bottom");
  });

  it("translateNodesLive: moves nodes without a commit", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    const before = useDiagramStore.getState().past.length;
    useDiagramStore.getState().translateNodesLive(["a"], 25, -10);
    const node = useDiagramStore.getState().nodes[0]!;
    expect(node.position).toEqual({ x: 25, y: -10 });
    expect(useDiagramStore.getState().past.length).toBe(before);
  });

  it("rewireAnchorToNode: the anchor is absorbed into the node and the edge is rewired", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0, width: 160, height: 56 } },
      ]);
    useDiagramStore.getState().drawArrow({ x: 80, y: 28 }, { x: 400, y: 28 });
    const anchor = useDiagramStore.getState().nodes.find((n) => n.data.shape === "anchor")!;
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "b", label: "B", x: 380, y: 0, width: 160, height: 56 } },
      ]);
    useDiagramStore.getState().rewireAnchorToNode(anchor.id, "b");
    const { nodes, edges } = useDiagramStore.getState();
    expect(edges[0]?.target).toBe("b");
    expect(nodes.some((n) => n.data.shape === "anchor")).toBe(false);
  });
});

describe("useDiagramStore undo/redo", () => {
  beforeEach(resetStore);

  it("undoes to the state before applyOps and redoes it", () => {
    const store = useDiagramStore.getState();
    store.applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    expect(useDiagramStore.getState().nodes).toHaveLength(1);

    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().nodes).toHaveLength(0);

    useDiagramStore.getState().redo();
    expect(useDiagramStore.getState().nodes).toHaveLength(1);
  });

  it("a new edit clears the redo history", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    useDiagramStore.getState().undo();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "b", label: "B", x: 0, y: 0 } }]);
    expect(useDiagramStore.getState().future).toHaveLength(0);
  });
});

describe("useDiagramStore.toDoc", () => {
  beforeEach(resetStore);

  it("returns a deep-copied document of the current state", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "set_title", title: "Doc" },
    ]);
    const doc = useDiagramStore.getState().toDoc();
    expect(doc.version).toBe(1);
    expect(doc.title).toBe("Doc");
    doc.nodes[0]!.data.label = "tampered";
    expect(useDiagramStore.getState().nodes[0]?.data.label).toBe("A");
  });
});

describe("useDiagramStore.loadDoc — React Flow measurement cache", () => {
  beforeEach(resetStore);

  it("toDoc does not write measured or dragging — they are live UI state, not the document (#81)", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    // what React Flow's dimension / position changes would have written
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, measured: { width: 160, height: 56 }, dragging: false })),
    }));
    const doc = useDiagramStore.getState().toDoc();
    expect("measured" in doc.nodes[0]!).toBe(false);
    expect("dragging" in doc.nodes[0]!).toBe(false);
    expect(doc.nodes[0]!.width).toBeDefined();
    // the live node keeps its cache — only the document is clean
    expect(useDiagramStore.getState().nodes[0]!.measured).toEqual({ width: 160, height: 56 });
  });

  it("drops measured carried in by a file — loaded nodes wait for a real measurement (#81)", () => {
    const stale = { ...makeNode({ id: "a" }), measured: { width: 10, height: 10 } };
    useDiagramStore.getState().loadDoc(makeDoc([stale], []), null);
    const loaded = useDiagramStore.getState().nodes[0]!;
    expect(loaded.measured).toBeUndefined();
    // the declared size still comes through — only the DOM cache is dropped
    expect(loaded.width).toBe(stale.width);
    expect(loaded.height).toBe(stale.height);
  });
});

describe("revealRequest — viewport request after a document swap (#81, #117)", () => {
  beforeEach(() => {
    resetStore();
    useDiagramStore.setState({ revealRequest: null });
  });
  const mode = () => useDiagramStore.getState().revealRequest?.mode ?? null;

  it("loadDoc: fit when there are nodes, origin otherwise", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    expect(mode()).toBe("fit");
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    expect(mode()).toBe("origin");
  });

  it("loadDoc: a document emptied because it held only orphan anchors gets origin — judged by the result, not the file", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "p", shape: "anchor" })], []), null);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
    expect(mode()).toBe("origin");
  });

  it("set_diagram: fit when there are nodes, origin for an empty document", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "set_diagram", doc: makeDoc([makeNode({ id: "a" })], []) }]);
    expect(mode()).toBe("fit");
    useDiagramStore.getState().applyOps([{ op: "set_diagram", doc: makeDoc([], []) }]);
    expect(mode()).toBe("origin");
  });

  it("clear + add_node in one batch gives fit — judged by the document after the batch", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "clear" },
        { op: "add_node", node: { id: "a", label: "A", x: 2000, y: 1500 } },
      ]);
    expect(mode()).toBe("fit");
  });

  it("set_diagram + clear in one batch gives origin", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "set_diagram", doc: makeDoc([makeNode({ id: "a" })], []) },
        { op: "clear" },
      ]);
    expect(mode()).toBe("origin");
  });

  it("set_diagram using a fragment as an edge endpoint is rejected and makes no request", () => {
    const frame = makeNode({ id: "f", shape: "fragment" });
    useDiagramStore.getState().applyOps([
      {
        op: "set_diagram",
        doc: makeDoc(
          [frame, makeNode({ id: "a" })],
          [makeEdge({ id: "e", source: "f", target: "a" })],
        ),
      },
    ]);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
    expect(mode()).toBeNull();
  });

  it("clear: origin", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    useDiagramStore.setState({ revealRequest: null });
    useDiagramStore.getState().applyOps([{ op: "clear" }]);
    expect(mode()).toBe("origin");
  });

  it("partial edit ops make no request", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    expect(mode()).toBeNull();
  });

  it("within one batch the last replacement wins — set_diagram after clear gives fit", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "clear" },
        { op: "set_diagram", doc: makeDoc([makeNode({ id: "a" })], []) },
      ]);
    expect(mode()).toBe("fit");
  });

  it("a rejected set_diagram makes no request", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "set_diagram", doc: { nodes: [{ bad: true }], edges: [] } } as never]);
    expect(mode()).toBeNull();
  });

  it("consumeReveal clears only its own key — a newer request made meanwhile stays", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "a" })], []), null);
    const first = useDiagramStore.getState().revealRequest!;
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    const second = useDiagramStore.getState().revealRequest!;
    expect(second.key).not.toBe(first.key);
    useDiagramStore.getState().consumeReveal(first.key);
    expect(useDiagramStore.getState().revealRequest).toEqual(second);
    useDiagramStore.getState().consumeReveal(second.key);
    expect(useDiagramStore.getState().revealRequest).toBeNull();
  });
});

describe("icon shape ops (#9)", () => {
  beforeEach(resetStore);
  const apply = (ops: Parameters<ReturnType<typeof useDiagramStore.getState>["applyOps"]>[0]) =>
    useDiagramStore.getState().applyOps(ops);

  it("add_node shape icon + icon id → the node carries the icon at a default size of 96×96", () => {
    const r = apply([
      {
        op: "add_node",
        node: { id: "db", label: "Orders DB", shape: "icon", icon: "database", x: 0, y: 0 },
      },
    ]);
    expect(r.errors).toEqual([]);
    const n = useDiagramStore.getState().nodes[0]!;
    expect(n.data).toMatchObject({ shape: "icon", icon: "database" });
    expect([n.width, n.height]).toEqual([96, 96]);
  });

  it("shape icon without icon → the default glyph", () => {
    apply([{ op: "add_node", node: { id: "s", label: "S", shape: "icon", x: 0, y: 0 } }]);
    expect(useDiagramStore.getState().nodes[0]!.data.icon).toBe("server");
  });

  it("an unknown icon id is rejected along with the allowed list", () => {
    const r = apply([
      {
        op: "add_node",
        node: { id: "x", label: "X", shape: "icon", icon: "aws-s3", x: 0, y: 0 },
      } as never,
    ]);
    expect(r.errors[0]).toMatch(/icon must be one of .*database.*internet/);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("icon on a non-box shape is rejected — the field would silently vanish on reload", () => {
    const r = apply([
      {
        op: "add_node",
        node: { id: "x", label: "X", shape: "class", icon: "database", x: 0, y: 0 },
      },
    ]);
    expect(r.errors[0]).toContain('icon is only valid with shape "icon" or a box shape');
    // a box takes it as a decoration since #160
    const ok = apply([
      {
        op: "add_node",
        node: { id: "y", label: "Y", shape: "rounded", icon: "database", x: 0, y: 0 },
      },
    ]);
    expect(ok.errors).toEqual([]);
  });

  it("update_node set.icon changes the glyph; boxes take it too, compartment shapes reject it", () => {
    apply([
      {
        op: "add_node",
        node: { id: "db", label: "DB", shape: "icon", icon: "database", x: 0, y: 0 },
      },
      { op: "add_node", node: { id: "box", label: "Box", x: 200, y: 0 } },
    ]);
    expect(apply([{ op: "update_node", id: "db", set: { icon: "cache" } }]).errors).toEqual([]);
    expect(useDiagramStore.getState().nodes[0]!.data.icon).toBe("cache");
    expect(apply([{ op: "update_node", id: "box", set: { icon: "cache" } }]).errors).toEqual([]);
    expect(useDiagramStore.getState().nodes[1]!.data.icon).toBe("cache");
    apply([{ op: "add_node", node: { id: "cls", label: "C", shape: "class", x: 400, y: 0 } }]);
    const r = apply([{ op: "update_node", id: "cls", set: { icon: "cache" } }]);
    expect(r.errors[0]).toContain('only valid on shape "icon" nodes and box shapes');
  });

  it("changing shape to icon gives the default glyph; changing icon to a box keeps the glyph as the box's icon (#160)", () => {
    apply([{ op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } }]);
    apply([{ op: "update_node", id: "a", set: { shape: "icon" } }]);
    let n = useDiagramStore.getState().nodes[0]!;
    expect(n.data.icon).toBe("server");
    // the icon footprint, not the rounded box's 160×56 — same as the inspector
    expect([n.width, n.height]).toEqual([96, 96]);
    apply([{ op: "update_node", id: "a", set: { shape: "rect" } }]);
    n = useDiagramStore.getState().nodes[0]!;
    expect(n.data.icon).toBe("server");
    expect([n.width, n.height]).toEqual([160, 56]);
    // icon → class also starts from the class default, on both paths
    apply([{ op: "update_node", id: "a", set: { shape: "icon" } }]);
    useDiagramStore.getState().updateNodeData("a", { shape: "class" });
    expect(useDiagramStore.getState().nodes[0]!.width).toBe(200);
    apply([{ op: "update_node", id: "a", set: { shape: "icon" } }]);
    apply([{ op: "update_node", id: "a", set: { shape: "class" } }]);
    expect(useDiagramStore.getState().nodes[0]!.width).toBe(200);
    apply([{ op: "update_node", id: "a", set: { shape: "rounded" } }]);
    // an explicit size in the same op still wins
    apply([{ op: "update_node", id: "a", set: { shape: "icon", width: 120 } }]);
    expect(useDiagramStore.getState().nodes[0]!.width).toBe(120);
  });

  it("a node made with + next to an icon node carries the glyph too", () => {
    apply([
      {
        op: "add_node",
        node: { id: "db", label: "DB", shape: "icon", icon: "database", x: 0, y: 0 },
      },
    ]);
    const id = useDiagramStore.getState().addAdjacentNode("db", "right");
    const made = useDiagramStore.getState().nodes.find((n) => n.id === id)!;
    expect(made.data).toMatchObject({ shape: "icon", icon: "database" });
  });

  it("set_diagram and file load: an icon node without icon gets the default glyph, an unknown id is kept", () => {
    const doc = makeDoc(
      [
        {
          ...makeNode({ id: "a", shape: "icon" }),
          data: { ...makeNode({ id: "a", shape: "icon" }).data },
        },
        {
          ...makeNode({ id: "b", shape: "icon" }),
          data: { ...makeNode({ id: "b", shape: "icon" }).data, icon: "future-icon" },
        },
      ],
      [],
    );
    useDiagramStore.getState().loadDoc(doc, null);
    const [a, b] = useDiagramStore.getState().nodes;
    expect(a!.data.icon).toBe("server");
    expect(b!.data.icon).toBe("future-icon");
    // and it survives a round trip through the document
    expect(useDiagramStore.getState().toDoc().nodes[1]!.data.icon).toBe("future-icon");
  });
});

describe("useDiagramStore.openProject — library binding (#114)", () => {
  beforeEach(resetStore);

  it("opening a project sets projectId, nulls filePath, and follows the docVersion/revealRequest contract", () => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), "/tmp/ext.dosik.json");
    const before = useDiagramStore.getState().docVersion;
    useDiagramStore.setState({ revealRequest: null });

    useDiagramStore.getState().openProject("p1", makeDoc([makeNode({ id: "a" })], []));

    const s = useDiagramStore.getState();
    expect(s.projectId).toBe("p1");
    expect(s.filePath).toBeNull();
    expect(s.docVersion).toBe(before + 1);
    expect(s.revealRequest?.mode).toBe("fit");
    expect(s.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("opening an external file clears projectId — the two are exclusive", () => {
    useDiagramStore.getState().openProject("p1", makeDoc([], []));
    useDiagramStore.getState().loadDoc(makeDoc([], []), "/tmp/ext.dosik.json");
    expect(useDiagramStore.getState().projectId).toBeNull();
    expect(useDiagramStore.getState().filePath).toBe("/tmp/ext.dosik.json");
  });

  it("openProject with a broken document throws and the previous binding stays", () => {
    useDiagramStore.getState().openProject("p1", makeDoc([], []));
    expect(() =>
      useDiagramStore.getState().openProject("p2", { nodes: [{ bad: true }], edges: [] } as never),
    ).toThrow();
    expect(useDiagramStore.getState().projectId).toBe("p1");
  });
});

describe("edge fixture consistency", () => {
  it("makeEdge creates the labeled type", () => {
    expect(makeEdge({ id: "e", source: "a", target: "b" }).type).toBe("labeled");
  });
});

describe("sequence messages (lifelines)", () => {
  beforeEach(resetStore);

  const addLifelines = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", shape: "lifeline", x: 300, y: 0 } },
    ]);
  };
  const nodeById = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!;
  const endpointYs = (edge: DiagramEdge) => {
    const sp = handlePointOnNode(nodeById(edge.source), edge.sourceHandle);
    const tp = handlePointOnNode(nodeById(edge.target), edge.targetHandle);
    return [sp.y, tp.y] as const;
  };

  it("drawArrow: a stroke between lifelines becomes a horizontal straight message at the starting y", () => {
    addLifelines();
    useDiagramStore.getState().drawArrow({ x: 60, y: 200 }, { x: 360, y: 260 });
    const edge = useDiagramStore.getState().edges[0]!;
    expect(edge.sourceHandle).toMatch(/^right-/);
    expect(edge.targetHandle).toMatch(/^left-/);
    expect(edge.data?.pathStyle).toBe("straight");
    const [sy, ty] = endpointYs(edge);
    expect(sy).toBeCloseTo(200, 1);
    expect(ty).toBeCloseTo(200, 1);
  });

  it("drawArrow: a vertical stroke on one lifeline becomes a self-message", () => {
    addLifelines();
    useDiagramStore.getState().drawArrow({ x: 60, y: 150 }, { x: 70, y: 210 });
    const edge = useDiagramStore.getState().edges[0]!;
    expect(edge.source).toBe("a");
    expect(edge.target).toBe("a");
    expect(edge.sourceHandle).toMatch(/^right-/);
    expect(edge.targetHandle).toMatch(/^right-/);
    const [sy, ty] = endpointYs(edge);
    expect(sy).toBeCloseTo(150, 1);
    expect(ty).toBeCloseTo(210, 1);
  });

  it("setMessageYLive: moves only y while staying horizontal", () => {
    addLifelines();
    useDiagramStore.getState().drawArrow({ x: 60, y: 200 }, { x: 360, y: 200 });
    const id = useDiagramStore.getState().edges[0]!.id;
    useDiagramStore.getState().setMessageYLive(id, 120);
    const edge = useDiagramStore.getState().edges[0]!;
    const [sy, ty] = endpointYs(edge);
    expect(sy).toBeCloseTo(120, 1);
    expect(ty).toBeCloseTo(120, 1);
  });

  it("resnapMessages: messages return to horizontal after a lifeline moves vertically", () => {
    addLifelines();
    useDiagramStore.getState().drawArrow({ x: 60, y: 200 }, { x: 360, y: 200 });
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "b", set: { y: 100 } }]);
    useDiagramStore.getState().resnapMessages(["b"]);
    const edge = useDiagramStore.getState().edges[0]!;
    const [sy, ty] = endpointYs(edge);
    expect(sy).toBeCloseTo(ty, 1);
    expect(sy).toBeCloseTo(200, 1); // the source side's y is the reference
  });

  it("add_message: creates a horizontal straight message and clamps y to the line's range", () => {
    addLifelines();
    const result = useDiagramStore.getState().applyOps([
      { op: "add_message", message: { id: "m1", from: "a", to: "b", y: 200, label: "req()" } },
      { op: "add_message", message: { id: "m2", from: "b", to: "a", y: 240, variant: "dashed" } },
      { op: "add_message", message: { id: "m3", from: "a", to: "a", y: 280 } },
      { op: "add_message", message: { id: "m4", from: "a", to: "b", y: 10 } }, // above the header → clamp
    ]);
    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(4);
    const { edges } = useDiagramStore.getState();
    const m1 = edges.find((e) => e.id === "m1")!;
    expect(m1.data?.label).toBe("req()");
    expect(m1.data?.pathStyle).toBe("straight");
    const [sy, ty] = endpointYs(m1);
    expect(sy).toBeCloseTo(200, 1);
    expect(ty).toBeCloseTo(200, 1);
    const m2 = edges.find((e) => e.id === "m2")!;
    expect(m2.data?.variant).toBe("dashed");
    expect(m2.sourceHandle).toMatch(/^left-/); // b→a leaves to the left
    const m3 = edges.find((e) => e.id === "m3")!;
    expect(m3.source).toBe("a");
    expect(m3.target).toBe("a");
    const [sy4] = endpointYs(edges.find((e) => e.id === "m4")!);
    expect(sy4).toBeCloseTo(40, 1); // LIFELINE_HEADER_H
  });

  it("add_activation: accumulates activation bars in the lifeline's data", () => {
    addLifelines();
    const result = useDiagramStore.getState().applyOps([
      { op: "add_activation", lifeline: "a", y0: 100, y1: 180 },
      { op: "add_activation", lifeline: "a", y0: 220, y1: 260 },
    ]);
    expect(result.errors).toEqual([]);
    expect(nodeById("a").data.activations).toEqual([
      { y0: 100, y1: 180 },
      { y0: 220, y1: 260 },
    ]);
  });

  it("update_node.activations: replaces the whole array", () => {
    addLifelines();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_activation", lifeline: "a", y0: 100, y1: 180 }]);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "a", set: { activations: [{ y0: 50, y1: 90 }] } }]);
    expect(result.applied).toBe(1);
    expect(nodeById("a").data.activations).toEqual([{ y0: 50, y1: 90 }]);
  });

  it("messages stay horizontal when update_node moves a lifeline (bridge-path resnap)", () => {
    addLifelines();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "m", from: "a", to: "b", y: 200 } }]);
    for (const set of [{ y: 120 }, { height: 600 }, { y: 0, height: 200 }]) {
      useDiagramStore.getState().applyOps([{ op: "update_node", id: "b", set }]);
      const [sy, ty] = endpointYs(useDiagramStore.getState().edges[0]!);
      expect(ty).toBeCloseTo(sy, 1);
    }
  });

  it("set_diagram/loadDoc restore slanted messages to horizontal", () => {
    const lifeline = (id: string, x: number, y: number) => ({
      id,
      type: "shape" as const,
      position: { x, y },
      width: 120,
      height: 360,
      data: { label: id, shape: "lifeline" as const, color: "violet" as const },
    });
    // a hand-written document: the two ends have different pcts, so it is slanted
    const doc = {
      version: 1 as const,
      title: "t",
      nodes: [lifeline("a", 0, 0), lifeline("b", 300, 0)],
      edges: [
        {
          id: "m",
          type: "labeled" as const,
          source: "a",
          target: "b",
          sourceHandle: "right-30",
          targetHandle: "left-80",
          data: { variant: "solid" as const, arrow: true },
        },
      ],
    };
    useDiagramStore.getState().applyOps([{ op: "set_diagram", doc }]);
    const [sy1, ty1] = endpointYs(useDiagramStore.getState().edges[0]!);
    expect(ty1).toBeCloseTo(sy1, 1);

    useDiagramStore.getState().loadDoc(doc, null);
    const [sy2, ty2] = endpointYs(useDiagramStore.getState().edges[0]!);
    expect(ty2).toBeCloseTo(sy2, 1);

    // reloading an already horizontal document does not shift y (idempotent)
    const saved = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(saved, null);
    const [sy3] = endpointYs(useDiagramStore.getState().edges[0]!);
    expect(sy3).toBeCloseTo(sy2, 3);
  });

  it("add_message: a self-message near the bottom of the line still gets its loop height", () => {
    addLifelines(); // height 360 → line range 40..360
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "s1", from: "a", to: "a", y: 355 } }]);
    expect(result.errors).toEqual([]);
    const [sy, ty] = endpointYs(useDiagramStore.getState().edges[0]!);
    // it must exceed selfLoopPath's rectangular-branch threshold (8px) to avoid a spike
    expect(ty - sy).toBeGreaterThanOrEqual(8);
    expect(ty).toBeLessThanOrEqual(360);
  });

  it("add_message: rejects a self-message on a lifeline whose line is shorter than the loop height", () => {
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "tiny", label: "T", shape: "lifeline", x: 0, y: 0, height: 50 },
      },
    ]);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: "tiny", to: "tiny", y: 45 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toMatch(/too short for a self-message/);
  });
});

describe("found/lost messages (anchor ↔ lifeline)", () => {
  beforeEach(resetStore);

  const addLifeline = (id: string, x: number, y = 0) =>
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id, label: id, shape: "lifeline", x, y } }]);

  const anchorOf = () => useDiagramStore.getState().nodes.find((n) => n.data.shape === "anchor");

  it("add_message: a point as from creates an anchor and a found message", () => {
    addLifeline("a", 300);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    expect(result.errors).toEqual([]);
    expect(result.applied).toBe(1);
    const anchor = anchorOf();
    expect(anchor).toBeDefined();
    // point center (40, 174), anchor 12x12 → position (34, 168)
    expect(anchor?.position).toEqual({ x: 34, y: 168 });
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.source).toBe(anchor?.id);
    expect(edge?.sourceHandle).toBe("center");
    expect(edge?.target).toBe("a");
    // y=174 on the lifeline (120x360, y0) → 48.33%
    expect(edge?.targetHandle).toBe("left-48.33");
    expect(edge?.data?.pathStyle).toBe("straight");
    expect(edge?.data?.markerEnd).toBe("arrow");
  });

  it("add_message: a point as to creates a lost message", () => {
    addLifeline("a", 0);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "l", from: "a", to: { x: 600 }, y: 200 } }]);
    expect(result.errors).toEqual([]);
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.source).toBe("a");
    expect(edge?.sourceHandle).toBe("right-55.56");
    expect(edge?.target).toBe(anchorOf()?.id);
    expect(edge?.targetHandle).toBe("center");
  });

  it("add_message: rejects points for both from and to, leaving no anchor", () => {
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: { x: 0 }, to: { x: 100 }, y: 50 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("add_message: rejects a point whose x is not finite", () => {
    addLifeline("a", 0);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: { x: Number.NaN }, to: "a", y: 100 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(anchorOf()).toBeUndefined();
  });

  it("add_message: rejects a point plus a missing lifeline id", () => {
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: { x: 0 }, to: "ghost", y: 100 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(useDiagramStore.getState().nodes).toHaveLength(0);
  });

  it("add_message: the point form also clamps y to the line's range", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 10 } }]);
    const edge = useDiagramStore.getState().edges[0];
    // above the header (40) → clamped to 40 → 11.11%
    expect(edge?.targetHandle).toBe("left-11.11");
    expect(anchorOf()?.position.y).toBe(34);
  });

  it("moving the lifeline makes the handle follow the anchor's y, staying horizontal", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { y: -100 } }]);
    const edge = useDiagramStore.getState().edges[0];
    // anchor y 174 → relative to the node (174 - (-100)) / 360 = 76.11%
    expect(edge?.targetHandle).toBe("left-76.11");
  });

  it("resnapMessages restores horizontal after the anchor moves", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    const anchor = anchorOf();
    if (!anchor) throw new Error("anchor missing");
    useDiagramStore.getState().applyOps([{ op: "update_node", id: anchor.id, set: { y: 244 } }]);
    useDiagramStore.getState().resnapMessages([anchor.id]);
    const edge = useDiagramStore.getState().edges[0];
    // anchor center y 250 → 69.44%
    expect(edge?.targetHandle).toBe("left-69.44");
  });

  it("setMessageYLive: a mixed message moves the anchor and the handle together", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    useDiagramStore.getState().setMessageYLive("f", 250);
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.targetHandle).toBe("left-69.44");
    expect(anchorOf()?.position).toEqual({ x: 34, y: 244 });
  });

  it("add_message: rejects a point plus a non-lifeline node id", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "box", label: "B", x: 0, y: 0 } }]);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: { x: 0 }, to: "box", y: 100 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(anchorOf()).toBeUndefined();
  });

  it("add_message: the point form also rejects a duplicate id", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "dup", from: { x: 40 }, to: "a", y: 174 } }]);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "dup", from: { x: 40 }, to: "a", y: 200 } }]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(useDiagramStore.getState().edges).toHaveLength(1);
  });

  it("add_message: the point form also rejects an invalid style", () => {
    addLifeline("a", 300);
    const result = useDiagramStore.getState().applyOps([
      {
        op: "add_message",
        // @ts-expect-error runtime validation must catch an invalid variant
        message: { from: { x: 40 }, to: "a", y: 174, variant: "zigzag" },
      },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(anchorOf()).toBeUndefined();
  });

  it("setMessageYLive: clamps a y outside the line's range", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    useDiagramStore.getState().setMessageYLive("f", 9999);
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.targetHandle).toBe("left-100");
    expect(anchorOf()?.position.y).toBe(354);
  });

  it("a free arrow between an anchor and a lifeline on a plain handle is not resnapped", () => {
    addLifeline("a", 300);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "p", label: "", shape: "anchor", x: 34, y: 94 } },
      { op: "add_edge", edge: { id: "free", source: "p", target: "a" } },
    ]);
    const before = useDiagramStore.getState().edges.find((e) => e.id === "free");
    useDiagramStore.getState().resnapMessages(["p", "a"]);
    const after = useDiagramStore.getState().edges.find((e) => e.id === "free");
    expect(after?.sourceHandle).toBe(before?.sourceHandle);
    expect(after?.targetHandle).toBe(before?.targetHandle);
  });

  it("add_message: the point form rejects a non-finite y", () => {
    addLifeline("a", 300);
    const result = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: { x: 40 }, to: "a", y: Number.NaN } }]);
    expect(result.applied).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(anchorOf()).toBeUndefined();
  });

  it("stays horizontal when a bridge update_node moves the anchor", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    const anchor = anchorOf();
    if (!anchor) throw new Error("anchor missing");
    useDiagramStore.getState().applyOps([{ op: "update_node", id: anchor.id, set: { y: 244 } }]);
    // update_node resnaps without a manual resnap (the same rule as a canvas drag)
    expect(useDiagramStore.getState().edges[0]?.targetHandle).toBe("left-69.44");
  });

  it("moving the anchor's x through a bridge update_node updates the side", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    const anchor = anchorOf();
    if (!anchor) throw new Error("anchor missing");
    // past the lifeline's center (x 360) to the right — flips left → right
    useDiagramStore.getState().applyOps([{ op: "update_node", id: anchor.id, set: { x: 694 } }]);
    expect(useDiagramStore.getState().edges[0]?.targetHandle).toBe("right-48.33");
  });

  it("add_message: an object without x is taken as a point and gets the point error", () => {
    addLifeline("a", 300);
    const result = useDiagramStore.getState().applyOps([
      // @ts-expect-error runtime validation must catch an invalid point form
      { op: "add_message", message: { from: {}, to: "a", y: 174 } },
    ]);
    expect(result.applied).toBe(0);
    expect(result.errors[0]).toContain("point must have a finite x");
  });

  it("deleting a mixed message cleans up the orphan anchor", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    useDiagramStore.getState().applyOps([{ op: "delete_edge", id: "f" }]);
    expect(anchorOf()).toBeUndefined();
  });

  it("rewireAnchorToNode: a lifeline pct snap normalizes to a straight message and makes it horizontal", () => {
    addLifeline("a", 300);
    useDiagramStore.getState().addFreeArrowBetween({ x: 40, y: 100 }, { x: 200, y: 150 });
    const store = useDiagramStore.getState();
    const arrowEdge = store.edges[0];
    if (!arrowEdge) throw new Error("edge missing");
    const endAnchor = store.nodes.find((n) => n.id === arrowEdge.target);
    if (!endAnchor) throw new Error("end anchor missing");
    store.rewireAnchorToNode(endAnchor.id, "a", "left-41.67");
    const edge = useDiagramStore.getState().edges[0];
    expect(edge?.target).toBe("a");
    expect(edge?.data?.pathStyle).toBe("straight");
    // the remaining anchor's center y 100 → resnapped horizontal at 27.78%
    expect(edge?.targetHandle).toBe("left-27.78");
  });

  it("mixed message behaviour survives a round trip", () => {
    addLifeline("a", 300);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "f", from: { x: 40 }, to: "a", y: 174 } }]);
    const doc = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(doc, null);
    useDiagramStore.getState().setMessageYLive("f", 250);
    expect(useDiagramStore.getState().edges[0]?.targetHandle).toBe("left-69.44");
  });
});

describe("setActivationLive (activation bar drag)", () => {
  beforeEach(resetStore);

  const seed = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_activation", lifeline: "a", y0: 100, y1: 180 },
      { op: "add_activation", lifeline: "a", y0: 220, y1: 260 },
    ]);
  };
  const bars = () => useDiagramStore.getState().nodes[0]?.data.activations;

  it("updates y0/y1 at the given index", () => {
    seed();
    useDiagramStore.getState().setActivationLive("a", 0, 120, 200);
    expect(bars()).toEqual([
      { y0: 120, y1: 200 },
      { y0: 220, y1: 260 },
    ]);
  });

  it("clamps above the header and below the bottom", () => {
    seed();
    // lifeline default 120x360, header 40
    useDiagramStore.getState().setActivationLive("a", 0, 10, 9999);
    expect(bars()?.[0]).toEqual({ y0: 40, y1: 360 });
  });

  it("cannot be narrowed below the minimum height (8px)", () => {
    seed();
    useDiagramStore.getState().setActivationLive("a", 0, 100, 103);
    expect(bars()?.[0]).toEqual({ y0: 100, y1: 108 });
  });

  it("a missing node or index, or a non-lifeline, is a no-op", () => {
    seed();
    const before = bars();
    useDiagramStore.getState().setActivationLive("ghost", 0, 0, 50);
    useDiagramStore.getState().setActivationLive("a", 9, 0, 50);
    expect(bars()).toEqual(before);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "box", label: "B", x: 300, y: 0 } }]);
    useDiagramStore.getState().setActivationLive("box", 0, 0, 50);
    expect(useDiagramStore.getState().nodes[1]?.data.activations).toBeUndefined();
  });

  it("ignores non-finite numbers (keeps the sanitize invariant)", () => {
    seed();
    const before = bars();
    useDiagramStore.getState().setActivationLive("a", 0, Number.NaN, 200);
    useDiagramStore.getState().setActivationLive("a", 0, 120, Number.POSITIVE_INFINITY);
    expect(bars()).toEqual(before);
  });

  it("is live, so it makes no history commit", () => {
    seed();
    const depth = useDiagramStore.getState().past.length;
    useDiagramStore.getState().setActivationLive("a", 0, 120, 200);
    expect(useDiagramStore.getState().past.length).toBe(depth);
  });
});

describe("alignLifelines", () => {
  beforeEach(resetStore);

  const seed3 = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", shape: "lifeline", x: 0, y: 100 } },
      { op: "add_node", node: { id: "b", label: "B", shape: "lifeline", x: 100, y: 40 } },
      { op: "add_node", node: { id: "c", label: "C", shape: "lifeline", x: 600, y: 220 } },
    ]);
  };
  const nodeById = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id);

  it("tops: aligns to the topmost y in one undo frame", () => {
    seed3();
    const before = useDiagramStore.getState().past.length;
    useDiagramStore.getState().alignLifelines(["a", "b", "c"], "tops");
    expect(nodeById("a")?.position.y).toBe(40);
    expect(nodeById("c")?.position.y).toBe(40);
    expect(useDiagramStore.getState().past.length).toBe(before + 1);
    useDiagramStore.getState().undo();
    expect(nodeById("a")?.position.y).toBe(100);
  });

  it("distribute: both ends stay, the ones between are evenly spaced", () => {
    seed3();
    useDiagramStore.getState().alignLifelines(["a", "b", "c"], "distribute");
    expect(nodeById("a")?.position.x).toBe(0);
    expect(nodeById("c")?.position.x).toBe(600);
    expect(nodeById("b")?.position.x).toBe(300);
  });

  it("ignores ids that are not lifelines", () => {
    seed3();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "box", label: "X", x: 900, y: 900 } }]);
    useDiagramStore.getState().alignLifelines(["a", "b", "c", "box"], "tops");
    expect(nodeById("box")?.position.y).toBe(900);
  });

  it("makes no history frame when nothing would change", () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", shape: "lifeline", x: 0, y: 40 } },
      { op: "add_node", node: { id: "b", label: "B", shape: "lifeline", x: 300, y: 40 } },
    ]);
    const before = useDiagramStore.getState().past.length;
    useDiagramStore.getState().alignLifelines(["a", "b"], "tops");
    expect(useDiagramStore.getState().past.length).toBe(before);
  });

  it("messages stay horizontal after aligning", () => {
    seed3();
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "m", from: "a", to: "c", y: 240 } }]);
    useDiagramStore.getState().alignLifelines(["a", "b", "c"], "tops");
    const edge = useDiagramStore.getState().edges[0];
    const a = nodeById("a");
    const c = nodeById("c");
    if (!edge || !a || !c) throw new Error("missing");
    const sy = handlePointOnNode(a, edge.sourceHandle).y;
    const ty = handlePointOnNode(c, edge.targetHandle).y;
    expect(Math.abs(sy - ty)).toBeLessThan(0.01);
  });
});

describe("setNodeZ (bring to front / send to back)", () => {
  beforeEach(resetStore);

  const seed = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 200, y: 0 } },
      { op: "add_node", node: { id: "f", label: "F", shape: "fragment", x: 0, y: 0 } },
    ]);
  };
  const z = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)?.zIndex;

  it("front raises above the current maximum", () => {
    seed();
    useDiagramStore.getState().setNodeZ(["f"], "front");
    expect(z("f")).toBeGreaterThan(z("a") ?? 0);
    expect(z("f")).toBeGreaterThan(z("b") ?? 0);
  });

  it("back lowers below the current minimum", () => {
    seed();
    useDiagramStore.getState().setNodeZ(["a"], "back");
    // below even the fragment default z (-1)
    expect(z("a")).toBeLessThan(z("f") ?? 0);
  });

  it("raising several at once keeps their relative order", () => {
    seed();
    useDiagramStore.getState().setNodeZ(["a"], "front");
    useDiagramStore.getState().setNodeZ(["b"], "front");
    const before = [z("a"), z("b")];
    useDiagramStore.getState().setNodeZ(["a", "b"], "front");
    expect((z("b") ?? 0) - (z("a") ?? 0)).toBe((before[1] ?? 0) - (before[0] ?? 0));
  });

  it("one undo frame, no commit for an empty list", () => {
    seed();
    const depth = useDiagramStore.getState().past.length;
    useDiagramStore.getState().setNodeZ([], "front");
    expect(useDiagramStore.getState().past.length).toBe(depth);
    useDiagramStore.getState().setNodeZ(["f"], "front");
    expect(useDiagramStore.getState().past.length).toBe(depth + 1);
    useDiagramStore.getState().undo();
    expect(z("f")).toBe(-1);
  });

  it("already in front: z is not raised further and nothing is committed", () => {
    seed();
    useDiagramStore.getState().setNodeZ(["a"], "front");
    const zAfter = z("a");
    const depth = useDiagramStore.getState().past.length;
    useDiagramStore.getState().setNodeZ(["a"], "front");
    expect(z("a")).toBe(zAfter);
    expect(useDiagramStore.getState().past.length).toBe(depth);
  });

  it("z survives a round trip", () => {
    seed();
    useDiagramStore.getState().setNodeZ(["a"], "front");
    const zBefore = z("a");
    const doc = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(doc, null);
    expect(z("a")).toBe(zBefore);
  });
});

describe("fragments are background and do not touch other elements (#28 decision 1)", () => {
  beforeEach(resetStore);

  const seedInteraction = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "ui", label: "UI", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "api", label: "API", shape: "lifeline", x: 400, y: 0 } },
      { op: "add_message", message: { id: "m", from: "ui", to: "api", y: 200 } },
    ]);
  };

  it("placing a frame over a message leaves the message alone", () => {
    seedInteraction();
    // place it so the frame's center is on the message line
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "c", shape: "fragment", x: 40, y: 100, width: 420, height: 200 },
      },
    ]);
    // This test checks that the frame does not touch the message.
    // The drop-split removal itself is pinned by the "does not split an edge" test above (#91).
    expect(useDiagramStore.getState().edges).toHaveLength(1);
    // the message is still a message (pct handles kept)
    const e = useDiagramStore.getState().edges[0];
    expect(e?.source).toBe("ui");
    expect(e?.target).toBe("api");
  });

  it("add_edge does not accept a frame as an endpoint", () => {
    seedInteraction();
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "f", label: "c", shape: "fragment", x: 0, y: 100 } },
      ]);
    const before = useDiagramStore.getState().edges.length;
    // a frame has no handles, so this edge would not render — it would linger in state as a ghost
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "add_edge", edge: { source: "ui", target: "f" } }]);
    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(useDiagramStore.getState().edges).toHaveLength(before);
  });

  it("a node with edges cannot be turned into a frame", () => {
    seedInteraction();
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "ui", set: { shape: "fragment" } }]);
    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(useDiagramStore.getState().nodes[0]?.data.shape).toBe("lifeline");
  });

  it("a node without edges can be turned into a frame", () => {
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "b", label: "B", x: 0, y: 0 } }]);
    expect(
      useDiagramStore
        .getState()
        .applyOps([{ op: "update_node", id: "b", set: { shape: "fragment" } }]).applied,
    ).toBe(1);
  });

  it("drawing over a frame with the arrow tool does not connect to the frame", () => {
    seedInteraction();
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "c", shape: "fragment", x: 0, y: 400, width: 500, height: 200 },
      },
    ]);
    const before = useDiagramStore.getState().edges.length;
    // draw from inside the frame to empty space outside — the frame must not become the source
    useDiagramStore.getState().drawArrow({ x: 100, y: 480 }, { x: 900, y: 900 });
    const edges = useDiagramStore.getState().edges;
    expect(edges).toHaveLength(before + 1);
    const added = edges[edges.length - 1];
    expect(added?.source).not.toBe("f");
    expect(added?.target).not.toBe("f");
  });

  it("a file load drops edges touching a frame", () => {
    seedInteraction();
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "f", label: "c", shape: "fragment", x: 0, y: 400 } },
      ]);
    const doc = useDiagramStore.getState().toDoc();
    // a state a hand-edited file or an old version can produce — an unrenderable ghost edge
    doc.edges = [
      ...doc.edges,
      {
        id: "ghost",
        source: "ui",
        target: "f",
        type: "labeled",
        data: { variant: "solid", arrow: true },
      },
    ] as typeof doc.edges;
    useDiagramStore.getState().loadDoc(doc, null);
    expect(useDiagramStore.getState().edges.some((e) => e.id === "ghost")).toBe(false);
  });

  it("set_diagram rejects edges touching a frame (instead of silently dropping them)", () => {
    const r = useDiagramStore.getState().applyOps([
      {
        op: "set_diagram",
        doc: {
          version: 1,
          title: "t",
          nodes: [
            {
              id: "a",
              type: "shape",
              position: { x: 0, y: 0 },
              data: { label: "A", shape: "rect", color: "violet" },
            },
            {
              id: "f",
              type: "shape",
              position: { x: 0, y: 300 },
              data: { label: "F", shape: "fragment", color: "violet" },
            },
          ],
          edges: [
            {
              id: "e",
              source: "a",
              target: "f",
              type: "labeled",
              data: { variant: "solid", arrow: true },
            },
          ],
        },
      },
    ] as unknown as AgentOp[]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toContain("fragments and frames cannot be edge endpoints");
  });

  it("dropping a frame edge also cleans up its dangling anchor", () => {
    seedInteraction();
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "f", label: "c", shape: "fragment", x: 0, y: 400 } },
      ]);
    const doc = useDiagramStore.getState().toDoc();
    // a corrupt file: an anchor → fragment edge. Dropping the edge leaves the anchor as an orphan point
    doc.nodes = [
      ...doc.nodes,
      {
        id: "an",
        type: "shape",
        position: { x: 10, y: 420 },
        width: 12,
        height: 12,
        data: { label: "", shape: "anchor", color: "gray" },
      },
    ] as typeof doc.nodes;
    doc.edges = [
      ...doc.edges,
      {
        id: "ghost",
        source: "an",
        target: "f",
        type: "labeled",
        data: { variant: "solid", arrow: true },
      },
    ] as typeof doc.edges;
    useDiagramStore.getState().loadDoc(doc, null);
    expect(useDiagramStore.getState().edges.some((e) => e.id === "ghost")).toBe(false);
    expect(useDiagramStore.getState().nodes.some((n) => n.id === "an")).toBe(false);
  });

  it("dropping an anchor inside a frame does not snap to the frame", () => {
    seedInteraction();
    useDiagramStore.getState().applyOps([
      {
        op: "add_node",
        node: { id: "f", label: "c", shape: "fragment", x: 0, y: 100, width: 500, height: 200 },
      },
      { op: "add_message", message: { id: "fl", from: { x: -120 }, to: "ui", y: 240 } },
    ]);
    const anchor = useDiagramStore.getState().nodes.find((n) => n.data.shape === "anchor");
    if (!anchor) throw new Error("anchor missing");
    // an empty spot inside the frame — where distanceToRect gives 0
    const snap = findSnapTarget(useDiagramStore.getState().nodes, { x: 250, y: 240 }, [anchor.id]);
    expect(snap?.nodeId).not.toBe("f");
  });
});

describe("the destroy marker only cuts off new handles (#36)", () => {
  beforeEach(resetStore);

  const seed = () => {
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "a", label: "A", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", shape: "lifeline", x: 400, y: 0 } },
      { op: "add_message", message: { id: "m", from: "a", to: "b", y: 300 } },
    ]);
  };
  const handleY = (id: string) => {
    const st = useDiagramStore.getState();
    const e = st.edges.find((x) => x.id === "m");
    const n = st.nodes.find((x) => x.id === id);
    if (!e || !n) throw new Error("missing");
    return handlePointOnNode(n, id === e.source ? e.sourceHandle : e.targetHandle).y;
  };

  it("placing destroy does not move messages already below it", () => {
    seed();
    const before = handleY("a");
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 200 } }]);
    // the path where update_node runs resnapMessages — it must not get pulled up here
    expect(handleY("a")).toBe(before);
  });

  it("existing messages keep their relative position when moving the lifeline triggers a resnap", () => {
    seed();
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 200 } }]);
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { y: 40 } }]);
    // the node moved down 40, so the handle moves down 40 too (not cut off by the destroy limit)
    expect(handleY("a")).toBeGreaterThan(300);
  });

  it("a new message drawn with the arrow tool is also capped above destroy", () => {
    seed();
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 200 } }]);
    useDiagramStore.getState().drawArrow({ x: 60, y: 300 }, { x: 460, y: 300 });
    const st = useDiagramStore.getState();
    const created = st.edges[st.edges.length - 1];
    const a = st.nodes.find((n) => n.id === "a");
    if (!created || !a) throw new Error("missing");
    expect(handlePointOnNode(a, created.sourceHandle).y).toBeCloseTo(200, 0);
  });

  it("a self stroke is also capped above destroy", () => {
    seed();
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 200 } }]);
    useDiagramStore.getState().drawArrow({ x: 60, y: 260 }, { x: 60, y: 320 });
    const st = useDiagramStore.getState();
    const created = st.edges[st.edges.length - 1];
    const a = st.nodes.find((n) => n.id === "a");
    if (!created || !a) throw new Error("missing");
    expect(handlePointOnNode(a, created.sourceHandle).y).toBeLessThanOrEqual(200.1);
    expect(handlePointOnNode(a, created.targetHandle).y).toBeLessThanOrEqual(200.1);
  });

  it("body drag is capped above destroy for both kinds", () => {
    seed();
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 200 } }]);
    // a regular message (lifelines at both ends)
    useDiagramStore.getState().setMessageYLive("m", 320);
    const st = useDiagramStore.getState();
    const a = st.nodes.find((n) => n.id === "a");
    const m = st.edges.find((e) => e.id === "m");
    if (!a || !m) throw new Error("missing");
    expect(handlePointOnNode(a, m.sourceHandle).y).toBeCloseTo(200, 0);
  });

  it("the cap holds through a resnap after an endpoint snap (the anchor must move too)", () => {
    resetStore();
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 200, y: 0 } },
      { op: "update_node", id: "l", set: { destroyY: 200 } },
    ]);
    // attach a free arrow end below destroy (300) to the destroyed lifeline
    useDiagramStore.getState().addFreeArrowBetween({ x: 40, y: 300 }, { x: 900, y: 300 });
    const anchors = useDiagramStore.getState().nodes.filter((n) => n.data.shape === "anchor");
    const end = anchors[1];
    if (!end) throw new Error("anchor missing");
    useDiagramStore.getState().rewireAnchorToNode(end.id, "l", "left-83.33");

    const handleY = () => {
      const st = useDiagramStore.getState();
      const e = st.edges[0];
      const l = st.nodes.find((n) => n.id === "l");
      if (!e || !l) throw new Error("missing");
      return handlePointOnNode(l, e.source === "l" ? e.sourceHandle : e.targetHandle).y;
    };
    const anchorCy = () => {
      const an = useDiagramStore.getState().nodes.find((n) => n.data.shape === "anchor");
      if (!an) throw new Error("anchor gone");
      const b = nodeBounds(an);
      return b.y + b.height / 2;
    };

    // right after the snap: above the cap, with handle and anchor claiming the same y (horizontal)
    expect(handleY()).toBeCloseTo(200, 0);
    expect(anchorCy()).toBeCloseTo(200, 0);

    // a resnap does not revert it toward the anchor
    useDiagramStore.getState().resnapMessages(["l"]);
    expect(handleY()).toBeCloseTo(200, 0);
  });

  it("another arrow's snap does not pull up an existing found/lost message", () => {
    resetStore();
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 200, y: 0 } },
      // an existing message attached at 300 before destroy was placed — it must be preserved
      { op: "add_message", message: { id: "old", from: { x: 40 }, to: "l", y: 300 } },
      { op: "update_node", id: "l", set: { destroyY: 200 } },
    ]);
    const oldHandleY = () => {
      const st = useDiagramStore.getState();
      const e = st.edges.find((x) => x.id === "old");
      const l = st.nodes.find((n) => n.id === "l");
      if (!e || !l) throw new Error("missing");
      return handlePointOnNode(l, e.source === "l" ? e.sourceHandle : e.targetHandle).y;
    };
    const before = oldHandleY();

    // snap the end of an unrelated free arrow to the same lifeline
    useDiagramStore.getState().addFreeArrowBetween({ x: 600, y: 320 }, { x: 900, y: 320 });
    const fresh = useDiagramStore
      .getState()
      .nodes.filter((n) => n.data.shape === "anchor")
      .slice(-1)[0];
    if (!fresh) throw new Error("anchor missing");
    useDiagramStore.getState().rewireAnchorToNode(fresh.id, "l", "right-88.89");

    // old was not placed by this gesture, so it must stay put
    expect(oldHandleY()).toBeCloseTo(before, 1);
  });

  it("says why when destroy blocks a self-message", () => {
    seed();
    // destroy right below the 40 header — the line is long but there is no room to attach
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 50 } }]);
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { from: "a", to: "a", y: 45 } }]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toContain("destroy marker");
    expect(r.errors[0]).not.toContain("too short");
  });

  it("a new message is clamped above destroy", () => {
    seed();
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "a", set: { destroyY: 200 } }]);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_message", message: { id: "m2", from: "a", to: "b", y: 340 } }]);
    const st = useDiagramStore.getState();
    const e2 = st.edges.find((x) => x.id === "m2");
    const a = st.nodes.find((x) => x.id === "a");
    if (!e2 || !a) throw new Error("missing");
    // pct handles round to 2 decimals, so it is not exactly 200
    expect(handlePointOnNode(a, e2.sourceHandle).y).toBeCloseTo(200, 0);
  });
});

describe("clearSelection", () => {
  it("clears the selection of both nodes and edges", () => {
    useDiagramStore.setState({
      nodes: [
        { ...makeNode({ id: "a" }), selected: true },
        { ...makeNode({ id: "b" }), selected: false },
      ],
      edges: [{ ...makeEdge({ id: "e1", source: "a", target: "b" }), selected: true }],
    });

    useDiagramStore.getState().clearSelection();

    const st = useDiagramStore.getState();
    expect(st.nodes.every((n) => !n.selected)).toBe(true);
    expect(st.edges.every((e) => !e.selected)).toBe(true);
  });
});

describe("undo and selection (#56)", () => {
  const seedSelected = () => {
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
          [makeEdge({ id: "e1", source: "a", target: "b" })],
        ),
        null,
      );
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => (n.id === "a" ? { ...n, selected: true } : n)),
    }));
  };

  it("undo does not bring back a cleared selection", () => {
    seedSelected();
    // edit while selected → one history frame
    useDiagramStore.getState().updateNodeData("a", { label: "edited" });
    useDiagramStore.getState().clearSelection();

    useDiagramStore.getState().undo();

    const st = useDiagramStore.getState();
    expect(st.nodes.find((n) => n.id === "a")?.data.label).not.toBe("edited");
    expect(st.nodes.every((n) => !n.selected)).toBe(true);
  });

  it("the current selection survives undo", () => {
    seedSelected();
    useDiagramStore.getState().updateNodeData("b", { label: "edited" });

    useDiagramStore.getState().undo();

    const st = useDiagramStore.getState();
    expect(st.nodes.find((n) => n.id === "b")?.data.label).not.toBe("edited");
    expect(st.nodes.find((n) => n.id === "a")?.selected).toBe(true);
  });

  it("edge selection follows the same rule", () => {
    seedSelected();
    useDiagramStore.setState((st) => ({
      edges: st.edges.map((e) => ({ ...e, selected: true })),
    }));
    useDiagramStore.getState().updateNodeData("b", { label: "edited" });
    useDiagramStore.getState().clearSelection();

    useDiagramStore.getState().undo();

    expect(useDiagramStore.getState().edges.every((e) => !e.selected)).toBe(true);
  });

  it("the selection of a node removed by undo simply disappears", () => {
    seedSelected();
    useDiagramStore.getState().commit();
    const id = useDiagramStore.getState().addNode("rounded", { x: 500, y: 0 });
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => (n.id === id ? { ...n, selected: true } : n)),
    }));

    useDiagramStore.getState().undo();

    const st = useDiagramStore.getState();
    expect(st.nodes.some((n) => n.id === id)).toBe(false);
    expect(st.nodes.find((n) => n.id === "a")?.selected).toBe(true);
  });

  it("the saved document (toDoc) carries no selection state", () => {
    seedSelected();
    const doc = useDiagramStore.getState().toDoc();
    expect(doc.nodes.some((n) => "selected" in n)).toBe(false);
    expect(doc.edges.some((e) => "selected" in e)).toBe(false);
  });
});

describe("slideEdgeLine", () => {
  const seedPair = () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "b", x: 300, y: 0 })],
        [
          {
            ...makeEdge({ id: "e", source: "a", target: "b" }),
            sourceHandle: "right-50",
            targetHandle: "left-50",
          },
        ],
      ),
      null,
    );
  };

  it("slides both handles along their sides by the same amount", () => {
    seedPair();
    // nodes are 160x56, right-50 → y=28. Dragging to y=14 makes both pcts 25
    useDiagramStore.getState().slideEdgeLine("e", { x: 230, y: 14 });

    const e = useDiagramStore.getState().edges.find((x) => x.id === "e");
    expect(e?.sourceHandle).toBe("right-25");
    expect(e?.targetHandle).toBe("left-25");
  });

  it("the side does not change", () => {
    seedPair();
    useDiagramStore.getState().slideEdgeLine("e", { x: 230, y: -500 });

    const e = useDiagramStore.getState().edges.find((x) => x.id === "e");
    expect(e?.sourceHandle?.startsWith("right-")).toBe(true);
    expect(e?.targetHandle?.startsWith("left-")).toBe(true);
  });

  it("stops at the end of the side when dragged outside the node", () => {
    seedPair();
    useDiagramStore.getState().slideEdgeLine("e", { x: 230, y: -500 });

    const e = useDiagramStore.getState().edges.find((x) => x.id === "e");
    expect(e?.sourceHandle).toBe("right-0");
    expect(e?.targetHandle).toBe("left-0");
  });

  it("changes nothing when a handle is an anchor", () => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [makeNode({ id: "a", x: 0, y: 0 }), makeNode({ id: "p", shape: "anchor", x: 300, y: 0 })],
        [
          {
            ...makeEdge({ id: "e", source: "a", target: "p" }),
            sourceHandle: "right-50",
            targetHandle: "center",
          },
        ],
      ),
      null,
    );
    useDiagramStore.getState().slideEdgeLine("e", { x: 230, y: 14 });

    const e = useDiagramStore.getState().edges.find((x) => x.id === "e");
    expect(e?.sourceHandle).toBe("right-50");
    expect(e?.targetHandle).toBe("center");
  });

  it("makes no undo frame (the drag start commits)", () => {
    seedPair();
    const before = useDiagramStore.getState().past.length;
    useDiagramStore.getState().slideEdgeLine("e", { x: 230, y: 14 });
    expect(useDiagramStore.getState().past.length).toBe(before);
  });
});

describe("slideEdgeLine — lifeline handles", () => {
  const seedLifeline = (destroyY?: number) => {
    useDiagramStore.getState().loadDoc(
      makeDoc(
        [
          makeNode({ id: "box", x: 0, y: 150 }),
          {
            ...makeNode({ id: "l", shape: "lifeline", x: 400, y: 0, width: 120, height: 360 }),
            data: {
              ...makeNode({ id: "l", shape: "lifeline" }).data,
              shape: "lifeline" as const,
              ...(destroyY === undefined ? {} : { destroyY }),
            },
          },
        ],
        [
          {
            ...makeEdge({ id: "e", source: "box", target: "l" }),
            sourceHandle: "right-50",
            targetHandle: "left-50",
          },
        ],
      ),
      null,
    );
  };

  const attachY = () => {
    const st = useDiagramStore.getState();
    const e = st.edges.find((x) => x.id === "e");
    const l = st.nodes.find((x) => x.id === "l");
    if (!e || !l) throw new Error("missing");
    return handlePointOnNode(l, e.targetHandle).y;
  };

  it("does not attach above the header", () => {
    seedLifeline();
    useDiagramStore.getState().slideEdgeLine("e", { x: 200, y: -100 });
    // Clamped exactly to the header (40px). A range assertion alone would be satisfied by the
    // initial handle (y=180) and pass even if sliding were broken entirely
    expect(attachY()).toBeCloseTo(40, 0);
  });

  it("does not attach below the destroy marker", () => {
    seedLifeline(200);
    useDiagramStore.getState().slideEdgeLine("e", { x: 200, y: 340 });
    // the initial handle (y=180) is also under 200, so only an exact value catches a no-op
    expect(attachY()).toBeCloseTo(200, 0);
  });
});

describe("bridge ops — class nodes", () => {
  const seedClass = () => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
      ]);
  };
  const cls = () => useDiagramStore.getState().nodes.find((n) => n.id === "c");

  it("sets the body", () => {
    seedClass();
    const r = useDiagramStore.getState().applyOps([
      {
        op: "update_node",
        id: "c",
        set: {
          stereotype: "«entity»",
          isAbstract: true,
          attributes: ["+ id: int", "", "- total: money"],
          methods: ["+ submit(): void"],
        },
      },
    ]);

    expect(r.errors).toEqual([]);
    expect(cls()?.data.stereotype).toBe("entity");
    expect(cls()?.data.isAbstract).toBe(true);
    expect(cls()?.data.attributes).toEqual(["+ id: int", "- total: money"]);
    expect(cls()?.data.methods).toEqual(["+ submit(): void"]);
  });

  it("grows taller as members are added", () => {
    seedClass();
    const before = cls()?.height ?? 0;
    useDiagramStore
      .getState()
      .applyOps([
        { op: "update_node", id: "c", set: { methods: ["+ a()", "+ b()", "+ c()", "+ d()"] } },
      ]);
    expect(cls()?.height ?? 0).toBeGreaterThan(before);
  });

  it("rejects nodes that are not classes", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "b" })], []), null);
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "b", set: { attributes: ["+ x"] } }]);

    expect(r.applied).toBe(0);
    expect(r.errors[0]).toContain("only valid on class nodes");
  });

  it("an empty array removes the compartment", () => {
    seedClass();
    useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "c", set: { attributes: ["+ x"] } }]);
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "c", set: { attributes: [] } }]);
    expect(cls()?.data.attributes).toBeUndefined();
  });

  it("survives a save and reload", () => {
    seedClass();
    useDiagramStore.getState().applyOps([
      {
        op: "update_node",
        id: "c",
        set: { stereotype: "entity", attributes: ["+ id: int"], methods: ["+ run()"] },
      },
    ]);
    const doc = useDiagramStore.getState().toDoc();
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore.getState().loadDoc(doc, null);

    expect(cls()?.data.stereotype).toBe("entity");
    expect(cls()?.data.attributes).toEqual(["+ id: int"]);
    expect(cls()?.data.methods).toEqual(["+ run()"]);
  });
});

describe("the bridge accepts every UML relation preset", () => {
  // The marker allow list is a runtime array the type checker cannot reach. A new MarkerShape
  // added only to the union and not to this array would be silently rejected by the bridge alone
  it.each(UML_RELATIONS.map((r) => r.id))("%s", (id) => {
    useDiagramStore
      .getState()
      .loadDoc(makeDoc([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], []), null);
    const r = useDiagramStore.getState().applyOps([
      {
        op: "add_edge",
        edge: { id: `e-${id}`, source: "a", target: "b", ...UML_RELATION_STYLE[id] },
      },
    ]);

    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(1);
  });
});

describe("class size correction on the inspector path (updateNodeData)", () => {
  const seed = () => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
  };
  const cls = () => useDiagramStore.getState().nodes.find((n) => n.id === "c");

  it("adding members grows the height", () => {
    seed();
    const before = cls()?.height ?? 0;
    useDiagramStore.getState().updateNodeData("c", { methods: ["+ a()", "+ b()", "+ c()"] });
    expect(cls()?.height ?? 0).toBeGreaterThan(before);
  });

  it("adding a long member grows the width", () => {
    seed();
    const before = cls()?.width ?? 0;
    useDiagramStore.getState().updateNodeData("c", {
      attributes: ["+ aVeryLongSignatureThatDoesNotFitTheDefaultWidth: T"],
    });
    expect(cls()?.width ?? 0).toBeGreaterThan(before);
  });

  it("sanitizes the raw lines the inspector passes", () => {
    seed();
    useDiagramStore.getState().updateNodeData("c", { attributes: ["+ a", "", "  "] });
    expect(cls()?.data.attributes).toEqual(["+ a"]);
  });

  it("does not store «» twice when the user types them", () => {
    seed();
    useDiagramStore.getState().updateNodeData("c", { stereotype: "«entity»" });
    expect(cls()?.data.stereotype).toBe("entity");
  });
});

describe("update_node — member array validation", () => {
  const seed = () => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore
      .getState()
      .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "c", set: { attributes: ["+ keep: me"] } }]);
  };
  const cls = () => useDiagramStore.getState().nodes.find((n) => n.id === "c");

  it("rejects arrays with non-string elements — a rejection, not a clear", () => {
    seed();
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "c", set: { attributes: [42] as unknown as string[] } }]);

    expect(r.applied).toBe(0);
    expect(r.errors[0]).toContain("arrays of strings");
    expect(cls()?.data.attributes).toEqual(["+ keep: me"]);
  });

  it("rejects non-arrays", () => {
    seed();
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "c", set: { methods: "+ a()" as unknown as string[] } }]);
    expect(r.applied).toBe(0);
  });

  it("an empty array is an intended clear and passes", () => {
    seed();
    const r = useDiagramStore
      .getState()
      .applyOps([{ op: "update_node", id: "c", set: { attributes: [] } }]);

    expect(r.errors).toEqual([]);
    expect(cls()?.data.attributes).toBeUndefined();
  });
});

/** Fills the document and selects the given ids — shared by the clipboard tests. */
const seedSelected = (nodes: DiagramNode[], edges: DiagramEdge[], selectedIds: string[]): void => {
  useDiagramStore.getState().loadDoc(makeDoc(nodes, edges), null);
  const wanted = new Set(selectedIds);
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => (wanted.has(n.id) ? { ...n, selected: true } : n)),
    edges: s.edges.map((e) => (wanted.has(e.id) ? { ...e, selected: true } : e)),
  }));
};

describe("useDiagramStore copy and paste", () => {
  beforeEach(() => {
    resetStore();
    // The buffer is meant to survive loadDoc (T25) — clear what earlier tests left here
    // so each test starts from its own premise
    useDiagramStore.setState({ clipboard: null, pasteCount: 0 });
  });

  /** Fills the document and selects the given ids. */
  const pasted = (originalIds: string[]) =>
    useDiagramStore.getState().nodes.filter((n) => !originalIds.includes(n.id));

  it("T7: copy does not touch the history", () => {
    seedSelected([makeNode({ id: "a" })], [], ["a"]);
    const before = useDiagramStore.getState().past.length;

    useDiagramStore.getState().copySelection();

    expect(useDiagramStore.getState().past.length).toBe(before);
    expect(useDiagramStore.getState().clipboard).not.toBeNull();
  });

  it("T6: copying an empty selection keeps the previous buffer", () => {
    seedSelected([makeNode({ id: "a" })], [], ["a"]);
    useDiagramStore.getState().copySelection();
    const held = useDiagramStore.getState().clipboard;

    useDiagramStore.getState().clearSelection();
    useDiagramStore.getState().copySelection();

    expect(useDiagramStore.getState().clipboard).toBe(held);
  });

  it("T8/T20: paste creates one copy and one history frame", () => {
    seedSelected([makeNode({ id: "a", x: 100, y: 50 })], [], ["a"]);
    useDiagramStore.getState().copySelection();
    const before = useDiagramStore.getState().past.length;

    useDiagramStore.getState().paste();

    const { nodes, past } = useDiagramStore.getState();
    expect(nodes).toHaveLength(2);
    expect(past.length).toBe(before + 1);
    expect(pasted(["a"])[0]!.position).toEqual({ x: 116, y: 66 });
  });

  it("T9: repeated pastes cascade", () => {
    seedSelected([makeNode({ id: "a", x: 0, y: 0 })], [], ["a"]);
    useDiagramStore.getState().copySelection();

    useDiagramStore.getState().paste();
    useDiagramStore.getState().paste();
    useDiagramStore.getState().paste();

    const copies = pasted(["a"]).map((n) => n.position);
    expect(useDiagramStore.getState().nodes).toHaveLength(4);
    expect(copies).toEqual([
      { x: 16, y: 16 },
      { x: 32, y: 32 },
      { x: 48, y: 48 },
    ]);
  });

  it("T10: copying again resets the cascade", () => {
    seedSelected([makeNode({ id: "a", x: 0, y: 0 })], [], ["a"]);
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();
    useDiagramStore.getState().paste();

    // select the original again and copy → the cascade starts over
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "a" })),
    }));
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();

    const last = useDiagramStore.getState().nodes.at(-1)!;
    expect(last.position).toEqual({ x: 16, y: 16 });
  });

  it("T13: edges are pasted too and point at the copied nodes", () => {
    seedSelected(
      [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      [makeEdge({ id: "e1", source: "a", target: "b" })],
      ["a", "b"],
    );
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();

    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(2);
    const copyIds = new Set(pasted(["a", "b"]).map((n) => n.id));
    const copyEdge = edges.find((e) => e.id !== "e1")!;
    expect(copyIds.has(copyEdge.source)).toBe(true);
    expect(copyIds.has(copyEdge.target)).toBe(true);
  });

  it("T21: a single undo cancels the whole paste", () => {
    seedSelected(
      [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
      [makeEdge({ id: "e1", source: "a", target: "b" })],
      ["a", "b"],
    );
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();

    useDiagramStore.getState().undo();

    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("T22: the pasted items are selected and the originals deselected", () => {
    seedSelected([makeNode({ id: "a" })], [], ["a"]);
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();

    const { nodes } = useDiagramStore.getState();
    expect(nodes.find((n) => n.id === "a")!.selected).toBe(false);
    expect(pasted(["a"])[0]!.selected).toBe(true);
  });

  it("T23: pasting with an empty buffer does nothing", () => {
    seedSelected([makeNode({ id: "a" })], [], []);
    const before = useDiagramStore.getState().past.length;

    useDiagramStore.getState().paste();

    expect(useDiagramStore.getState().nodes).toHaveLength(1);
    expect(useDiagramStore.getState().past.length).toBe(before);
  });

  it("T24: can paste even after the original is deleted", () => {
    seedSelected([makeNode({ id: "a", label: "kept" })], [], ["a"]);
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().deleteElements(["a"], []);

    useDiagramStore.getState().paste();

    const { nodes } = useDiagramStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.data.label).toBe("kept");
    expect(nodes[0]!.id).not.toBe("a");
  });

  it("T25: the buffer survives opening another document", () => {
    seedSelected([makeNode({ id: "a", label: "from doc 1" })], [], ["a"]);
    useDiagramStore.getState().copySelection();

    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "z" })], [], "Other Doc"), null);
    useDiagramStore.getState().paste();

    const { nodes } = useDiagramStore.getState();
    expect(nodes).toHaveLength(2);
    expect(nodes.some((n) => n.data.label === "from doc 1")).toBe(true);
  });

  it("swapping the document restarts the cascade — the buffer stays", () => {
    seedSelected([makeNode({ id: "a", x: 0, y: 0, label: "from doc 1" })], [], ["a"]);
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();
    useDiagramStore.getState().paste();

    useDiagramStore.getState().loadDoc(makeDoc([], [], "Other Doc"), null);
    useDiagramStore.getState().paste();

    const { nodes } = useDiagramStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.data.label).toBe("from doc 1");
    // the new document has no copies to overlap — it starts at +16, not +48
    expect(nodes[0]!.position).toEqual({ x: 16, y: 16 });
  });

  it("T15: a lifeline's activation bars and destroy marker survive a paste", () => {
    const lifeline: DiagramNode = {
      ...makeNode({ id: "l1", shape: "lifeline", height: 400 }),
      data: {
        label: "Client",
        shape: "lifeline",
        color: "violet",
        activations: [{ y0: 60, y1: 140 }],
        destroyY: 340,
      },
    };
    seedSelected([lifeline], [], ["l1"]);
    useDiagramStore.getState().copySelection();
    useDiagramStore.getState().paste();

    const copy = pasted(["l1"])[0]!;
    expect(copy.data.activations).toEqual([{ y0: 60, y1: 140 }]);
    expect(copy.data.destroyY).toBe(340);
  });
});

describe("useDiagramStore.loadDoc — clearing dead references on a document swap", () => {
  beforeEach(resetStore);

  it("an edit request does not carry over when the file is swapped", () => {
    // editRequestId points at a node by id. A document swap cannot be detected by an
    // existence check — the new document may reuse the same id (#76).
    // If it lingered, ShapeNode would mount with `editRequestId === id` and open the editor.
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "n1" })], []), "/a.dosik.json");
    useDiagramStore.getState().requestEditLabel("n1");

    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc([makeNode({ id: "n1", label: "n1 from another doc" })], []),
        "/b.dosik.json",
      );

    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });

  it("the edit request does not linger even when the new document lacks that id", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "n1" })], []), "/a.dosik.json");
    useDiagramStore.getState().requestEditLabel("n1");

    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "zzz" })], []), "/b.dosik.json");

    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });

  it("a bridge set_diagram also clears the edit request", () => {
    // bridge clients choose ids themselves, so reuse is routine
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "n1" })], []), "/a.dosik.json");
    useDiagramStore.getState().requestEditLabel("n1");

    useDiagramStore
      .getState()
      .applyOps([{ op: "set_diagram", doc: makeDoc([makeNode({ id: "n1" })], []) }]);

    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });

  it("so does New (an empty document)", () => {
    useDiagramStore.getState().loadDoc(makeDoc([makeNode({ id: "n1" })], []), "/a.dosik.json");
    useDiagramStore.getState().requestEditLabel("n1");

    useDiagramStore.getState().loadDoc(makeDoc([], [], "Untitled Diagram"), null);

    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });
});

describe("useDiagramStore cut and duplicate", () => {
  beforeEach(() => {
    resetStore();
    useDiagramStore.setState({ clipboard: null, pasteCount: 0 });
  });

  describe("cutSelection", () => {
    it("copies, then deletes the selection — one history frame", () => {
      seedSelected([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], [], ["a"]);
      const before = useDiagramStore.getState().past.length;

      expect(useDiagramStore.getState().cutSelection()).toBe(true);

      const { nodes, past, clipboard } = useDiagramStore.getState();
      expect(nodes.map((n) => n.id)).toEqual(["b"]);
      expect(past.length).toBe(before + 1);
      expect(clipboard?.nodes.map((n) => n.id)).toEqual(["a"]);
    });

    it("pasting what was cut brings it back", () => {
      seedSelected([makeNode({ id: "a", label: "cut item" })], [], ["a"]);
      useDiagramStore.getState().cutSelection();

      useDiagramStore.getState().paste();

      const { nodes } = useDiagramStore.getState();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]!.data.label).toBe("cut item");
      expect(nodes[0]!.id).not.toBe("a");
    });

    it("a single undo cancels the whole cut", () => {
      seedSelected(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [makeEdge({ id: "e1", source: "a", target: "b" })],
        ["a", "b"],
      );
      useDiagramStore.getState().cutSelection();

      useDiagramStore.getState().undo();

      const { nodes, edges } = useDiagramStore.getState();
      expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
      expect(edges.map((e) => e.id)).toEqual(["e1"]);
    });

    it("does nothing without a selection", () => {
      seedSelected([makeNode({ id: "a" })], [], []);
      const before = useDiagramStore.getState().past.length;

      expect(useDiagramStore.getState().cutSelection()).toBe(false);

      expect(useDiagramStore.getState().nodes).toHaveLength(1);
      expect(useDiagramStore.getState().past.length).toBe(before);
    });

    it("deletes just like Delete even when nothing selected can be copied", () => {
      // Selecting only one point of a free arrow leaves nothing to copy (collectFragment is null
      // — the other end is outside the selection, so the edge drops out and the anchor is orphaned).
      // Cut is "copy + delete", so the delete half must still happen.
      seedSelected(
        [makeNode({ id: "p1", shape: "anchor" }), makeNode({ id: "p2", shape: "anchor", x: 200 })],
        [makeEdge({ id: "e1", source: "p1", target: "p2" })],
        ["p1"],
      );

      expect(useDiagramStore.getState().cutSelection()).toBe(true);

      // deleting p1 takes the edge with it, and the remaining p2 is an orphan and gets pruned — same as Delete
      expect(useDiagramStore.getState().nodes).toHaveLength(0);
      expect(useDiagramStore.getState().edges).toHaveLength(0);
      expect(useDiagramStore.getState().clipboard).toBeNull();
    });

    it("W1: does not keep the previous buffer when there is nothing to hold", () => {
      // Keeping it would make the next Cmd+V paste something the user did not cut.
      // Cut really changes the document, so 'an empty copy keeps the buffer' does not apply.
      seedSelected([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], [], ["a"]);
      useDiagramStore.getState().copySelection();
      expect(useDiagramStore.getState().clipboard).not.toBeNull();

      // select just one edge — both ends are outside the selection, so collectFragment returns null
      useDiagramStore
        .getState()
        .loadDoc(
          makeDoc(
            [makeNode({ id: "l1" }), makeNode({ id: "l2", x: 300 })],
            [makeEdge({ id: "m1", source: "l1", target: "l2" })],
          ),
          null,
        );
      useDiagramStore.setState((st) => ({
        edges: st.edges.map((e) => ({ ...e, selected: true })),
      }));

      expect(useDiagramStore.getState().cutSelection()).toBe(true);

      expect(useDiagramStore.getState().edges).toHaveLength(0);
      expect(useDiagramStore.getState().clipboard).toBeNull();
      expect(useDiagramStore.getState().pasteCount).toBe(0);
    });

    it("S2: boundary edges are cut away but not put on the clipboard", () => {
      // the core claim of this PR — what copy holds differs from what delete removes
      seedSelected(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [makeEdge({ id: "e1", source: "a", target: "b" })],
        ["a"],
      );

      useDiagramStore.getState().cutSelection();

      const { nodes, edges, clipboard } = useDiagramStore.getState();
      expect(nodes.map((n) => n.id)).toEqual(["b"]);
      expect(edges).toHaveLength(0);
      expect(clipboard?.nodes.map((n) => n.id)).toEqual(["a"]);
      expect(clipboard?.edges).toHaveLength(0);
    });

    it("overwrites the clipboard", () => {
      seedSelected([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], [], ["a"]);
      useDiagramStore.getState().copySelection();
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "b" })),
      }));

      useDiagramStore.getState().cutSelection();

      expect(useDiagramStore.getState().clipboard?.nodes.map((n) => n.id)).toEqual(["b"]);
    });
  });

  describe("duplicateSelection", () => {
    it("creates a copy next to the selection and selects it — one frame", () => {
      seedSelected([makeNode({ id: "a", x: 100, y: 50 })], [], ["a"]);
      const before = useDiagramStore.getState().past.length;

      expect(useDiagramStore.getState().duplicateSelection()).toBe(true);

      const { nodes, past } = useDiagramStore.getState();
      expect(nodes).toHaveLength(2);
      expect(past.length).toBe(before + 1);
      const copy = nodes.find((n) => n.id !== "a")!;
      expect(copy.position).toEqual({ x: 116, y: 66 });
      expect(copy.selected).toBe(true);
      expect(nodes.find((n) => n.id === "a")!.selected).toBe(false);
    });

    it("repeated presses cascade on their own — without a counter", () => {
      // Duplicate reads the current selection each time, and the copy is selected right after.
      seedSelected([makeNode({ id: "a", x: 0, y: 0 })], [], ["a"]);

      useDiagramStore.getState().duplicateSelection();
      useDiagramStore.getState().duplicateSelection();
      useDiagramStore.getState().duplicateSelection();

      const positions = useDiagramStore
        .getState()
        .nodes.map((n) => n.position)
        .sort((p, q) => p.x - q.x);
      expect(positions).toEqual([
        { x: 0, y: 0 },
        { x: 16, y: 16 },
        { x: 32, y: 32 },
        { x: 48, y: 48 },
      ]);
    });

    it("does not touch the clipboard", () => {
      seedSelected([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], [], ["a"]);
      useDiagramStore.getState().copySelection();
      const held = useDiagramStore.getState().clipboard;
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: n.id === "b" })),
      }));

      useDiagramStore.getState().duplicateSelection();

      // the buffer's 'contents' stay the same. The counter goes up so it does not overlap with paste
      expect(useDiagramStore.getState().clipboard).toBe(held);
    });

    it("duplicates edges and lifeline extras too", () => {
      const lifeline: DiagramNode = {
        ...makeNode({ id: "l1", shape: "lifeline", height: 400 }),
        data: {
          label: "Client",
          shape: "lifeline",
          color: "violet",
          activations: [{ y0: 60, y1: 140 }],
        },
      };
      seedSelected(
        [lifeline, makeNode({ id: "l2", shape: "lifeline", x: 300, height: 400 })],
        [
          makeEdge({
            id: "m1",
            source: "l1",
            target: "l2",
            sourceHandle: "right-25",
            targetHandle: "left-25",
          }),
        ],
        ["l1", "l2"],
      );

      useDiagramStore.getState().duplicateSelection();

      const { nodes, edges } = useDiagramStore.getState();
      expect(nodes).toHaveLength(4);
      expect(edges).toHaveLength(2);
      const copy = nodes.find((n) => n.id !== "l1" && n.data.label === "Client")!;
      expect(copy.data.activations).toEqual([{ y0: 60, y1: 140 }]);
    });

    it("a selected edge moves over to the copy as well", () => {
      // The whole selection must move to the copy — if the original edge stayed selected,
      // the next action would touch both the original and the copy.
      seedSelected(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [makeEdge({ id: "e1", source: "a", target: "b" })],
        ["a", "b", "e1"],
      );

      useDiagramStore.getState().duplicateSelection();

      const { edges } = useDiagramStore.getState();
      expect(edges.find((e) => e.id === "e1")!.selected).toBe(false);
      expect(edges.find((e) => e.id !== "e1")!.selected).toBe(true);
    });

    it("W2: copy → duplicate → paste do not overlap", () => {
      // Duplicate measures +16 from the current selection, paste +16*n from the buffer's original.
      // With different reference points, not sharing the counter would stack the two copies exactly.
      seedSelected([makeNode({ id: "a", x: 0, y: 0 })], [], ["a"]);
      useDiagramStore.getState().copySelection();

      useDiagramStore.getState().duplicateSelection();
      useDiagramStore.getState().paste();

      const positions = useDiagramStore
        .getState()
        .nodes.map((n) => `${n.position.x},${n.position.y}`);
      expect(new Set(positions).size).toBe(positions.length);
      expect(positions).toEqual(["0,0", "16,16", "32,32"]);
    });

    it("does nothing without a selection", () => {
      seedSelected([makeNode({ id: "a" })], [], []);
      const before = useDiagramStore.getState().past.length;

      expect(useDiagramStore.getState().duplicateSelection()).toBe(false);

      expect(useDiagramStore.getState().nodes).toHaveLength(1);
      expect(useDiagramStore.getState().past.length).toBe(before);
    });
  });
});

describe("history frames for deletion (#110)", () => {
  beforeEach(resetStore);

  const seedGraph = () =>
    useDiagramStore
      .getState()
      .loadDoc(
        makeDoc(
          [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
          [makeEdge({ id: "e1", source: "a", target: "b" })],
        ),
        null,
      );

  it("separate node and edge changes make 2 frames (the cause)", () => {
    // React Flow v12 calls triggerEdgeChanges and triggerNodeChanges separately on delete.
    // If each handler commits, undo only restores half at a time.
    seedGraph();
    const before = useDiagramStore.getState().past.length;

    useDiagramStore.getState().onEdgesChange([{ type: "remove", id: "e1" }]);
    useDiagramStore.getState().onNodesChange([{ type: "remove", id: "a" }]);

    expect(useDiagramStore.getState().past.length - before).toBe(2);
  });

  it("deleteElements is 1 frame even when deleting nodes and edges together", () => {
    seedGraph();
    const before = useDiagramStore.getState().past.length;

    useDiagramStore.getState().deleteElements(["a"], []);

    expect(useDiagramStore.getState().past.length - before).toBe(1);
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(useDiagramStore.getState().edges).toHaveLength(0);
  });

  it("a single undo after deleteElements brings back the nodes and edges together", () => {
    seedGraph();
    useDiagramStore.getState().deleteElements(["a"], []);

    useDiagramStore.getState().undo();

    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(edges.map((e) => e.id)).toEqual(["e1"]);
  });
});
