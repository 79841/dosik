import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { ShapePalette } from "../../palette/ShapePalette";
import { handleCanvasKeyDown } from "../canvasKeymap";
import { useCanvasUiStore } from "../canvasUiStore";
import { DropNodeMenu } from "../DropNodeMenu";
import { EdgeContextMenu } from "../EdgeContextMenu";
import { NodeContextMenu } from "../NodeContextMenu";
import { openSelectionMenuFromKeyboard } from "../selectionMenu";

/**
 * Backspace with the keyboard on a control over the canvas — an island's
 * button, a flyout's or a menu's item — is that control's, not the canvas
 * selection's. The zoom island, the edit bar and the toolbar row were
 * `.nodelete`; the shape strip and the canvas's popups were not, so the
 * key deleted what was picked (#219).
 */
describe("Backspace pressed in islands and popups over the canvas does not delete the selection (#219)", () => {
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
    useDiagramStore.setState((s) => ({
      nodes: s.nodes.map((n) => ({ ...n, selected: true })),
      edges: s.edges.map((e) => ({ ...e, selected: true })),
    }));
    window.addEventListener("keydown", handleCanvasKeyDown);
  });
  afterEach(() => {
    window.removeEventListener("keydown", handleCanvasKeyDown);
    const ui = useCanvasUiStore.getState();
    ui.setNodeMenu(null);
    ui.setEdgeMenu(null);
    ui.setDropMenu(null);
  });

  const nothingDeleted = () => {
    const { nodes, edges } = useDiagramStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(edges.map((e) => e.id)).toEqual(["e"]);
  };

  it("shape bar buttons", async () => {
    const user = userEvent.setup();
    render(
      <ReactFlowProvider>
        <ShapePalette />
      </ReactFlowProvider>,
    );
    expect(screen.getByRole("toolbar", { name: "Shapes" })).toHaveClass("nodelete");
    screen.getByRole("button", { name: "Flowchart" }).focus();
    await user.keyboard("{Backspace}");
    nothingDeleted();
  });

  it("shape bar flyout items — inside the bar, so covered along with it", async () => {
    const user = userEvent.setup();
    render(
      <ReactFlowProvider>
        <ShapePalette />
      </ReactFlowProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Flowchart" }));
    screen.getByRole("menu", { name: "Flowchart" }).querySelector<HTMLElement>("button")!.focus();
    await user.keyboard("{Backspace}");
    nothingDeleted();
  });

  it("items in a shape menu opened with the keyboard", async () => {
    const user = userEvent.setup();
    expect(openSelectionMenuFromKeyboard()).toBe(true);
    render(<NodeContextMenu />);
    const menu = screen.getByRole("menu", { name: "Shape actions" });
    await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{Backspace}");
    nothingDeleted();
  });

  it("edge menu items", async () => {
    const user = userEvent.setup();
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 10, clientY: 20 });
    render(<EdgeContextMenu />);
    screen
      .getByRole("menu", { name: "Edge actions" })
      .querySelector<HTMLElement>("button")!
      .focus();
    await user.keyboard("{Backspace}");
    nothingDeleted();
  });

  it("the shape picker for a connection dropped on empty canvas", async () => {
    const user = userEvent.setup();
    useCanvasUiStore.getState().setDropMenu({
      fromId: "a",
      fromHandle: "right",
      flowX: 200,
      flowY: 100,
      clientX: 400,
      clientY: 300,
    });
    const { container } = render(<DropNodeMenu />);
    container.querySelector<HTMLElement>("button")!.focus();
    await user.keyboard("{Backspace}");
    nothingDeleted();
  });
});
