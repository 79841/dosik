import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../../library/appStore";
import type { FolderMeta } from "../../../library/libraryApi";
import { useLibraryStore } from "../../../library/libraryStore";
import { resetPreviewCacheForTests } from "../../diagramPreview";
import { type FrameItem, subFrameLayout } from "../boardGeometry";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { FolderFrame } from "../FolderFrame";
import { folder } from "./boardFixtures";
import { fakeApi, renderInBoard } from "./boardHarness";

const nav = vi.hoisted(() => ({ openFromLibrary: vi.fn() }));
vi.mock("../../../library/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openFromLibrary: nav.openFromLibrary,
}));

const mockedInvoke = vi.mocked(invoke);
const now = Date.now();
/** Checkout: Flows (a folder of one), then two diagrams */
const checkout: FolderMeta = {
  ...folder("chk", 2),
  name: "Checkout",
  updatedAt: now,
  order: ["folder:flw", "diagram:chk-0", "diagram:chk-1"],
  folders: [{ ...folder("flw", 1), name: "Flows" }],
};
checkout.diagrams[0] = { ...checkout.diagrams[0]!, title: "Order flow", updatedAt: now };
const pay: FolderMeta = {
  ...folder("pay", 1, { board: { x: 0, y: 0 } }),
  name: "Payments",
  folders: [checkout],
};
const emptyFolder: FolderMeta = { ...folder("emp", 0), name: "New folder", updatedAt: now };

type SubItem = Extract<FrameItem, { kind: "sub" }>;
const placed = (f: FolderMeta, chain: string[] = []): SubItem => ({
  ...subFrameLayout(f, chain),
  x: 20,
  y: 276,
});

const show = (f: FolderMeta = checkout, chain: string[] = []) =>
  renderInBoard(<FolderFrame folder={f} item={placed(f, chain)} project="pay" />, fakeApi([pay]));
const frame = (name = "Checkout") => screen.getByRole("region", { name: new RegExp(`^${name}`) });

