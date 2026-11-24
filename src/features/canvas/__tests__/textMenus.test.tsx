import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import type { AgentOp } from "../../../shared/lib/types";
import { ADDABLE_SHAPES, CanvasContextMenu } from "../CanvasContextMenu";
import { useCanvasUiStore } from "../canvasUiStore";
import * as viewport from "../canvasViewport";
import { NodeContextMenu } from "../NodeContextMenu";
import { openSelectionMenuFromKeyboard, openShapeMenu } from "../selectionMenu";

vi.mock("../imagePaste", () => ({ pasteOntoCanvas: vi.fn(async () => {}) }));

const load = (ops: AgentOp[]) =>
  act(() => {
    useDiagramStore.getState().loadDoc(makeDoc([], []), null);
    useDiagramStore.getState().applyOps(ops);
  });
const data = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!.data;
const item = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const ui = () => useCanvasUiStore.getState();

beforeEach(() => {
  act(() => {
    ui().setNodeMenu(null);
    ui().setCanvasMenu(null);
    ui().setNodeTextEdit(null);
  });
});

describe("right-click on a text in a shape — that text's menu (#281)", () => {
  const BOX: AgentOp[] = [
    {
      op: "add_node",
      node: { id: "b", label: "Payments", description: "Charges", badge: "v2", x: 0, y: 0 },
    },
  ];

  const openOnText = (
    nodeId: string,
    textPart: "description" | "badge" | "attributes",
    line?: number,
  ) =>
    act(() => {
      openShapeMenu({
        target: null,
        nodeId,
        settle: true,
        clientX: 10,
        clientY: 10,
        textPart,
        line,
      });
    });

  it("opening it settles the selection like any shape's and remembers the text", () => {
    load(BOX);
    openOnText("b", "description");
    expect(ui().nodeMenu).toMatchObject({ nodeId: "b", textPart: "description" });
    expect(useDiagramStore.getState().nodes[0]!.selected).toBe(true);
  });

  it("shows Edit and Remove for that text — not the shape's items", () => {
    load(BOX);
    openOnText("b", "description");
    render(<NodeContextMenu />);
    expect(screen.getByRole("menu", { name: "Description actions" })).toBeInTheDocument();
    // no ↵: Enter on a selected shape opens its name, not this text
    expect(item("Edit description")).toHaveTextContent(/^Edit description$/);
    expect(item("Remove description")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Bring to front" })).toBeNull();
  });

  it("Edit opens the text for typing", () => {
    load(BOX);
    openOnText("b", "badge");
    render(<NodeContextMenu />);
    fireEvent.click(item(/Edit badge/));
    expect(ui().nodeTextEdit).toEqual({ nodeId: "b", part: "badge" });
    expect(ui().nodeMenu).toBeNull();
  });

  it("Remove takes the text away", () => {
    load(BOX);
    openOnText("b", "description");
    render(<NodeContextMenu />);
    fireEvent.click(item("Remove description"));
    expect(data("b").description).toBeUndefined();
    expect(data("b").badge).toBe("v2");
  });

  it("a row's menu removes that row alone and edits with it selected", () => {
    load([
      { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
      {
        op: "update_node",
        id: "c",
        set: { attributes: ["+ id: UUID", "- total: Money", "+ x: int"] },
      },
    ]);
    openOnText("c", "attributes", 1);
    const { unmount } = render(<NodeContextMenu />);
    fireEvent.click(item("Remove attribute"));
    expect(data("c").attributes).toEqual(["+ id: UUID", "+ x: int"]);
    unmount();

    openOnText("c", "attributes", 1);
    render(<NodeContextMenu />);
    fireEvent.click(item(/Edit attribute/));
    expect(ui().nodeTextEdit).toEqual({ nodeId: "c", part: "attributes", line: 1 });
  });

  it("a text that went meanwhile falls back to the shape's menu", () => {
    load(BOX);
    openOnText("b", "badge");
    act(() =>
      useDiagramStore.getState().applyOps([{ op: "update_node", id: "b", set: { badge: "" } }]),
    );
    render(<NodeContextMenu />);
    expect(screen.getByRole("menu", { name: "Shape actions" })).toBeInTheDocument();
  });
});

describe("the shape's menu: Edit text and Add … (#281)", () => {
  const openOnShape = (nodeId: string) =>
    act(() => {
      openShapeMenu({ target: null, nodeId, settle: true, clientX: 10, clientY: 10 });
    });

  it("Edit text opens the name", () => {
    load([{ op: "add_node", node: { id: "b", label: "Payments", x: 0, y: 0 } }]);
    openOnShape("b");
    render(<NodeContextMenu />);
    fireEvent.click(item(/Edit text/));
    expect(ui().nodeTextEdit).toEqual({ nodeId: "b", part: "label" });
  });

  it("Add description opens one for typing; a badge already there greys Add badge", () => {
    load([{ op: "add_node", node: { id: "b", label: "Payments", badge: "v2", x: 0, y: 0 } }]);
    openOnShape("b");
    render(<NodeContextMenu />);
    expect(item("Add badge")).toBeDisabled();
    fireEvent.click(item("Add description"));
    expect(ui().nodeTextEdit).toEqual({ nodeId: "b", part: "description", adding: true });
  });

  it("a class adds attributes and methods, an entity columns", () => {
    load([
      { op: "add_node", node: { id: "c", label: "Order", shape: "class", x: 0, y: 0 } },
      { op: "add_node", node: { id: "e", label: "orders", shape: "entity", x: 300, y: 0 } },
    ]);
    openOnShape("c");
    const { unmount } = render(<NodeContextMenu />);
    expect(item("Add attribute")).toBeEnabled();
    expect(item("Add method")).toBeEnabled();
    unmount();
    openOnShape("e");
    render(<NodeContextMenu />);
    fireEvent.click(item("Add column"));
    expect(ui().nodeTextEdit).toEqual({ nodeId: "e", part: "columns", adding: true });
  });

  it("opened from the keyboard over several shapes, it offers no text items — whose text would it be", () => {
    load([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
    ]);
    act(() =>
      useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) })),
    );
    act(() => {
      openSelectionMenuFromKeyboard();
    });
    render(<NodeContextMenu />);
    expect(screen.queryByRole("menuitem", { name: "Edit text" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Add / })).toBeNull();
    expect(item("Bring to front")).toBeInTheDocument();
  });

  it("a shape with one text offers no Add items", () => {
    load([{ op: "add_node", node: { id: "l", label: "Order", shape: "lifeline", x: 0, y: 0 } }]);
    openOnShape("l");
    render(<NodeContextMenu />);
    expect(screen.queryByRole("menuitem", { name: /^Add / })).toBeNull();
  });
});

