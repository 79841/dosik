import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../../library/appStore";
import { DASHBOARD } from "../../../library/homeView";
import type { FolderMeta } from "../../../library/libraryApi";
import { useLibraryStore } from "../../../library/libraryStore";
import { BoardFolderCard } from "../BoardFolderCard";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { folder } from "./boardFixtures";
import { fakeApi, renderInBoard } from "./boardHarness";

const actions = vi.hoisted(() => ({ moveCardInto: vi.fn(async () => true) }));
vi.mock("../boardActions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  moveCardInto: actions.moveCardInto,
}));

const mockedInvoke = vi.mocked(invoke);
const checkout: FolderMeta = {
  ...folder("chk", 2),
  name: "Checkout",
  folders: [{ ...folder("flw", 1), name: "Flows" }],
};
const pay: FolderMeta = {
  ...folder("pay", 1, { board: { x: 0, y: 0 } }),
  name: "Payments",
  folders: [checkout],
};
const onb: FolderMeta = { ...folder("onb", 1, { board: { x: 0, y: 400 } }), name: "Onboarding" };
const card = () => screen.getByRole("button", { name: /^Checkout, folder/ });

const show = (api = fakeApi([pay, onb])) =>
  renderInBoard(<BoardFolderCard folder={checkout} parent="pay" x={20} y={64} />, api);

