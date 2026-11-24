import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { PALETTE_COLORS } from "../../../shared/lib/palette";
import { createShapeNode, useDiagramStore } from "../../../shared/lib/store";
import { useChatStore } from "../../ai/chatStore";
import { useCanvasUiStore } from "../canvasUiStore";
import { EdgeContextMenu } from "../EdgeContextMenu";
import { NodeContextMenu } from "../NodeContextMenu";
import { openSelectionMenuFromKeyboard } from "../selectionMenu";

type ExportFn = (...a: unknown[]) => Promise<string | null>;
const exportPng = vi.fn<ExportFn>(async () => "Exported as PNG");
const exportSvg = vi.fn<ExportFn>(async () => "Exported as SVG");
const exportMarkdown = vi.fn<ExportFn>(async () => "Exported as Markdown");

const copyPng = vi.fn<ExportFn>(async () => "Copied as PNG");
const copySvg = vi.fn<ExportFn>(async () => "Copied as SVG");
const copyMarkdown = vi.fn<ExportFn>(async () => "Copied as Markdown");

vi.mock("../../export/exportActions", () => ({
  exportPng: (...a: unknown[]) => exportPng(...a),
  exportSvg: (...a: unknown[]) => exportSvg(...a),
  exportMarkdown: (...a: unknown[]) => exportMarkdown(...a),
  copyPng: (...a: unknown[]) => copyPng(...a),
  copySvg: (...a: unknown[]) => copySvg(...a),
  copyMarkdown: (...a: unknown[]) => copyMarkdown(...a),
  runExport: (task: () => Promise<string | null>) => task(),
}));

const openOn = (nodeId: string) =>
  useCanvasUiStore.getState().setNodeMenu({ nodeId, clientX: 10, clientY: 20 });

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
  useCanvasUiStore.getState().setNodeMenu(null);
  useCanvasUiStore.getState().setEdgeMenu(null);
  vi.clearAllMocks();
});

afterEach(() => {
  useCanvasUiStore.getState().setNodeMenu(null);
});

