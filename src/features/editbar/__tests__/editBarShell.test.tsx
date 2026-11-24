import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { EDITOR_TOAST_BOTTOM, TOAST_BOTTOM } from "../../../shared/lib/editorLayout";
import { useDiagramStore } from "../../../shared/lib/store";
import { handleCanvasKeyDown } from "../../canvas/canvasKeymap";
import { EDIT_BAR_BOTTOM, EDIT_BAR_HEIGHT, EditBar, TOAST_LIFT } from "../EditBar";

const seed = () =>
  useDiagramStore
    .getState()
    .loadDoc(
      makeDoc(
        [makeNode({ id: "a", label: "A" }), makeNode({ id: "b", label: "B", x: 300 })],
        [makeEdge({ id: "e", source: "a", target: "b" })],
      ),
      null,
    );

const select = (nodes: string[], edges: string[] = []) =>
  act(() => {
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: nodes.includes(n.id) })),
      edges: s.edges.map((e) => ({ ...e, selected: edges.includes(e.id) })),
    }));
  });

const button = (name: string) => screen.queryByRole("button", { name });
const open = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("bottom edit bar (#159)", () => {
  beforeEach(seed);

  it("has no bar without a selection", () => {
    render(<EditBar />);
    expect(screen.queryByRole("toolbar", { name: "Edit selection" })).toBeNull();
  });

  it("shapes only → shape buttons only, lines only → line buttons only, both → both", () => {
    const view = render(<EditBar />);
    select(["a"]);
    view.rerender(<EditBar />);
    expect(button("Color")).not.toBeNull();
    expect(button("Shape")).not.toBeNull();
    expect(button("Line")).toBeNull();

    select([], ["e"]);
    view.rerender(<EditBar />);
    expect(button("Color")).toBeNull();
    for (const name of [
      "Line color",
      "Line",
      "Path",
      "Arrowheads",
      "Labels",
      "Relation",
      "Reverse",
    ]) {
      expect(button(name)).not.toBeNull();
    }

    select(["a"], ["e"]);
    view.rerender(<EditBar />);
    expect(button("Color")).not.toBeNull();
    expect(button("Line")).not.toBeNull();
    expect(button("Delete selection")).not.toBeNull();
  });

  it("a button opens its section above the bar — one at a time, closed by clicking again or Escape", () => {
    select(["a"]);
    render(<EditBar />);
    open("Color");
    expect(screen.getByRole("dialog", { name: "Color" })).toBeInTheDocument();
    open("Shape");
    expect(screen.queryByRole("dialog", { name: "Color" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Shape" })).toBeInTheDocument();
    open("Shape");
    expect(screen.queryByRole("dialog")).toBeNull();
    open("Color");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the section on an outside click", () => {
    select(["a"]);
    render(
      <>
        <EditBar />
        <div data-testid="canvas" />
      </>,
    );
    open("Color");
    fireEvent.pointerDown(screen.getByTestId("canvas"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("picking a color changes every selected shape", () => {
    select(["a", "b"]);
    render(<EditBar />);
    open("Color");
    fireEvent.click(screen.getByTitle("teal"));
    expect(useDiagramStore.getState().nodes.map((n) => n.data.color)).toEqual(["teal", "teal"]);
  });

  it("a drawn text has no field here — it is typed on the canvas; an image's alt text is (#281)", () => {
    select(["a"]);
    const view = render(<EditBar />);
    expect(button("Text")).toBeNull();

    act(() => {
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === "a" ? { ...n, data: { ...n.data, shape: "image" as const } } : n,
        ),
      }));
    });
    view.rerender(<EditBar />);
    open("Alt text");
    fireEvent.change(screen.getByRole("textbox", { name: "Alt text" }), {
      target: { value: "Start" },
    });
    expect(useDiagramStore.getState().nodes[0]?.data.label).toBe("Start");
  });

  it("line: labels · path · end shapes · reverse · reset bends", () => {
    select([], ["e"]);
    render(<EditBar />);
    const edge = () => useDiagramStore.getState().edges[0]!;
    open("Labels");
    fireEvent.change(screen.getByRole("textbox", { name: "Center label" }), {
      target: { value: "next" },
    });
    expect(edge().data?.label).toBe("next");
    open("Path");
    fireEvent.click(screen.getByRole("button", { name: "Curved" }));
    expect(edge().data?.pathStyle).toBe("curved");
    open("Arrowheads");
    fireEvent.change(screen.getByRole("combobox", { name: "Start arrowhead" }), {
      target: { value: "circle" },
    });
    expect(edge().data?.markerStart).toBe("circle");
    const before = edge().source;
    fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
    expect(edge().source).not.toBe(before);
    act(() => {
      useDiagramStore.getState().updateEdgeData("e", { waypoints: [{ x: 1, y: 1 }] });
    });
    fireEvent.click(screen.getByRole("button", { name: /^Reset path/ }));
    expect(edge().data?.waypoints).toBeUndefined();
    // nothing moved by hand any more — nothing to reset
    expect(screen.getByRole("button", { name: /^Reset path/ })).toBeDisabled();
  });

  it("Relation shows ERD presets only between two entities", () => {
    select([], ["e"]);
    render(<EditBar />);
    open("Relation");
    expect(screen.queryByText("ERD relation")).toBeNull();
    expect(screen.getByText("UML relation")).toBeInTheDocument();
  });

  it("Delete selection removes the selected shapes and lines", () => {
    select(["a"], ["e"]);
    render(<EditBar />);
    fireEvent.click(screen.getByRole("button", { name: "Delete selection" }));
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
    expect(useDiagramStore.getState().edges).toHaveLength(0);
  });

  it("the toast stands above the bar's top edge — with one row (#159)", () => {
    // Toaster rests 16px from the bottom; lifted, its bottom edge clears the bar's top
    expect(TOAST_BOTTOM + TOAST_LIFT).toBeGreaterThanOrEqual(EDIT_BAR_BOTTOM + EDIT_BAR_HEIGHT);
    // right where the editor already holds them (#231 D18): a selection does not move them
    expect(TOAST_BOTTOM + TOAST_LIFT).toBe(EDITOR_TOAST_BOTTOM);
  });

  it("raises the toast by as much when the bar wraps to two rows (#159)", () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 86,
    });
    try {
      select(["a"]);
      render(<EditBar />);
      const lift = document.documentElement.style.getPropertyValue("--dsk-toast-lift");
      expect(TOAST_BOTTOM + Number.parseFloat(lift)).toBeGreaterThanOrEqual(EDIT_BAR_BOTTOM + 86);
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
    }
  });

  it("shows just the trash can, no divider, when only free-arrow endpoints are selected", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore.setState({
        nodes: [{ ...makeNode({ id: "p", shape: "anchor" }), selected: true }],
      });
    });
    const { container } = render(<EditBar />);
    expect(screen.getByRole("button", { name: "Delete selection" })).toBeInTheDocument();
    expect(container.querySelector(".w-px")).toBeNull();
  });

  it("colors on several shapes come back with one undo (#159)", () => {
    select(["a", "b"]);
    render(<EditBar />);
    const before = useDiagramStore.getState().nodes.map((n) => n.data.color);
    open("Color");
    fireEvent.click(screen.getByTitle("rose"));
    act(() => useDiagramStore.getState().undo());
    expect(useDiagramStore.getState().nodes.map((n) => n.data.color)).toEqual(before);
  });

  it("raises the toast above the bar while it's showing", () => {
    const view = render(<EditBar />);
    const lift = () => document.documentElement.style.getPropertyValue("--dsk-toast-lift");
    expect(lift()).toBe("");
    select(["a"]);
    view.rerender(<EditBar />);
    expect(lift()).toBe(`${TOAST_LIFT}px`);
    select([]);
    view.rerender(<EditBar />);
    expect(lift()).toBe("");
  });

  it("keeps what was typed when closing by an outside click or Escape mid-edit (#159)", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    });
    select(["c"]);
    render(
      <>
        <EditBar />
        <div data-testid="canvas" />
      </>,
    );
    const stereotype = () => useDiagramStore.getState().nodes[0]?.data.stereotype;
    open("Class");
    let box = screen.getByRole("textbox", { name: "Stereotype" });
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "entity" } });
    fireEvent.pointerDown(screen.getByTestId("canvas"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stereotype()).toBe("entity");

    open("Class");
    box = screen.getByRole("textbox", { name: "Stereotype" });
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "aggregate" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stereotype()).toBe("aggregate");
  });

  it("Escape in a number field cancels only the input and the popover stays", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore.getState().applyOps([
        { op: "add_node", node: { id: "l", label: "L", shape: "lifeline", x: 0, y: 0 } },
        { op: "add_activation", lifeline: "l", y0: 100, y1: 180 },
      ]);
    });
    select(["l"]);
    render(<EditBar />);
    open("Activations");
    const start = screen.getByRole("spinbutton", { name: "Activation 1 start" });
    act(() => start.focus());
    fireEvent.change(start, { target: { value: "150" } });
    fireEvent.keyDown(start, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Activations" })).toBeInTheDocument();
    expect(useDiagramStore.getState().nodes[0]?.data.activations?.[0]?.y0).toBe(100);
  });

  it("keeps the typed input even when the agent clears the selection and the bar disappears (#159)", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    });
    select(["c"]);
    const view = render(<EditBar />);
    open("Class");
    const box = screen.getByRole("textbox", { name: "Stereotype" });
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "  entity  " } });
    // the field unmounts in the same render that takes the selection away
    select([]);
    view.rerender(<EditBar />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    // written, and cleaned like any other edit (the spaces go)
    expect(useDiagramStore.getState().nodes[0]?.data.stereotype).toBe("entity");
  });

  it("drops the stereotype when the section vanished because the shape changed — it has nowhere to go and isn't left raw on the box", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    });
    select(["c"]);
    const view = render(<EditBar />);
    open("Class");
    const box = screen.getByRole("textbox", { name: "Stereotype" });
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "entity" } });
    act(() => {
      useDiagramStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, shape: "rect" as const } })),
      }));
    });
    view.rerender(<EditBar />);
    expect(useDiagramStore.getState().nodes[0]?.data.stereotype).toBeUndefined();
  });

  it("input committed by an outside click comes back with one undo — not written twice", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    });
    select(["c"]);
    render(
      <>
        <EditBar />
        <div data-testid="canvas" />
      </>,
    );
    open("Class");
    const box = screen.getByRole("textbox", { name: "Stereotype" });
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "entity" } });
    fireEvent.pointerDown(screen.getByTestId("canvas"));
    expect(useDiagramStore.getState().nodes[0]?.data.stereotype).toBe("entity");
    act(() => useDiagramStore.getState().undo());
    expect(useDiagramStore.getState().nodes[0]?.data.stereotype).toBeUndefined();
  });

  it("closes an open section that no longer applies, and doesn't reopen it by itself when it applies again", () => {
    act(() => {
      useDiagramStore.getState().loadDoc(makeDoc([], []), null);
      useDiagramStore
        .getState()
        .applyOps([{ op: "add_node", node: { id: "c", label: "C", shape: "class", x: 0, y: 0 } }]);
    });
    select(["c"]);
    const view = render(<EditBar />);
    open("Class");
    act(() => useDiagramStore.getState().updateNodeData("c", { shape: "rect" }));
    view.rerender(<EditBar />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useDiagramStore.getState().updateNodeData("c", { shape: "class" }));
    view.rerender(<EditBar />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter pressed on a bar button belongs to that button — it doesn't start label editing", () => {
    select(["a"]);
    render(<EditBar />);
    const colorButton = screen.getByRole("button", { name: "Color" });
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: colorButton });
    handleCanvasKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(useDiagramStore.getState().editRequestId).toBeNull();
  });
});