describe("board folder card (#231 D13, T26)", () => {
  beforeEach(() => {
    resetBoardForTests();
    useAppStore.setState({ homeView: DASHBOARD, homeFocus: 0, folderRenameRequest: null });
    useLibraryStore.setState({ folders: [pay, onb], readFailed: false });
    mockedInvoke.mockReset();
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    actions.moveCardInto.mockClear();
  });

  it("same box as a diagram card — Folder 34 on a 220×120 frame-background well, name 16/600, 'N items' 14 muted", () => {
    show();
    expect(card()).toHaveAccessibleName("Checkout, folder, 3 items");
    expect(card()).toHaveAttribute("data-board-key", "folder:chk");
    const box = card().parentElement!;
    expect(box).toHaveClass(
      "absolute",
      "h-[192px]",
      "w-[240px]",
      "rounded-[12px]",
      "bg-surface",
      "p-[10px]",
      "shadow-raised",
    );
    expect(box).toHaveStyle({ left: "20px", top: "64px" });
    const well = card().querySelector("[data-folder-well]") as HTMLElement;
    expect(well).toHaveClass("h-[120px]", "w-[220px]", "bg-frame");
    const icon = well.querySelector("svg")!;
    // a folder, blue over its tint (#236 R2, T4)
    expect(icon).toHaveClass("text-glyph-folder", "fill-glyph-folder-soft");
    expect(icon).toHaveAttribute("width", "34");
    expect(icon).toHaveAttribute("stroke-width", "1.6");
    expect(within(card()).getByText("Checkout")).toHaveClass("text-[16px]", "font-semibold");
    expect(within(card()).getByText("3 items").parentElement).toHaveClass(
      "text-[14px]",
      "text-muted",
    );
  });

  it("lifts on hover — the diagram card's LIFT", () => {
    show();
    expect(card().parentElement).toHaveClass("hover:-translate-y-1.5", "hover:shadow-lifted");
  });

  it("resting look while the name field is open — no lift or lifted shadow, a double press does not open (Home-States 5, #231 D13·S1)", () => {
    show();
    act(() => useBoardStore.getState().setRenaming("chk"));
    const input = screen.getByRole("textbox", { name: "Folder name" });
    expect(input).toHaveFocus();
    const box = input.closest("[data-board-item]")!;
    expect(box).toHaveClass("shadow-raised");
    for (const lift of [
      "hover:-translate-y-1.5",
      "hover:shadow-lifted",
      "focus-within:-translate-y-1.5",
      "focus-within:shadow-lifted",
    ]) {
      expect(box).not.toHaveClass(lift);
    }
    fireEvent.doubleClick(box.querySelector("[data-folder-well]")!);
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    expect(input).toHaveFocus();
  });

  it("double click·Enter·Space·Open pill → that folder view — navigation within the board, so focus does not move to the header (#221 D2)", () => {
    show();
    const opened = () => {
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
      expect(useAppStore.getState().homeFocus).toBe(0);
      act(() => useAppStore.setState({ homeView: DASHBOARD }));
    };
    fireEvent.doubleClick(card());
    opened();
    fireEvent.keyDown(card(), { key: "Enter" });
    opened();
    fireEvent.keyDown(card(), { key: " " });
    opened();
    const open = screen.getByRole("button", { name: "Open Checkout" });
    expect(open).toHaveAttribute("tabindex", "-1");
    fireEvent.click(open);
    opened();
  });

  it("double-pressing the Open pill opens only once — the second click (detail 2) does not open (#231 D7)", () => {
    show();
    const open = screen.getByRole("button", { name: "Open Checkout" });
    fireEvent.click(open, { detail: 1 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "chk" });
    act(() => useAppStore.setState({ homeView: DASHBOARD }));
    fireEvent.click(open, { detail: 2 });
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
  });

  it("a single click only selects — a keyboard-made click (detail 0) is ignored", () => {
    show();
    fireEvent.click(card(), { detail: 0 });
    expect(useBoardStore.getState().current).toBeNull();
    fireEvent.click(card(), { detail: 1 });
    expect(useBoardStore.getState().current).toBe("folder:chk");
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
  });

  it("roving tab stop — only the current item is 0", () => {
    show();
    expect(card()).toHaveAttribute("tabindex", "-1");
    act(() => useBoardStore.getState().setCurrent("folder:chk"));
    expect(card()).toHaveAttribute("tabindex", "0");
  });

  it("right click·Shift+F10·ContextMenu key → folder menu (board menu 'folder')", () => {
    show();
    fireEvent.keyDown(card(), { key: "F10", shiftKey: true });
    expect(useBoardStore.getState().menu).toMatchObject({
      kind: "folder",
      folder: "chk",
      from: "folder:chk",
    });
    act(() => useBoardStore.getState().closeMenu());
    fireEvent.keyDown(card(), { key: "ContextMenu" });
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "folder", folder: "chk" });
    act(() => useBoardStore.getState().closeMenu());
    // 2 right of and below the pointer, as every right-click menu (#230)
    fireEvent.contextMenu(card(), { clientX: 30, clientY: 40 });
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "folder", at: { x: 32, y: 42 } });
  });

  it("Rename → the name row is a NameInput(board) — Enter saves and focuses the card, Escape leaves it", () => {
    const { api } = show();
    act(() => useBoardStore.getState().setRenaming("chk"));
    const input = screen.getByRole("textbox", { name: "Folder name" });
    expect(input).toHaveClass("h-8", "text-[16px]", "font-semibold");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Checkout");
    // the count stays under it whole — the column does not squeeze it; it
    // runs into the card's bottom padding and the card keeps its box (Home-States 5)
    const count = screen.getByText("3 items");
    expect(count).toHaveClass("flex-none", "mt-[3px]", "leading-[18px]");
    expect(input.parentElement).toHaveClass("flex-none", "mt-1");
    fireEvent.change(input, { target: { value: "Billing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const renames = () => mockedInvoke.mock.calls.filter(([c]) => c === "rename_folder");
    expect(renames()).toEqual([["rename_folder", { id: "chk", name: "Billing" }]]);
    expect(useBoardStore.getState().renaming).toBeNull();
    expect(api.focusItem).toHaveBeenCalledWith("folder:chk");
    act(() => useBoardStore.getState().setRenaming("chk"));
    const again = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(again, { target: { value: "Nope" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(renames()).toHaveLength(1);
  });

  it("finishing by leaving the input does not take focus — leaves it where the user went", () => {
    const { api } = show();
    act(() => useBoardStore.getState().setRenaming("chk"));
    const input = screen.getByRole("textbox", { name: "Folder name" });
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    act(() => elsewhere.focus());
    fireEvent.blur(input);
    expect(api.focusItem).not.toHaveBeenCalled();
    elsewhere.remove();
  });

  it("takes a rename request for this folder (Home's New folder) — only once, others' requests left alone (#231 D8)", () => {
    useAppStore.getState().requestFolderRename("flw");
    const first = show();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest?.id).toBe("flw");
    first.unmount();
    act(() => useAppStore.getState().requestFolderRename("chk"));
    show();
    expect(screen.getByRole("textbox", { name: "Folder name" })).toHaveFocus();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    expect(useBoardStore.getState().renaming).toBe("chk");
    expect(useBoardStore.getState().current).toBe("folder:chk");
  });

  it("takes and discards a request made on another screen — does not open the name field (#231 C1)", () => {
    useAppStore.setState({
      folderRenameRequest: {
        id: "chk",
        asked: { view: "home", activeTab: null, homeView: { kind: "folder", folder: "onb" } },
      },
    });
    show();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
    expect(useBoardStore.getState().renaming).toBeNull();
  });
});

describe("folder card drag (#231 D15, T31)", () => {
  beforeEach(() => {
    resetBoardForTests();
    actions.moveCardInto.mockClear();
  });

  const press = (x: number, y: number) =>
    fireEvent.pointerDown(card(), { button: 0, clientX: x, clientY: y });
  const moveTo = (x: number, y: number) =>
    fireEvent.pointerMove(window, { clientX: x, clientY: y });
  const release = (x: number, y: number) => fireEvent.pointerUp(window, { clientX: x, clientY: y });

  it("dropping on another project's frame takes the placeItem path — that frame is the target while dragging", () => {
    show();
    press(30, 70);
    moveTo(60, 500);
    expect(useBoardStore.getState().drag).toMatchObject({
      kind: "card",
      item: "folder:chk",
      from: "pay",
      dx: 30,
      dy: 430,
      target: "onb",
    });
    expect(card().parentElement).toHaveStyle({ transform: "translate(30px, 430px)" });
    release(60, 500);
    expect(useBoardStore.getState().drag).toBeNull();
    expect(actions.moveCardInto).toHaveBeenCalledWith("folder:chk", "onb");
  });

  it("dropping on the current frame·empty space·an island changes nothing", () => {
    const view = show();
    press(30, 70);
    moveTo(100, 100);
    expect(useBoardStore.getState().drag).toMatchObject({ target: null });
    release(100, 100);
    press(30, 70);
    moveTo(3000, 3000);
    release(3000, 3000);
    view.unmount();
    show(fakeApi([pay, onb], { overIsland: () => true }));
    press(30, 70);
    moveTo(60, 500);
    release(60, 500);
    expect(actions.moveCardInto).not.toHaveBeenCalled();
  });
});
