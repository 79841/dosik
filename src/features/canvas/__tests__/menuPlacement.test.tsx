import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeEdge, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { POPUP_MARGIN } from "../../../shared/lib/usePopupPosition";
import { useCanvasUiStore } from "../canvasUiStore";
import { DropNodeMenu } from "../DropNodeMenu";
import { EdgeContextMenu } from "../EdgeContextMenu";
import { NodeContextMenu } from "../NodeContextMenu";

/**
 * #142 — checks that all three cursor-anchored menus go through the placement hook. The hook
 * itself is pinned by usePopupPosition.test; this pins the wiring: if someone reverts a menu
 * to `style={{ left: clientX, top: clientY }}`, this test breaks.
 * The defect only shows when right-clicking near a window corner, which can't be automated here.
 */
const W = 200;
const H = 300;

const fixViewport = () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: W,
    height: H,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: W,
    bottom: H,
    toJSON: () => ({}),
  });
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
};

/** the popup: the fixed container each menu renders */
const popup = (container: HTMLElement) => container.querySelector<HTMLElement>("div.fixed");

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
  useCanvasUiStore.getState().setEdgeMenu(null);
  useCanvasUiStore.getState().setNodeMenu(null);
  useCanvasUiStore.getState().setDropMenu(null);
  fixViewport();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("menus opened in a corner flip back inside the window (#142)", () => {
  it("edge menu", () => {
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 950, clientY: 760 });
    const { container } = render(<EdgeContextMenu />);
    expect(popup(container)?.style.left).toBe(`${950 - W}px`);
    expect(popup(container)?.style.top).toBe(`${760 - H}px`);
  });

  it("shape menu", () => {
    useDiagramStore.getState().selectForContextMenu("a");
    useCanvasUiStore.getState().setNodeMenu({ nodeId: "a", clientX: 950, clientY: 760 });
    const { container } = render(<NodeContextMenu />);
    expect(popup(container)?.style.left).toBe(`${950 - W}px`);
    expect(popup(container)?.style.top).toBe(`${760 - H}px`);
  });

  it("connection drop menu", () => {
    useCanvasUiStore.getState().setDropMenu({
      fromId: "a",
      fromHandle: "right",
      flowX: 0,
      flowY: 0,
      clientX: 950,
      clientY: 760,
    });
    const { container } = render(<DropNodeMenu />);
    expect(popup(container)?.style.left).toBe(`${950 - W}px`);
    expect(popup(container)?.style.top).toBe(`${760 - H}px`);
  });

  it("lands in place even when the menu state comes first and the content follows — no reliance on store commit order", () => {
    // Menu first, without a selection: the shape menu draws nothing when there is nothing to show
    useCanvasUiStore.getState().setNodeMenu({ nodeId: "a", clientX: 950, clientY: 760 });
    const { container } = render(<NodeContextMenu />);
    expect(popup(container)).toBeNull();
    // It has to re-measure on the render where the late selection commit makes the menu appear
    act(() => useDiagramStore.getState().selectForContextMenu("a"));
    expect(popup(container)?.style.left).toBe(`${950 - W}px`);
    expect(popup(container)?.style.top).toBe(`${760 - H}px`);
  });

  it("re-places the menu when the window shrinks", () => {
    useCanvasUiStore.getState().setEdgeMenu({ edgeId: "e", clientX: 100, clientY: 100 });
    const { container } = render(<EdgeContextMenu />);
    expect(popup(container)?.style.left).toBe("100px");
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(250);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(popup(container)?.style.left).toBe(`${250 - W - POPUP_MARGIN}px`);
  });
});