describe("shape context menu (#139)", () => {
  it("puts copy first and file save after it", () => {
    // Exporting is usually on the way to pasting somewhere (#143)
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    expect(screen.getByRole("menu", { name: "Shape actions" })).toBeTruthy();
    const exports = screen
      .getAllByRole("menuitem")
      .filter((b) => b.getAttribute("aria-label")?.endsWith("selection only"));
    expect(exports.map((b) => b.textContent)).toEqual([
      "Preview in Mermaid",
      "Copy as Markdown",
      "Copy image",
      "Copy as SVG",
      "Markdown (.md)",
      "PNG image (cropped)",
      "SVG image (cropped)",
    ]);
  });

  it("Markdown also covers only the selection — both copy and file (#192)", () => {
    select(["a"]);
    openOn("a");
    const first = render(<NodeContextMenu />);
    fireEvent.click(first.getByText("Copy as Markdown"));
    expect(copyMarkdown).toHaveBeenCalledWith(true);
    first.unmount();
    openOn("a");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByText("Markdown (.md)"));
    expect(exportMarkdown).toHaveBeenCalledWith(true);
  });

  it("Preview in Mermaid — opens the right panel to the preview, and the selection stays so only it shows (#194)", () => {
    useChatStore.setState({ open: false, view: "chat", mermaidMode: "code" });
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByText("Preview in Mermaid"));
    expect(useChatStore.getState()).toMatchObject({
      open: true,
      view: "mermaid",
      mermaidMode: "preview",
    });
    // the menu closes; what is picked stays picked
    expect(screen.queryByRole("menu", { name: "Shape actions" })).toBeNull();
    expect(useDiagramStore.getState().nodes.find((n) => n.id === "a")?.selected).toBe(true);
  });

  it("copy also includes only the selection", () => {
    select(["a"]);
    openOn("a");
    const first = render(<NodeContextMenu />);
    fireEvent.click(first.getByText("Copy image"));
    expect(copyPng).toHaveBeenCalledWith(true);
    // Clicking closes the menu, so reopen it for the second one
    first.unmount();
    openOn("a");
    const second = render(<NodeContextMenu />);
    fireEvent.click(second.getByText("Copy as SVG"));
    expect(copySvg).toHaveBeenCalledWith(true);
  });

  it("each item exports only the selection", () => {
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByText("PNG image (cropped)"));
    // the argument is the whole point: `false` here would silently export the
    // entire document from a menu that says "selection"
    expect(exportPng).toHaveBeenCalledWith(true);
    expect(exportSvg).not.toHaveBeenCalled();
  });

  it("closes the menu when an item is clicked", () => {
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByText("SVG image (cropped)"));
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
  });

  it("does not open the menu when there is nothing to export", () => {
    // In practice the only path here is selecting an anchor alone — an anchor survives into
    // a fragment only when the edge holding it is selected too
    const anchor = { ...createShapeNode("anchor", { x: 0, y: 0 }), id: "anc" };
    useDiagramStore.setState((st) => ({ nodes: [...st.nodes, anchor] }));
    select(["anc"]);
    openOn("anc");
    render(<NodeContextMenu />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  const focusedLabel = () =>
    document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;

  it("focuses the first item when opened with the keyboard", async () => {
    // macOS has no context menu key. Without this path there is no way at all to reach
    // selection export without a pointer (#139). Since edit items were added,
    // their first item — the first color — is the menu's first item (#159)
    select(["a", "b"]);
    expect(openSelectionMenuFromKeyboard()).toBe(true);
    expect(useCanvasUiStore.getState().nodeMenu?.fromKeyboard).toBe(true);
    render(<NodeContextMenu />);
    await waitFor(() => expect(focusedLabel()).toBe("Color mono"));
  });

  it("can open a selection of only edges with the keyboard too", () => {
    // Clicking a free arrow selects no nodes at all. If the mouse opens it from
    // the edge menu but the keyboard can't, the paths diverge (#139)
    // Free arrow = an edge holding two anchors. Selecting only an edge between regular shapes
    // leaves both ends out of the selection, so there's no fragment to export — not opening is correct
    const p1 = { ...createShapeNode("anchor", { x: 0, y: 0 }), id: "p1" };
    const p2 = { ...createShapeNode("anchor", { x: 80, y: 0 }), id: "p2" };
    useDiagramStore.setState((st) => ({
      nodes: [...st.nodes.map((n) => ({ ...n, selected: false })), p1, p2],
      edges: [
        ...st.edges.map((e) => ({ ...e, selected: false })),
        { ...st.edges[0]!, id: "free", source: "p1", target: "p2", selected: true },
      ],
    }));
    expect(openSelectionMenuFromKeyboard()).toBe(true);
    const id = useCanvasUiStore.getState().nodeMenu?.nodeId;
    // The cleanup subscription checks "gone" by this id, so it has to be a real node
    expect(useDiagramStore.getState().nodes.some((n) => n.id === id)).toBe(true);
  });

  it("returns focus to where it was when a keyboard-opened menu closes", async () => {
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    select(["a", "b"]);
    openSelectionMenuFromKeyboard();
    const view = render(<NodeContextMenu />);
    await waitFor(() => expect(focusedLabel()).toBe("Color mono"));
    view.unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it("the keyboard path does nothing when there's no selection to export", () => {
    select([]);
    expect(openSelectionMenuFromKeyboard()).toBe(false);
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
  });

  it("moves between items with the arrow keys", async () => {
    select(["a", "b"]);
    openSelectionMenuFromKeyboard();
    render(<NodeContextMenu />);
    await waitFor(() => expect(focusedLabel()).toBe("Color mono"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focusedLabel()).toBe("Color violet");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focusedLabel()).toBe("Color mono");
    // one menu: up from the first item wraps to the last export item (#159)
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focusedLabel()).toBe("SVG image (cropped), selection only");
  });

  it("the edge menu also opens selection export — only for a selected edge", () => {
    // A free arrow is an edge holding two anchors. Without this path that selection
    // would have no way to be exported (the ability #48 provided)
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: true })),
      edges: st.edges.map((e) => ({ ...e, selected: false })),
    }));
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 0, clientY: 0 });
    const shown = render(<EdgeContextMenu />);
    expect(shown.queryByText("Copy selection")).toBeNull();

    useDiagramStore.setState((st) => ({ edges: st.edges.map((e) => ({ ...e, selected: true })) }));
    shown.rerender(<EdgeContextMenu />);
    expect(shown.getByText("Copy selection")).toBeTruthy();
  });

  it("Preview in Mermaid in the edge menu too — the same group (#194)", () => {
    useChatStore.setState({ open: false, view: "chat" });
    // the edge and both its ends: a piece with something to draw
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: true })),
      edges: st.edges.map((e) => ({ ...e, selected: true })),
    }));
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 0, clientY: 0 });
    render(<EdgeContextMenu />);
    fireEvent.click(screen.getByText("Preview in Mermaid"));
    expect(useChatStore.getState()).toMatchObject({ open: true, view: "mermaid" });
  });

  it("does not show at the same time as the edge menu", () => {
    select(["a"]);
    openOn("a");
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 0, clientY: 0 });
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
    openOn("a");
    expect(useCanvasUiStore.getState().edgeMenu).toBeNull();
  });

  it("closes when the shape it pointed at disappears", () => {
    select(["a"]);
    openOn("a");
    useDiagramStore.getState().applyOps([{ op: "delete_node", id: "a" }]);
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
  });
});

