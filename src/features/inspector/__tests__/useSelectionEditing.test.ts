import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useSelectionEditing } from "../useSelectionEditing";

const seedSelection = () => {
  useDiagramStore
    .getState()
    .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
  useDiagramStore.getState().applyOps([
    { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
    { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
    { op: "add_node", node: { id: "c", label: "C", x: 600, y: 0 } },
    { op: "add_edge", edge: { id: "e1", source: "a", target: "b" } },
    { op: "add_edge", edge: { id: "e2", source: "b", target: "c" } },
  ]);
  // Nodes a, b and edge e1 selected
  useDiagramStore.setState((s) => ({
    nodes: s.nodes.map((n) => ({ ...n, selected: n.id !== "c" })),
    edges: s.edges.map((e) => ({ ...e, selected: e.id === "e1" })),
  }));
};

describe("useSelectionEditing", () => {
  beforeEach(seedSelection);

  it("derives selection state (excluding anchors)", () => {
    const { result } = renderHook(() => useSelectionEditing());
    expect(result.current.selectedNodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(result.current.selectedEdges.map((e) => e.id)).toEqual(["e1"]);
    expect(result.current.firstNode?.id).toBe("a");
  });

  it("does not turn nodes with edges into fragments (they have no handles, so the edges would be lost)", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.setNodeShape("fragment");
    });
    // a and b are connected by e1, so they must stay as is
    const shapes = useDiagramStore.getState().nodes.map((n) => n.data.shape);
    expect(shapes.slice(0, 2)).toEqual(["rect", "rect"]);
  });

  it("setNodeColor/setNodeShape apply to every selected node", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.setNodeColor("rose");
      result.current.setNodeShape("diamond");
    });
    const nodes = useDiagramStore.getState().nodes;
    expect(nodes.find((n) => n.id === "a")?.data.color).toBe("rose");
    expect(nodes.find((n) => n.id === "b")?.data.shape).toBe("diamond");
    // Unselected nodes stay as is
    expect(nodes.find((n) => n.id === "c")?.data.color).toBe("mono");
  });

  it("patchEdges applies only to selected edges", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.patchEdges({ variant: "dashed" });
    });
    const edges = useDiagramStore.getState().edges;
    expect(edges.find((e) => e.id === "e1")?.data?.variant).toBe("dashed");
    expect(edges.find((e) => e.id === "e2")?.data?.variant).toBe("solid");
  });

  it("deleteSelection removes the selected nodes and edges", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.deleteSelection();
    });
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["c"]);
    expect(edges).toHaveLength(0);
  });

  it("reverseSelectedEdges flips only the direction of selected edges", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.reverseSelectedEdges();
    });
    const edges = useDiagramStore.getState().edges;
    const e1 = edges.find((e) => e.id === "e1");
    expect(e1?.source).toBe("b");
    expect(e1?.target).toBe("a");
    const e2 = edges.find((e) => e.id === "e2");
    expect(e2?.source).toBe("b");
  });
});

