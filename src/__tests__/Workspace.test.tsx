import { invoke } from "@tauri-apps/api/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "../App";
import { useChatStore } from "../features/ai/chatStore";
import { openDocument, resetTabsForTests } from "../features/library/tabActions";
import { makeDoc, makeNode } from "../shared/lib/__tests__/testFixtures";
import { EDITOR_TOAST_BOTTOM, TOAST_BOTTOM } from "../shared/lib/editorLayout";
import { useDiagramStore } from "../shared/lib/store";

// jsdom has no Element.scrollTo; the open chat panel autoscrolls its messages
Element.prototype.scrollTo = vi.fn();

const renderWorkspace = () =>
  render(
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>,
  );
const column = () => document.querySelector("[data-editor-canvas]") as HTMLElement;
const rootStyle = () => document.documentElement.style;
/** classes that start a stacking context of their own */
const STARTS_STACKING = /(^|\s)(isolate|z-\S+|transform|-?translate-\S+|opacity-\S+)(\s|$)/;

/**
 * The editor's sheet (#219 D1): the toolbar row on top, then the body — the
 * canvas column with its islands, and the docked side panel beside it.
 */
describe("Workspace — skeleton of the editing screen (#219 D1·D10·D11·D17, T30)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockResolvedValue(undefined);
    resetTabsForTests();
    openDocument(makeDoc([makeNode({ id: "a" })], [], "Orders"), { projectId: "p1" });
    useChatStore.setState({ open: false, view: "chat", width: 320, messages: [], busy: false });
  });

  it("toolbar row → body [canvas column │ aside when open] — the canvas column is not a tabpanel (#229 T45)", () => {
    const { container } = renderWorkspace();
    const root = container.firstElementChild as HTMLElement;
    const [row, body] = [...root.children] as HTMLElement[];
    expect(within(row!).getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(within(row!).queryByRole("tablist")).toBeNull();
    expect(within(row!).getByRole("toolbar", { name: "Diagram actions" })).toBeInTheDocument();
    expect(body!.firstElementChild).toBe(column());
    // one canvas: the document tab's tabpanel holds the sheet, the column is no panel of its own
    expect(column()).not.toHaveAttribute("role");
    expect(column()).not.toHaveAttribute("aria-labelledby");
    expect(document.getElementById("page-canvas")).toBeNull();
    expect(body!.querySelector("aside")).toBeNull();

    act(() => useChatStore.setState({ open: true }));
    expect(body!.lastElementChild).toBe(screen.getByRole("complementary", { name: "Assistant" }));
    expect(body!.children).toHaveLength(2);
  });

  it("The canvas column holds React Flow, the shape bar and the zoom island — the island is outside the viewport, with no minimap or default controls", () => {
    renderWorkspace();
    const flow = column().querySelector(".react-flow");
    expect(flow).not.toBeNull();
    const shapes = within(column()).getByRole("toolbar", { name: "Shapes" });
    const zoom = within(column()).getByRole("group", { name: "Zoom" });
    const viewport = column().querySelector(".react-flow__viewport");
    expect(viewport?.contains(shapes)).toBe(false);
    expect(viewport?.contains(zoom)).toBe(false);
    expect(document.querySelector(".react-flow__minimap")).toBeNull();
    expect(document.querySelector(".react-flow__controls")).toBeNull();
  });

  it("All islands are .nodelete — Backspace on a focused button does not delete the selection (#219)", () => {
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    renderWorkspace();
    expect(within(column()).getByRole("toolbar", { name: "Shapes" })).toHaveClass("nodelete");
    expect(within(column()).getByRole("group", { name: "Zoom" })).toHaveClass("nodelete");
    expect(within(column()).getByRole("toolbar", { name: "Edit selection" })).toHaveClass(
      "nodelete",
    );
  });

  it("Layers — shape bar z-10, edit bar and zoom island z-30 (island behind), panel z-[35]; the canvas column creates no stacking context (D17, #219)", () => {
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    useChatStore.setState({ open: true });
    renderWorkspace();
    expect(screen.getByRole("toolbar", { name: "Shapes" })).toHaveClass("z-10");
    // the bar's layer, after it: a bar raised onto the row above the island
    // never hides the island's tooltips (#219) — the two never overlap
    const zoom = screen.getByRole("group", { name: "Zoom" });
    const bar = screen.getByRole("toolbar", { name: "Edit selection" });
    expect(zoom).toHaveClass("z-30");
    expect(bar).toHaveClass("z-30");
    expect(bar.compareDocumentPosition(zoom) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("complementary")).toHaveClass("z-[35]");
    expect(column().className).not.toMatch(STARTS_STACKING);
    expect(column().parentElement!.className).not.toMatch(STARTS_STACKING);
  });

  it("In the editor the toast sits on the row above the islands (60) — even with nothing selected (#231 D18)", () => {
    renderWorkspace();
    expect(screen.queryByRole("toolbar", { name: "Edit selection" })).toBeNull();
    // Home's 16 + 44: 8 over the edit bar's top (12 + 40), clear of the zoom island
    expect(rootStyle().getPropertyValue("--dsk-toast-editor-lift")).toBe(
      `${EDITOR_TOAST_BOTTOM - TOAST_BOTTOM}px`,
    );
    expect(EDITOR_TOAST_BOTTOM - TOAST_BOTTOM).toBe(44);
  });

  it("Leaving the editor removes the toast offset variable — so the Home toast is not shifted", () => {
    useDiagramStore.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }));
    useChatStore.setState({ open: true });
    const view = renderWorkspace();
    expect(rootStyle().getPropertyValue("--dsk-toast-right")).toBe("320px");
    expect(rootStyle().getPropertyValue("--dsk-toast-lift")).not.toBe("");
    expect(rootStyle().getPropertyValue("--dsk-toast-editor-lift")).not.toBe("");
    view.unmount();
    expect(rootStyle().getPropertyValue("--dsk-toast-right")).toBe("");
    expect(rootStyle().getPropertyValue("--dsk-toast-lift")).toBe("");
    expect(rootStyle().getPropertyValue("--dsk-toast-editor-lift")).toBe("");
  });

  it("Neither the toolbar row nor the sheet is a window drag region (D21)", () => {
    const { container } = renderWorkspace();
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
  });
});
