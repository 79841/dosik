import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";

/**
 * #77 — canvas UI state that points at a node (dropMenu · snapTarget) must be cleaned up too when
 * the target node disappears. Same family as #76 (edge references): if it lingers, it tries to create
 * an edge from a dead node, or shows a snap target that doesn't exist.
 */
const seed = () => {
  useDiagramStore
    .getState()
    .loadDoc(makeDoc([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], []), null);
  useCanvasUiStore.getState().setDropMenu(null);
  useCanvasUiStore.getState().setSnapTarget(null);
};

const dropMenuFor = (fromId: string) => ({
  fromId,
  fromHandle: "right",
  flowX: 200,
  flowY: 100,
  clientX: 400,
  clientY: 300,
});

const snapTargetFor = (nodeId: string) => ({
  nodeId,
  handle: "left",
  point: { x: 300, y: 28 },
});

describe("lifecycle of UI state that references nodes (#77)", () => {
  beforeEach(seed);

  it("closes dropMenu when the bridge's delete_node removes the source node", () => {
    useCanvasUiStore.getState().setDropMenu(dropMenuFor("a"));
    const result = useDiagramStore.getState().applyOps([{ op: "delete_node", id: "a" }]);
    expect(result.errors).toEqual([]);
    expect(useCanvasUiStore.getState().dropMenu).toBeNull();
  });

  it("closes dropMenu when the node is deleted on the canvas too", () => {
    useCanvasUiStore.getState().setDropMenu(dropMenuFor("a"));
    useDiagramStore.getState().onNodesChange([{ id: "a", type: "remove" }]);
    expect(useCanvasUiStore.getState().dropMenu).toBeNull();
  });

  it("clears snapTarget when the snap target node disappears", () => {
    useCanvasUiStore.getState().setSnapTarget(snapTargetFor("b"));
    useDiagramStore.getState().applyOps([{ op: "delete_node", id: "b" }]);
    expect(useCanvasUiStore.getState().snapTarget).toBeNull();
  });

  it("leaves both states alone when another node is deleted", () => {
    useCanvasUiStore.getState().setDropMenu(dropMenuFor("a"));
    useCanvasUiStore.getState().setSnapTarget(snapTargetFor("a"));
    useDiagramStore.getState().applyOps([{ op: "delete_node", id: "b" }]);
    expect(useCanvasUiStore.getState().dropMenu?.fromId).toBe("a");
    expect(useCanvasUiStore.getState().snapTarget?.nodeId).toBe("a");
  });

  it("a wholesale document replace (set_diagram) containing the same ID also closes dropMenu", () => {
    // A path an existence check can't catch — docVersion detection has to apply to node references too
    useCanvasUiStore.getState().setDropMenu(dropMenuFor("a"));
    const result = useDiagramStore.getState().applyOps([
      {
        op: "set_diagram",
        doc: makeDoc([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], [], "Same ids"),
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(useCanvasUiStore.getState().dropMenu).toBeNull();
  });

  it("a wholesale document replace containing the same ID also clears snapTarget", () => {
    useCanvasUiStore.getState().setSnapTarget(snapTargetFor("b"));
    useDiagramStore
      .getState()
      .loadDoc(makeDoc([makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })], []), null);
    expect(useCanvasUiStore.getState().snapTarget).toBeNull();
  });
});