/**
 * The bar lives in the canvas column (#219 D9): its place comes from the
 * column's width — not the window's — and its own measured width. jsdom has
 * no layout, so both are given here.
 */
describe("the edit bar positions itself within the canvas column (#219 D9, T9)", () => {
  const sizes = { canvas: 892, bar: 360, barHeight: 40 };
  const props: [string, PropertyDescriptor | undefined][] = [];
  const define = (name: "clientWidth" | "offsetWidth" | "offsetHeight", get: () => number) => {
    props.push([name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
  };

  beforeEach(() => {
    seed();
    sizes.canvas = 892;
    sizes.bar = 360;
    sizes.barHeight = 40;
    define("clientWidth", function (this: HTMLElement) {
      return this.hasAttribute("data-editor-canvas") ? sizes.canvas : 0;
    });
    define("offsetWidth", function (this: HTMLElement) {
      return this.getAttribute("role") === "toolbar" ? sizes.bar : 0;
    });
    define("offsetHeight", function (this: HTMLElement) {
      return this.getAttribute("role") === "toolbar" ? sizes.barHeight : 0;
    });
  });

  afterEach(() => {
    for (const [name, descriptor] of props.splice(0).reverse()) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
    vi.restoreAllMocks();
  });

  const renderInCanvas = () =>
    render(
      <div data-editor-canvas>
        <EditBar />
      </div>,
    );
  const bar = () => screen.getByRole("toolbar", { name: "Edit selection" });
  const lift = () => document.documentElement.style.getPropertyValue("--dsk-toast-lift");

  it("sets left · bottom · maxWidth from the canvas column width and bar width — without a centering transform", () => {
    select(["a"]);
    renderInCanvas();
    expect(bar().style.left).toBe("266px");
    expect(bar().style.bottom).toBe("12px");
    expect(bar().style.maxWidth).toBe("707px");
    expect(bar()).toHaveClass("w-max");
    expect(bar()).not.toHaveClass("-translate-x-1/2");
    // 12 + 40 + 8 − 16: the toasts stay at the editor's 60 (#231 D18)
    expect(lift()).toBe("44px");
  });

  it("moves to the row above the zoom island on a narrow canvas (412) — the toast rises by as much", () => {
    sizes.canvas = 412;
    select(["a"]);
    renderInCanvas();
    expect(bar().style.bottom).toBe("56px");
    // clear of the shape strip: 12 + 40 + 8 (#219)
    expect(bar().style.left).toBe("60px");
    expect(bar().style.maxWidth).toBe("340px");
    expect(lift()).toBe(`${56 + 40 + 8 - 16}px`);
  });

  it("raises the toast by the extra height when wrapped to two rows", () => {
    sizes.barHeight = 76;
    select(["a"]);
    renderInCanvas();
    expect(lift()).toBe(`${12 + 76 + 8 - 16}px`);
  });

  it("is a compact bar: 32px island buttons, 40px tall", () => {
    select(["a"]);
    renderInCanvas();
    expect(screen.getByRole("button", { name: "Color" }).className).toMatch(/(^|\s)h-8(\s|$)/);
    expect(bar()).toHaveClass("min-h-10", "px-1", "shadow-raised");
    expect(bar()).not.toHaveClass("ring-1");
  });

  it("shifts popovers sideways within the canvas column, not the window", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.hasAttribute("data-editor-canvas")) {
        return { left: 248, right: 660, top: 76, bottom: 700, width: 412, height: 624 } as DOMRect;
      }
      if (this.getAttribute("role") === "dialog") {
        // the box moves with the shift it is given
        const shift = Number.parseFloat(/\+ (-?[\d.]+)px/.exec(this.style.transform)?.[1] ?? "0");
        const left = 500 + shift;
        return {
          left,
          right: left + 240,
          top: 400,
          bottom: 600,
          width: 240,
          height: 200,
        } as DOMRect;
      }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
    });
    select(["a"]);
    renderInCanvas();
    open("Color");
    // 740 runs past the column's right edge (660) less the 8px margin
    expect(screen.getByRole("dialog", { name: "Color" }).style.transform).toBe(
      "translateX(calc(-50% + -88px))",
    );
  });
});