describe("subframe — a folder opened in place (#231 D14, Hybrid-Folder-Canvas · Home-States 6)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetPreviewCacheForTests();
    useAppStore.setState({ folderRenameRequest: null });
    useLibraryStore.setState({ folders: [pay], readFailed: false });
    mockedInvoke.mockReset();
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    nav.openFromLibrary.mockClear();
  });

  it("a dashed edge box in place — header FolderOpen 20 + h3 '{name} · {N} items'", () => {
    show();
    const section = frame();
    expect(section).toHaveStyle({ left: "20px", top: "276px", width: "1052px", height: "412px" });
    expect(section.querySelector("rect")).toHaveClass("fill-none", "stroke-edge");
    const heading = within(section).getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent("Checkout · 3 items");
    expect(within(heading).getByText("· 3 items", { exact: false })).toHaveClass("text-muted");
    expect(section).toHaveAccessibleName("Checkout · 3 items");
    const icon = heading.parentElement!.querySelector("svg")!;
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveClass("lucide-folder-open", "text-glyph-folder", "fill-glyph-folder-soft");
  });

  it("the header is canvas × 240/180 — title cell left 20·right 100·icon gap 10, buttons 36×36 (radius 8, glyph 18)·gap 4·top 12·right 12 (Home-States 6)", () => {
    show(emptyFolder);
    const section = frame("New folder");
    const heading = within(section).getByRole("heading", { level: 3 });
    expect(heading).toHaveClass("text-[16px]");
    const title = heading.parentElement!;
    expect(title).toHaveClass("left-5", "right-[100px]", "gap-2.5", "top-3", "h-9");
    expect(title).not.toHaveClass("left-3.5", "right-[78px]", "h-14");
    const tools = section.querySelector("[data-frame-tool]")!;
    expect(tools).toHaveClass("right-3", "top-3", "gap-1");
    for (const name of ["New in New folder", "Collapse New folder"]) {
      const button = within(section).getByRole("button", { name });
      expect(button).toHaveClass("h-9", "w-9", "rounded-[8px]");
      expect(button.querySelector("svg")).toHaveAttribute("width", "18");
    }
  });

  it("bottom row '{N} items · edited {time}' — centered in 68 height, left 16, 15px (canvas 11px × 240/180)", () => {
    show();
    const footer = within(frame()).getByText("3 items · edited just now");
    expect(footer).toHaveClass("text-[15px]", "px-2");
    expect(footer.parentElement).toHaveClass("h-17", "left-4", "items-center");
  });

  it("+ = that folder's New menu — 'New in {name}', for pointers (tabIndex -1), closes on a second press", () => {
    show();
    const plus = within(frame()).getByRole("button", { name: "New in Checkout" });
    expect(plus).toHaveAttribute("tabindex", "-1");
    expect(plus).toHaveAttribute("aria-haspopup", "menu");
    expect(plus).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(plus);
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "new", folder: "chk" });
    expect(plus).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(plus);
    expect(useBoardStore.getState().menu).toBeNull();
  });

  it("Collapse is an icon button — name 'Collapse {folder name}'·tooltip 'Collapse' (like the stack's 'Expand {name}'), aria-expanded, for pointers, pressing closes that folder (#231 D14)", () => {
    const { api } = show();
    const collapse = within(frame()).getByRole("button", { name: "Collapse Checkout" });
    expect(collapse).toHaveAttribute("aria-label", "Collapse Checkout");
    expect(collapse).toHaveAttribute("title", "Collapse");
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveAttribute("tabindex", "-1");
    expect(collapse).toHaveTextContent("");
    expect(collapse.querySelector("svg")).toHaveClass("lucide-minimize-2");
    fireEvent.click(collapse);
    expect(api.leave).toHaveBeenCalledWith("chk");
  });

  it("items inside are large card tiles — folder tiles·diagram tiles, 324×276 (inset 12), well 300×188, board item keys", () => {
    show();
    const flows = within(frame()).getByRole("button", { name: "Flows, folder, 1 item" });
    const order = within(frame()).getByRole("button", { name: /^Order flow, edited/ });
    expect(flows).toHaveAttribute("data-board-key", "folder:flw");
    expect(order).toHaveAttribute("data-board-key", "card:chk-0");
    for (const tile of [flows, order]) {
      expect(tile.parentElement).toHaveClass("h-[276px]", "w-[324px]", "p-3", "rounded-[12px]");
      expect(tile.parentElement).not.toHaveClass("h-[210px]", "w-[240px]", "p-[10px]");
    }
    expect(flows.parentElement).toHaveStyle({ left: "20px", top: "68px" });
    expect(order.parentElement).toHaveStyle({ left: "364px", top: "68px" });
    expect(flows.querySelector("[data-folder-well]")).toHaveClass("h-[188px]", "w-[300px]");
    expect(flows.querySelector("[data-folder-well] svg")).toHaveAttribute("width", "42");
    expect(order.firstElementChild).toHaveClass("h-[188px]", "w-[300px]");
  });

  it("tile name·description rows are × 240/180 too — name 16px at 16 below, description 15px at 4 below", () => {
    show();
    const order = within(frame()).getByRole("button", { name: /^Order flow, edited/ });
    const [, name, meta] = [...order.children];
    expect(name).toHaveTextContent("Order flow");
    expect(name).toHaveClass("mt-4", "text-[16px]", "leading-6");
    expect(meta).toHaveTextContent("Edited just now");
    expect(meta).toHaveClass("mt-1", "h-5", "text-[15px]", "leading-5");
    const flows = within(frame()).getByRole("button", { name: "Flows, folder, 1 item" });
    expect(flows.children[1]).toHaveClass("mt-4", "text-[16px]");
    expect(flows.children[2]).toHaveClass("h-5", "text-[15px]");
  });

  it("a tile's Open pill sits bottom center of the well as drawn — frame cards have it top right", () => {
    show();
    const pill = within(frame()).getByRole("button", { name: "Open Order flow" });
    // the canvas's 116 × 240/180: 10 above the bottom of the 188 well
    expect(pill).toHaveClass("left-1/2", "-translate-x-1/2", "top-[156px]");
    expect(pill).toHaveAttribute("tabindex", "-1");
    fireEvent.click(pill);
    expect(nav.openFromLibrary).toHaveBeenCalledWith("chk-0");
  });

  it("tiles behave the same — double-clicking a diagram = open in a tab, double-clicking a folder = open in place", () => {
    show();
    fireEvent.doubleClick(within(frame()).getByRole("button", { name: /^Order flow, edited/ }));
    expect(nav.openFromLibrary).toHaveBeenCalledWith("chk-0");
    fireEvent.doubleClick(within(frame()).getByRole("button", { name: /^Flows, folder/ }));
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "flw" });
  });

  it("a folder just created here via New folder → its tile is the name input", () => {
    show();
    act(() => useAppStore.getState().requestFolderRename("flw"));
    expect(within(frame()).getByRole("textbox", { name: "Folder name" })).toHaveFocus();
    expect(useBoardStore.getState().renaming).toBe("flw");
  });

  it("empty folder: 'No folders or diagrams yet' in a single tile slot, 364×412, bottom '0 items · edited …'", () => {
    show(emptyFolder);
    const section = frame("New folder");
    expect(section).toHaveStyle({ width: "364px", height: "412px" });
    const message = within(section).getByText("No folders or diagrams yet");
    expect(message).toHaveStyle({ left: "20px", top: "68px", width: "324px", height: "276px" });
    expect(message).toHaveClass("bg-hover", "text-muted", "text-[15px]");
    expect(within(section).getByText("0 items · edited just now")).toBeInTheDocument();
    expect(
      within(section).getByRole("button", { name: "Collapse New folder" }),
    ).toBeInTheDocument();
  });

  it("nesting: an open child folder becomes a subframe inside this one", () => {
    show(checkout, ["flw"]);
    const inner = frame("Flows");
    expect(frame()).toContainElement(inner);
    expect(within(frame()).queryByRole("button", { name: /^Flows, folder/ })).toBeNull();
    // each sub-frame's Collapse says whose it is — the outer one's and the inner one's differ
    expect(within(inner).getByRole("button", { name: "Collapse Flows" })).toBeInTheDocument();
    expect(within(frame()).getByRole("button", { name: "Collapse Checkout" })).toBeInTheDocument();
  });

  it("drop target styling when a dragged card can drop into this folder — fill-hover stroke-ink", () => {
    show();
    act(() =>
      useBoardStore.getState().setDrag({
        kind: "card",
        item: "diagram:pay-0",
        from: "pay",
        dx: 0,
        dy: 0,
        target: "chk",
      }),
    );
    expect(frame()).toHaveAttribute("data-drop-target");
    expect(frame().querySelector("rect")).toHaveClass("fill-hover", "stroke-ink");
  });
});