describe("right-click on the empty canvas (#281)", () => {
  const openCanvas = () =>
    act(() => ui().setCanvasMenu({ clientX: 50, clientY: 50, flowX: 400, flowY: 300 }));

  it("offers Paste, Add shape, Add text and Select all", () => {
    openCanvas();
    render(<CanvasContextMenu />);
    expect(screen.getByRole("menu", { name: "Canvas actions" })).toBeInTheDocument();
    expect(item(/Paste/)).toBeInTheDocument();
    expect(item("Add shape")).toHaveAttribute("aria-haspopup", "menu");
    expect(item("Add text")).toBeInTheDocument();
    expect(item(/Select all/)).toBeInTheDocument();
  });

  it("closes the other menus — one right-click menu at a time", () => {
    load([{ op: "add_node", node: { id: "b", label: "B", x: 0, y: 0 } }]);
    act(() => ui().setNodeMenu({ nodeId: "b", clientX: 0, clientY: 0 }));
    openCanvas();
    expect(ui().nodeMenu).toBeNull();
    act(() => ui().setNodeMenu({ nodeId: "b", clientX: 0, clientY: 0 }));
    expect(ui().canvasMenu).toBeNull();
  });

  it("Add text puts a text shape where the menu opened and opens it for typing", () => {
    load([]);
    openCanvas();
    render(<CanvasContextMenu />);
    fireEvent.click(item("Add text"));
    const node = useDiagramStore.getState().nodes[0]!;
    expect(node.data.shape).toBe("text");
    expect(node.position.x + node.width! / 2).toBe(400);
    expect(node.position.y + node.height! / 2).toBe(300);
    expect(ui().nodeTextEdit).toEqual({ nodeId: node.id, part: "label" });
    expect(ui().canvasMenu).toBeNull();
  });

  it("Add shape › lists the rail's shapes and adds one centred where the menu opened", () => {
    load([]);
    openCanvas();
    render(<CanvasContextMenu />);
    fireEvent.click(item("Add shape"));
    const sub = screen.getByRole("menu", { name: "Add shape" });
    expect(sub.querySelectorAll('[role="menuitem"]')).toHaveLength(ADDABLE_SHAPES.length);
    expect(ADDABLE_SHAPES).not.toContain("image");
    expect(ADDABLE_SHAPES).not.toContain("icon");
    // the text shape is Add text, which opens it for typing
    expect(ADDABLE_SHAPES).not.toContain("text");
    fireEvent.click(item("Decision"));
    const node = useDiagramStore.getState().nodes[0]!;
    expect(node.data.shape).toBe("diamond");
    expect(node.position.x + node.width! / 2).toBe(400);
  });

  it("opened with the mouse, the submenu leaves the focus where it is", async () => {
    openCanvas();
    render(<CanvasContextMenu />);
    const trigger = item("Add shape");
    act(() => trigger.focus());
    fireEvent.click(trigger, { detail: 1 });
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(trigger).toHaveFocus();
  });

  it("opened from the keyboard, its first item takes the focus", async () => {
    openCanvas();
    render(<CanvasContextMenu />);
    fireEvent.keyDown(item("Add shape"), { key: "ArrowRight" });
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(item("Start / End")).toHaveFocus();
  });

  it("hovered open, a click keeps it open; leaving closes it after a moment, coming back keeps it", () => {
    vi.useFakeTimers();
    try {
      openCanvas();
      render(<CanvasContextMenu />);
      const trigger = item("Add shape");
      const wrapper = trigger.parentElement!;
      fireEvent.mouseEnter(wrapper);
      fireEvent.click(trigger, { detail: 1 });
      expect(screen.getByRole("menu", { name: "Add shape" })).toBeInTheDocument();
      fireEvent.mouseLeave(wrapper);
      act(() => vi.advanceTimersByTime(150));
      fireEvent.mouseEnter(wrapper);
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByRole("menu", { name: "Add shape" })).toBeInTheDocument();
      fireEvent.mouseLeave(wrapper);
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByRole("menu", { name: "Add shape" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the submenu opens with → and closes back with ←", () => {
    openCanvas();
    render(<CanvasContextMenu />);
    const trigger = item("Add shape");
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    const sub = screen.getByRole("menu", { name: "Add shape" });
    fireEvent.keyDown(sub, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Add shape" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("Select all picks every shape and line", () => {
    load([
      { op: "add_node", node: { id: "a", label: "A", x: 0, y: 0 } },
      { op: "add_node", node: { id: "b", label: "B", x: 300, y: 0 } },
      { op: "add_edge", edge: { id: "e", source: "a", target: "b" } },
    ]);
    openCanvas();
    render(<CanvasContextMenu />);
    fireEvent.click(item(/Select all/));
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.every((n) => n.selected)).toBe(true);
    expect(edges.every((e) => e.selected)).toBe(true);
  });

  it("Paste pastes as ⌘V does, at the point the menu opened", async () => {
    const pasteAt = vi.spyOn(viewport, "pasteAt");
    openCanvas();
    render(<CanvasContextMenu />);
    fireEvent.click(item(/Paste/));
    expect(pasteAt).toHaveBeenCalledWith({ x: 400, y: 300 }, expect.any(Function));
    pasteAt.mockRestore();
  });
});

describe("pasteAt — the point a paste lands on", () => {
  it("is the given point while the paste runs, the pointer's again after", async () => {
    let during: { x: number; y: number } | null = null;
    await viewport.pasteAt({ x: 7, y: 9 }, async () => {
      during = viewport.pastePoint();
    });
    expect(during).toEqual({ x: 7, y: 9 });
    expect(viewport.pastePoint()).not.toEqual({ x: 7, y: 9 });
  });
});

describe("menus and the editors they open (#281)", () => {
  it("Add description from a menu opened with the keyboard keeps its editor open", async () => {
    const { ReactFlowProvider } = await import("@xyflow/react");
    const { ShapeNode } = await import("../ShapeNode");
    load([{ op: "add_node", node: { id: "b", label: "Payments", x: 0, y: 0 } }]);
    act(() =>
      useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) })),
    );
    const Live = () => {
      const node = useDiagramStore((s) => s.nodes.find((n) => n.id === "b"));
      return node ? (
        <ShapeNode
          id="b"
          type="shape"
          data={node.data}
          selected
          dragging={false}
          zIndex={0}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          width={node.width}
          height={node.height}
          deletable
          draggable
          selectable
        />
      ) : null;
    };
    render(
      <ReactFlowProvider>
        {/* what had the focus before the menu — it would get it back on close */}
        <button type="button" data-testid="node-wrapper">
          before
        </button>
        <Live />
        <NodeContextMenu />
      </ReactFlowProvider>,
    );
    act(() => (screen.getByTestId("node-wrapper") as HTMLElement).focus());
    act(() => {
      openSelectionMenuFromKeyboard();
    });
    act(() => {
      fireEvent.click(item("Add description"));
    });
    expect(ui().nodeTextEdit).toMatchObject({ nodeId: "b", part: "description" });
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveFocus();
  });

  it("the canvas menu closes when the document is swapped — its point belonged to the old view", () => {
    load([]);
    act(() => ui().setCanvasMenu({ clientX: 0, clientY: 0, flowX: 1, flowY: 2 }));
    load([]);
    expect(ui().canvasMenu).toBeNull();
  });

  it("the shortcut shown is not read out — it goes to aria-keyshortcuts", () => {
    act(() => ui().setCanvasMenu({ clientX: 0, clientY: 0, flowX: 0, flowY: 0 }));
    render(<CanvasContextMenu />);
    const paste = item("Paste");
    expect(paste).toHaveAttribute("aria-keyshortcuts");
    expect(paste.getAttribute("aria-keyshortcuts")).toMatch(/\+V$/);
  });
});