describe("useSelectionEditing — activation bars (lifeline)", () => {
  const seedLifeline = () => {
    useDiagramStore
      .getState()
      .loadDoc({ version: 1, title: "Untitled Diagram", nodes: [], edges: [] }, null);
    useDiagramStore.getState().applyOps([
      { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } },
      { op: "add_activation", lifeline: "l", y0: 100, y1: 180 },
    ]);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: true })),
    }));
  };

  beforeEach(seedLifeline);

  it("exposes soleLifeline for a single selected lifeline", () => {
    const { result } = renderHook(() => useSelectionEditing());
    expect(result.current.soleLifeline?.id).toBe("l");
  });

  it("soleLifeline is undefined for non-lifelines or multi-selection", () => {
    useDiagramStore
      .getState()
      .applyOps([
        { op: "add_node", node: { id: "l2", label: "L2", shape: "lifeline", x: 300, y: 0 } },
      ]);
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: true })),
    }));
    const { result } = renderHook(() => useSelectionEditing());
    expect(result.current.soleLifeline).toBeUndefined();
  });

  it("patchActivations saves after sanitizing and is undone by one undo", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.patchActivations("l", [
        { y0: 50, y1: 90 },
        { y0: 120, y1: 200 },
      ]);
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([
      { y0: 50, y1: 90 },
      { y0: 120, y1: 200 },
    ]);
    act(() => {
      useDiagramStore.getState().undo();
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([{ y0: 100, y1: 180 }]);
  });

  it("setActivationEnd clamps instead of rejecting (pushes y1 when y0 > y1)", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      // y1 is 180 but 250 is entered for y0 — the old implementation was a no-op, so the input reverted
      result.current.setActivationEnd("l", 0, "y0", 250);
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([{ y0: 250, y1: 258 }]);
  });

  it("setActivationEnd pulls values above the header or below the bottom inside the line", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.setActivationEnd("l", 0, "y0", -50);
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(40);
    act(() => {
      result.current.setActivationEnd("l", 0, "y1", 9999);
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y1).toBe(360);
  });

  it("setActivationEnd is a no-op for non-finite numbers and missing indices", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.setActivationEnd("l", 0, "y0", Number.NaN);
      result.current.setActivationEnd("l", 9, "y0", 120);
      result.current.setActivationEnd("ghost", 0, "y0", 120);
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([{ y0: 100, y1: 180 }]);
  });

  it("patchActivations rejects unusable arrays (no-op)", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      // y0 >= y1 — rejected by sanitizeActivations
      result.current.patchActivations("l", [{ y0: 200, y1: 100 }]);
    });
    expect(useDiagramStore.getState().nodes[0]?.data.activations).toEqual([{ y0: 100, y1: 180 }]);
  });

  it("addActivation creates a non-overlapping default span", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.addActivation("l");
    });
    const bars = useDiagramStore.getState().nodes[0]?.data.activations;
    expect(bars).toHaveLength(2);
    const added = bars?.[1];
    if (!added) throw new Error("bar missing");
    // Starts after the last bar (180) and ends within the bottom (360)
    expect(added.y0).toBeGreaterThanOrEqual(180);
    expect(added.y1).toBeGreaterThan(added.y0);
    expect(added.y1).toBeLessThanOrEqual(360);
  });

  it("does not add bars below the destroy", () => {
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "l", set: { destroyY: 220 } }]);
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.addActivation("l");
    });
    const bars = useDiagramStore.getState().nodes[0]?.data.activations ?? [];
    // The existing bar is 100–180 and destroy is 220 → only 188–220 is possible
    expect(bars).toHaveLength(2);
    expect(bars[1]?.y1).toBeLessThanOrEqual(220);
  });

  it("disables Add when the destroy is too close", () => {
    useDiagramStore.getState().applyOps([{ op: "update_node", id: "l", set: { destroyY: 184 } }]);
    const { result } = renderHook(() => useSelectionEditing());
    expect(result.current.canAddActivation).toBe(false);
  });

  it("Add stops without creating duplicate bars when the line is full", () => {
    const { result } = renderHook(() => useSelectionEditing());
    // Fill a 360-tall lifeline to the end with Add
    act(() => {
      for (let i = 0; i < 20; i += 1) result.current.addActivation("l");
    });
    const bars = useDiagramStore.getState().nodes[0]?.data.activations ?? [];
    const spans = bars.map((b) => `${b.y0}-${b.y1}`);
    expect(new Set(spans).size).toBe(spans.length); // no duplicate spans
    // Always starts below the previous bar's end (no overlap)
    for (let i = 1; i < bars.length; i += 1) {
      expect(bars[i]!.y0).toBeGreaterThan(bars[i - 1]!.y1);
    }
    expect(bars[bars.length - 1]!.y1).toBeLessThanOrEqual(360);
  });

  it("creates no history frame when the same value is entered again", () => {
    const { result } = renderHook(() => useSelectionEditing());
    const before = useDiagramStore.getState().past.length;
    act(() => {
      result.current.setActivationEnd("l", 0, "y0", 100);
    });
    expect(useDiagramStore.getState().past.length).toBe(before);
  });

  it("removeActivation removes only that index", () => {
    const { result } = renderHook(() => useSelectionEditing());
    act(() => {
      result.current.addActivation("l");
      result.current.removeActivation("l", 0);
    });
    const bars = useDiagramStore.getState().nodes[0]?.data.activations;
    expect(bars).toHaveLength(1);
    expect(bars?.[0]?.y0).toBeGreaterThanOrEqual(180);
  });
});
