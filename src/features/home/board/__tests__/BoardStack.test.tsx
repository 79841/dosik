import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../../library/appStore";
import { DASHBOARD } from "../../../library/homeView";
import type { FolderMeta } from "../../../library/libraryApi";
import { frameLayout } from "../boardGeometry";
import { BoardStack } from "../BoardStack";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { folder } from "./boardFixtures";
import { renderInBoard } from "./boardHarness";

const nav = vi.hoisted(() => ({ openFromLibrary: vi.fn() }));
vi.mock("../../../library/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openFromLibrary: nav.openFromLibrary,
}));
const actions = vi.hoisted(() => ({ setCollapsed: vi.fn(async () => true) }));
vi.mock("../boardActions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setCollapsed: actions.setCollapsed,
}));

const infra = { ...folder("infra", 9), name: "Infrastructure" };
infra.diagrams[0] = { ...infra.diagrams[0]!, updatedAt: Date.now() };
const stackOf = (f: FolderMeta = infra, collapsed?: boolean) => {
  const item = frameLayout(f, collapsed).items[0]!;
  if (item.kind !== "stack") throw new Error("not a stack");
  return item;
};
/** Infrastructure as the canvas draws it: the Pipelines folder first; 5 items, 7 diagrams under it */
const withFolder = (): FolderMeta => {
  const ops = { ...folder("ops", 1), name: "Ops", updatedAt: 400 };
  // the latest edit under the project is in Ops — not the front item
  ops.diagrams[0] = { ...ops.diagrams[0]!, updatedAt: Date.now() - 90_000 };
  return {
    ...folder("inf2", 3),
    name: "Infrastructure",
    updatedAt: 500,
    order: ["folder:pipe", "diagram:inf2-0", "diagram:inf2-1", "diagram:inf2-2", "folder:ops"],
    folders: [{ ...folder("pipe", 3), name: "Pipelines", updatedAt: 400 }, ops],
  };
};

describe("collapsed stack (#221 D6, T34)", () => {
  beforeEach(() => {
    resetBoardForTests();
    actions.setCollapsed.mockClear();
    useAppStore.setState({ homeView: DASHBOARD });
  });

  const stack = () => screen.getByRole("button", { name: /^Infrastructure, \d+ items/ });

  it("front card + two imageless cards behind, '9 items · 9 diagrams', 'Latest: …' (#231 D13)", () => {
    const { container } = renderInBoard(<BoardStack folder={infra} item={stackOf()} />);
    expect(container.querySelectorAll("[data-stack-face]")).toHaveLength(2);
    expect(screen.getByText("9 items · 9 diagrams")).toBeInTheDocument();
    expect(screen.getByText("Latest: just now")).toBeInTheDocument();
    expect(stack()).toHaveAccessibleName("Infrastructure, 9 items, 9 diagrams, latest just now");
    expect(stack()).toHaveAttribute("data-board-key", "stack:infra");
  });

  it("a folder in front shows the folder card face — D in 'N items · D diagrams' is all descendants, Latest is the latest edit among all descendants (#231 D13, T25)", () => {
    const f = withFolder();
    renderInBoard(<BoardStack folder={f} item={stackOf(f, true)} />);
    expect(screen.getByText("5 items · 7 diagrams")).toBeInTheDocument();
    expect(screen.getByText("Latest: 1 min ago")).toBeInTheDocument();
    const front = stack();
    expect(within(front).getByText("Pipelines")).toBeInTheDocument();
    expect(within(front).getByText("3 items")).toBeInTheDocument();
    expect(front.querySelector("[data-folder-well]")).toHaveClass("bg-frame");
    expect(within(front).queryByText("No preview")).toBeNull();
  });

  it("double-pressing a stack with a folder in front goes to that folder view — not open (#231 D13)", () => {
    const f = withFolder();
    renderInBoard(<BoardStack folder={f} item={stackOf(f, true)} />);
    fireEvent.doubleClick(stack());
    expect(nav.openFromLibrary).not.toHaveBeenCalled();
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pipe" });
  });

  it("the stack box is the frame's inner width (304) — face and front card stay at the left 240, the bottom row spans the whole box (#231 D13)", () => {
    const { container } = renderInBoard(<BoardStack folder={infra} item={stackOf()} />);
    const box = stack().parentElement!;
    expect(box).toHaveStyle({ left: "20px", top: "64px", width: "304px" });
    expect(stack()).toHaveClass("left-0", "w-[240px]");
    for (const face of container.querySelectorAll("[data-stack-face]")) {
      expect(face).toHaveClass("w-[240px]");
    }
    const row = screen.getByText("9 items · 9 diagrams").closest("div")!.parentElement!;
    expect(row).toHaveClass("left-0", "right-0");
    expect(row).toContainElement(screen.getByRole("button", { name: "Expand Infrastructure" }));
  });

  it("a two-card stack has one card behind", () => {
    const two = { ...folder("two", 2), name: "Two" };
    const { container } = renderInBoard(<BoardStack folder={two} item={stackOf(two, true)} />);
    expect(container.querySelectorAll("[data-stack-face]")).toHaveLength(1);
  });

  it("the Expand button·Enter·Space save the expansion", () => {
    renderInBoard(<BoardStack folder={infra} item={stackOf()} />);
    const expand = screen.getByRole("button", { name: "Expand Infrastructure" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveAttribute("tabindex", "-1");
    fireEvent.click(expand);
    fireEvent.keyDown(stack(), { key: "Enter" });
    fireEvent.keyDown(stack(), { key: " " });
    expect(actions.setCollapsed).toHaveBeenCalledTimes(3);
    expect(actions.setCollapsed).toHaveBeenCalledWith("infra", false);
  });

  it("a double click opens the front diagram (#229 D18)", () => {
    nav.openFromLibrary.mockClear();
    renderInBoard(<BoardStack folder={infra} item={stackOf()} />);
    fireEvent.doubleClick(stack());
    expect(nav.openFromLibrary).toHaveBeenCalledWith("infra-0");
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
  });

  it("the front card's description is 'Edited …' — no page count", () => {
    renderInBoard(<BoardStack folder={infra} item={stackOf()} />);
    expect(screen.getByText("Edited just now")).toBeInTheDocument();
    expect(screen.queryByText(/\bpages?\b/)).toBeNull();
  });

  it("right click·Shift+F10 opens the project menu", () => {
    renderInBoard(<BoardStack folder={infra} item={stackOf()} />);
    fireEvent.keyDown(stack(), { key: "F10", shiftKey: true });
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "project", folder: "infra" });
    act(() => useBoardStore.getState().closeMenu());
    // 2 right of and below the pointer, as every right-click menu (#230)
    fireEvent.contextMenu(stack(), { clientX: 30, clientY: 40 });
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "project", at: { x: 32, y: 42 } });
  });
});