describe("editing from the shape context menu (#159)", () => {
  it("puts color · forward · backward · delete above export", () => {
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    const items = screen.getAllByRole("menuitem").map((b) => b.textContent);
    // the shape's texts first (#281), then the order and delete
    expect(items.slice(0, 6)).toEqual([
      "Edit text↵",
      "Add description",
      "Add badge",
      "Bring to front",
      "Send to back",
      "Delete",
    ]);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(PALETTE_COLORS.length);
  });

  it("picking a color applies it to every selected shape and closes the menu", () => {
    select(["a", "b"]);
    openOn("a");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Color rose" }));
    expect(useDiagramStore.getState().nodes.map((n) => n.data.color)).toEqual(["rose", "rose"]);
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
  });

  it("marks the current color", () => {
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    const current = useDiagramStore.getState().nodes[0]!.data.color;
    expect(screen.getByRole("menuitemradio", { name: `Color ${current}` })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("forward and backward change z, and delete removes the selection", () => {
    select(["a"]);
    openOn("a");
    const view = render(<NodeContextMenu />);
    const zOf = (id: string) =>
      useDiagramStore.getState().nodes.find((n) => n.id === id)?.zIndex ?? 0;
    fireEvent.click(screen.getByRole("menuitem", { name: "Bring to front" }));
    expect(zOf("a")).toBeGreaterThan(zOf("b"));
    openOn("a");
    view.rerender(<NodeContextMenu />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(useDiagramStore.getState().nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("Send to back sends the selected shapes back", () => {
    select(["b"]);
    openOn("b");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Send to back" }));
    const zOf = (id: string) =>
      useDiagramStore.getState().nodes.find((n) => n.id === id)?.zIndex ?? 0;
    expect(zOf("b")).toBeLessThan(zOf("a"));
  });

  it("applies color only to selected shapes — free arrow endpoints are left alone", () => {
    const anchor = { ...createShapeNode("anchor", { x: 0, y: 0 }), id: "anc" };
    useDiagramStore.setState((st) => ({ nodes: [...st.nodes, anchor] }));
    select(["a", "anc"]);
    openOn("a");
    render(<NodeContextMenu />);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Color teal" }));
    const byId = (id: string) => useDiagramStore.getState().nodes.find((n) => n.id === id)!;
    expect(byId("a").data.color).toBe("teal");
    expect(byId("anc").data.color).not.toBe("teal");
  });

  it("in a pointer-opened menu ↑ goes to the last item and ↓ to the first (#159)", () => {
    select(["a"]);
    openOn("a");
    render(<NodeContextMenu />);
    const menu = screen.getByRole("menu", { name: "Shape actions" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "SVG image (cropped), selection only",
    );
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Color mono");
  });
});

/**
 * The canvas's right-click menus are `role="menu"` too, so they share the
 * menus' keyboard (`useMenuKeys`, #219) — one hook instead of
 * the hand-copied arrows each had (and the export group's own). They still
 * take the focus only when opened from the keyboard: a right-click leaves it
 * where it was.
 */
describe("context menus use the menu keyboard too — useMenuKeys (#219)", () => {
  const focused = () =>
    document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;

  it("shape menu: Home and End go to the ends, Escape closes and returns focus to where it was opened", async () => {
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    select(["a", "b"]);
    openSelectionMenuFromKeyboard();
    render(<NodeContextMenu />);
    await waitFor(() => expect(focused()).toBe("Color mono"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(focused()).toBe("SVG image (cropped), selection only");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(focused()).toBe("Color mono");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(useCanvasUiStore.getState().nodeMenu).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(before));
    before.remove();
  });

  it("the export-only shape menu (free arrow) uses the same keys — End from the first item", async () => {
    const p1 = { ...createShapeNode("anchor", { x: 0, y: 0 }), id: "p1" };
    const p2 = { ...createShapeNode("anchor", { x: 80, y: 0 }), id: "p2" };
    useDiagramStore.setState((st) => ({
      nodes: [...st.nodes.map((n) => ({ ...n, selected: false })), p1, p2],
      edges: [
        ...st.edges.map((e) => ({ ...e, selected: false })),
        { ...st.edges[0]!, id: "free", source: "p1", target: "p2", selected: true },
      ],
    }));
    openSelectionMenuFromKeyboard();
    render(<NodeContextMenu />);
    await waitFor(() => expect(focused()).toBe("Preview in Mermaid, selection only"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(focused()).toBe("SVG image (cropped), selection only");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focused()).toBe("Preview in Mermaid, selection only");
  });

  it("edge menu: every button is a menu item, and arrows walk color, line style, actions and export as one menu", () => {
    useDiagramStore.setState((st) => ({
      nodes: st.nodes.map((n) => ({ ...n, selected: true })),
      edges: st.edges.map((e) => ({ ...e, selected: true })),
    }));
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 0, clientY: 0 });
    render(<EdgeContextMenu />);
    const menu = screen.getByRole("menu", { name: "Edge actions" });
    for (const button of menu.querySelectorAll("button")) {
      expect(button.getAttribute("role")).toMatch(/^menuitem/);
    }
    // a right-click does not take the focus
    expect(menu).not.toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("menuitem", { name: "Default color" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: `Color ${PALETTE_COLORS[0]}` })).toBeTruthy();
    // the line's shape is a choice of three, the current one ticked
    expect(screen.getAllByRole("menuitemradio").map((b) => b.getAttribute("aria-checked"))).toEqual(
      ["true", "false", "false"],
    );

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Default color");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focused()).toBe("SVG image (cropped), selection only");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(useCanvasUiStore.getState().edgeMenu).toBeNull();
  });
});
