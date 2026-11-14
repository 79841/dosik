import { beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { createShapeNode, useDiagramStore } from "../../../shared/lib/store";
import { useCanvasUiStore } from "../canvasUiStore";
import { openShapeMenu } from "../selectionMenu";

const at = (nodeId: string, settle: boolean, target: HTMLElement | null = null) =>
  openShapeMenu({ target, nodeId, settle, clientX: 5, clientY: 7 });

const selected = () =>
  useDiagramStore
    .getState()
    .nodes.filter((n) => n.selected)
    .map((n) => n.id)
    .sort();

const select = (ids: string[]) =>
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })),
  }));

beforeEach(() => {
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(
        [makeNode({ id: "a" }), makeNode({ id: "b", x: 300 })],
        [makeEdge({ id: "e", source: "a", target: "b" })],
      ),
      null,
    );
  // an anchor is what a free arrow's endpoint is; the factory is the only
  // place that shape is minted
  const anchor = { ...createShapeNode("anchor", { x: 9, y: 9 }), id: "anc" };
  useDiagramStore.setState((st) => ({ nodes: [...st.nodes, anchor] }));
  useCanvasUiStore.getState().setNodeMenu(null);
});

describe("rules deciding whether the shape context menu opens (#139)", () => {
  it("an ordinary shape settles the selection and opens the menu", () => {
    select(["b"]);
    expect(at("a", true)).toBe(true);
    expect(selected()).toEqual(["a"]);
    expect(useCanvasUiStore.getState().nodeMenu?.nodeId).toBe("a");
  });

  it("leaves the selection alone when coming through the multi-selection rectangle", () => {
    // The transparent rectangle React Flow lays over a rubber-band selection gets the right-click
    // first. Reaching here means the selection is already settled (#139)
    select(["a", "b"]);
    expect(at("a", false)).toBe(true);
    expect(selected()).toEqual(["a", "b"]);
    expect(useCanvasUiStore.getState().nodeMenu?.nodeId).toBe("a");
  });

  it("yields to the browser's edit menu while a label is being edited", () => {
    select(["b"]);
    const textarea = document.createElement("textarea");
    expect(at("a", true, textarea)).toBe(false);
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
    // Yielding means doing nothing — the selection stays too
    expect(selected()).toEqual(["b"]);
  });

  it("right-clicking an anchor alone doesn't wipe the selection", () => {
    // The menu won't open anyway (an anchor alone has no fragment to export).
    // If the selection just quietly vanished, the user would have to pick again
    select(["a", "b"]);
    expect(at("anc", true)).toBe(false);
    expect(selected()).toEqual(["a", "b"]);
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
  });
});
