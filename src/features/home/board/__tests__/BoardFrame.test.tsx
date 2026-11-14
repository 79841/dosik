import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { badgeColour } from "../../../../shared/lib/projectBadge";
import { badgeIn } from "../../../../test/badges";
import { useAppStore } from "../../../library/appStore";
import { DASHBOARD } from "../../../library/homeView";
import type { FolderMeta } from "../../../library/libraryApi";
import { useLibraryStore } from "../../../library/libraryStore";
import { BoardFrame } from "../BoardFrame";
import { effectiveBoards, persistentLayout, renderLayout } from "../boardLayout";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { toWorld } from "../boardViewport";
import { folder } from "./boardFixtures";
import { fakeApi, renderInBoard } from "./boardHarness";

const nav = vi.hoisted(() => ({ newDiagram: vi.fn() }));
vi.mock("../../../library/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  newDiagram: nav.newDiagram,
}));
const actions = vi.hoisted(() => ({ dropFrame: vi.fn(async () => true) }));
vi.mock("../boardActions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  dropFrame: actions.dropFrame,
}));

const mockedInvoke = vi.mocked(invoke);
const payments: FolderMeta = { ...folder("pay", 3, { board: { x: 40, y: 80 } }), name: "Payments" };
const strayFolder: FolderMeta = {
  ...folder("my-diagrams", 1, { stray: true }),
  name: "My Diagrams",
};
const frameOf = (f: FolderMeta, folders: FolderMeta[] = [f]) =>
  persistentLayout(folders, effectiveBoards(folders, {}), {}).byId.get(f.id)!;
const nameButton = () => screen.getByRole("button", { name: /^Payments, 3 items/ });

const show = (f: FolderMeta = payments) =>
  renderInBoard(<BoardFrame frame={frameOf(f)} />, fakeApi([f]));

describe("project frame (#221 D12·D14·D15, T33)", () => {
  beforeEach(() => {
    resetBoardForTests();
    useAppStore.setState({ homeView: DASHBOARD });
    useLibraryStore.setState({ folders: [payments], readFailed: false });
    mockedInvoke.mockReset();
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    nav.newDiagram.mockClear();
    actions.dropFrame.mockClear();
  });

  it("header: h2 name button '{name}, {N} items', F2·Shift+F10, count (#231 D13)", () => {
    show();
    const section = screen.getByRole("region", { name: "Payments" });
    expect(
      within(section).getByRole("heading", { level: 2, name: /Payments/ }),
    ).toBeInTheDocument();
    expect(nameButton()).toHaveAttribute("aria-keyshortcuts", "F2 Shift+F10");
    expect(nameButton()).toHaveAttribute("data-board-key", "frame:pay");
    expect(within(section).getByText("3")).toBeInTheDocument();
    // no project dot in the head (#229 D19)
    expect(section.querySelector(".bg-project-grey")).toBeNull();
  });

  it("a board-scale 20px badge before the header name — collapsed stacks·stray too, even while renaming (#236 R4, T15)", () => {
    const { unmount } = show();
    const heading = screen.getByRole("heading", { level: 2, name: /Payments/ });
    const badge = badgeIn(heading.parentElement!)!;
    expect(badge).toBe(heading.previousElementSibling);
    expect(badge).toHaveTextContent("P");
    expect(badge).toHaveClass(`bg-badge-${badgeColour("pay")}-soft`, "h-5", "w-5", "text-[12px]");
    // the name the frame is read by stays the name alone
    expect(screen.getByRole("region", { name: "Payments" })).toBeInTheDocument();
    fireEvent.keyDown(nameButton(), { key: "F2" });
    expect(badgeIn(heading.parentElement!)).toBe(badge);
    unmount();
    const infra = { ...folder("infra", 9, { board: { x: 0, y: 0 } }), name: "Infra" };
    const collapsed = renderInBoard(<BoardFrame frame={frameOf(infra)} />, fakeApi([infra]));
    expect(badgeIn(screen.getByRole("heading", { level: 2 }).parentElement!)).toHaveTextContent(
      "I",
    );
    collapsed.unmount();
    renderInBoard(<BoardFrame frame={frameOf(strayFolder)} />, fakeApi([strayFolder]));
    expect(badgeIn(screen.getByRole("heading", { level: 2 }).parentElement!)).toHaveTextContent(
      "M",
    );
  });

  it("a collapsed project has ', collapsed' in its name", () => {
    const infra = { ...folder("infra", 9, { board: { x: 0, y: 0 } }), name: "Infra" };
    renderInBoard(<BoardFrame frame={frameOf(infra)} />, fakeApi([infra]));
    expect(screen.getByRole("button", { name: "Infra, 9 items, collapsed" })).toBeInTheDocument();
  });

  it("Enter·Space·click → project focus", () => {
    show();
    fireEvent.keyDown(nameButton(), { key: "Enter" });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
    useAppStore.setState({ homeView: DASHBOARD });
    fireEvent.click(nameButton(), { detail: 1 });
    expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "pay" });
  });

  it("F2 → name input: Enter saves, Escape leaves it, blur only once", () => {
    show();
    fireEvent.keyDown(nameButton(), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(input, { target: { value: "Billing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    const renames = () => mockedInvoke.mock.calls.filter(([c]) => c === "rename_folder");
    expect(renames()).toEqual([["rename_folder", { id: "pay", name: "Billing" }]]);
    expect(useBoardStore.getState().renaming).toBeNull();
    act(() => useBoardStore.getState().setRenaming("pay"));
    const again = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(again, { target: { value: "Nope" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(renames()).toHaveLength(1);
  });

  it("+ → New menu (board menu 'new', right-aligned below the button), closes on a second press — does not create an empty diagram right away (#231 D13, T27)", () => {
    show();
    const plus = screen.getByRole("button", { name: "New in Payments" });
    expect(plus).toHaveAttribute("tabindex", "-1");
    expect(plus).toHaveAttribute("aria-haspopup", "menu");
    expect(plus).toHaveAttribute("aria-expanded", "false");
    plus.getBoundingClientRect = () => ({ right: 700, bottom: 60 }) as DOMRect;
    fireEvent.click(plus);
    expect(nav.newDiagram).not.toHaveBeenCalled();
    expect(useBoardStore.getState().menu).toMatchObject({
      kind: "new",
      folder: "pay",
      from: "frame:pay",
      at: { x: 700 - 184, y: 64 },
    });
    expect(plus).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(plus);
    expect(useBoardStore.getState().menu).toBeNull();
  });

  it("⋯ → project menu — not a tab stop", () => {
    show();
    const more = screen.getByRole("button", { name: "More for Payments" });
    expect(more).toHaveAttribute("tabindex", "-1");
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(more);
    expect(useBoardStore.getState().menu).toMatchObject({
      kind: "project",
      folder: "pay",
      from: "frame:pay",
    });
    act(() => useBoardStore.getState().closeMenu());
    fireEvent.keyDown(nameButton(), { key: "F10", shiftKey: true });
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "project", folder: "pay" });
    act(() => useBoardStore.getState().closeMenu());
    // a right-click: 2 right of and below the pointer, as every right-click menu (#230)
    fireEvent.contextMenu(nameButton(), { clientX: 30, clientY: 40 });
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "project", at: { x: 32, y: 42 } });
  });

  it("the ⋯ menu aligns its right edge to the button's right — menu width 184 (#230)", () => {
    show();
    const more = screen.getByRole("button", { name: "More for Payments" });
    more.getBoundingClientRect = () => ({ right: 800, bottom: 100 }) as DOMRect;
    fireEvent.click(more);
    expect(useBoardStore.getState().menu).toMatchObject({ at: { x: 800 - 184, y: 104 } });
  });

  it("stray: no +·⋯, no menu — does not announce F2·Shift+F10 it does not handle (#221)", () => {
    renderInBoard(<BoardFrame frame={frameOf(strayFolder)} />, fakeApi([strayFolder]));
    expect(screen.queryByRole("button", { name: /New in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /More for/ })).toBeNull();
    const name = screen.getByRole("button", { name: /^My Diagrams/ });
    expect(name).not.toHaveAttribute("aria-keyshortcuts");
    fireEvent.keyDown(name, { key: "F10", shiftKey: true });
    fireEvent.contextMenu(name);
    expect(useBoardStore.getState().menu).toBeNull();
  });

  it("drop target styling when a card aims at this frame — fill-hover stroke-ink as before (#231 D15)", () => {
    const { container } = show();
    expect(container.querySelector("[data-drop-target]")).toBeNull();
    act(() =>
      useBoardStore
        .getState()
        .setDrag({ kind: "card", item: "folder:x", from: "q", dx: 0, dy: 0, target: "pay" }),
    );
    expect(container.querySelector("[data-drop-target]")).not.toBeNull();
    expect(container.querySelector("rect")).toHaveClass("fill-hover", "stroke-ink");
  });

  it("empty project: 'No folders or diagrams yet' — a text cell on a hover background (#231 D13, T25)", () => {
    const empty = { ...folder("emp", 0, { board: { x: 0, y: 0 } }), name: "Empty" };
    renderInBoard(<BoardFrame frame={frameOf(empty)} />, fakeApi([empty]));
    expect(screen.getByRole("button", { name: "Empty, 0 items" })).toBeInTheDocument();
    const text = screen.getByText("No folders or diagrams yet");
    expect(text.closest("[data-frame-empty]")).toHaveClass("bg-hover", "rounded-[8px]");
    expect(screen.queryByText("No diagrams yet")).toBeNull();
  });

  it("direct child folders as folder cards, in sidebar order — no flattened nested diagrams (#231 D13, T25)", () => {
    const nested: FolderMeta = {
      ...payments,
      order: ["diagram:pay-1", "folder:chk", "diagram:pay-0", "diagram:pay-2"],
      folders: [{ ...folder("chk", 2), name: "Checkout" }],
    };
    useLibraryStore.setState({ folders: [nested] });
    renderInBoard(<BoardFrame frame={frameOf(nested)} />, fakeApi([nested]));
    expect(screen.getByRole("button", { name: /^Payments, 4 items/ })).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Payments" });
    expect(within(section).getByText("4")).toBeInTheDocument();
    expect(
      [...section.querySelectorAll("[data-board-key]")].map((el) =>
        el.getAttribute("data-board-key"),
      ),
    ).toEqual(["frame:pay", "card:pay-1", "folder:chk", "card:pay-0", "card:pay-2"]);
    expect(screen.getByRole("button", { name: "Checkout, folder, 2 items" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^CHK- 0/ })).toBeNull();
  });

  it("opening one folder in a collapsed project keeps the header and stack counts on the same basis — the project's item count (#231 D13)", () => {
    const nested: FolderMeta = {
      ...folder("pay", 2, { board: { x: 0, y: 0, collapsed: true } }),
      name: "Payments",
      folders: [
        { ...folder("chk", 3), name: "Checkout" },
        { ...folder("arc", 0), name: "Archive" },
      ],
    };
    useLibraryStore.setState({ folders: [nested] });
    const kept = persistentLayout([nested], effectiveBoards([nested], {}), {});
    const frame = renderLayout(kept, "chk").byId.get("pay")!;
    renderInBoard(<BoardFrame frame={frame} />, fakeApi([nested]));
    const section = screen.getByRole("region", { name: "Payments" });
    expect(within(section).getByRole("region", { name: "Checkout · 3 items" })).toBeInTheDocument();
    // the header: four items; the stack — the three left — says four too, with every diagram under it
    expect(
      screen.getByRole("button", { name: "Payments, 4 items, collapsed" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("4")).toBeInTheDocument();
    expect(within(section).getByText("4 items · 5 diagrams")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Payments, 4 items, 5 diagrams, latest/ }),
    ).toBeInTheDocument();
  });

  it("opening a folder in a collapsed pair and drawing the rest as cards drops ', collapsed' from the name — as drawn (#231 D13)", () => {
    const two: FolderMeta = {
      ...folder("pay", 1, { board: { x: 0, y: 0, collapsed: true } }),
      name: "Payments",
      folders: [{ ...folder("chk", 3), name: "Checkout" }],
    };
    useLibraryStore.setState({ folders: [two] });
    const kept = persistentLayout([two], effectiveBoards([two], {}), {});
    const { unmount } = renderInBoard(
      <BoardFrame frame={renderLayout(kept, "chk").byId.get("pay")!} />,
      fakeApi([two]),
    );
    expect(screen.getByRole("button", { name: "Payments, 2 items" })).toBeInTheDocument();
    unmount();
    // closed, it is a stack of two again — collapsed
    renderInBoard(<BoardFrame frame={kept.byId.get("pay")!} />, fakeApi([two]));
    expect(
      screen.getByRole("button", { name: "Payments, 2 items, collapsed" }),
    ).toBeInTheDocument();
  });

  it("dragging and dropping the header calls dropFrame (that spot) — Esc cancels", () => {
    show();
    const head = nameButton();
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
    expect(useBoardStore.getState().drag).toMatchObject({
      kind: "frame",
      id: "pay",
      dx: 50,
      dy: 30,
    });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 130 });
    expect(actions.dropFrame).toHaveBeenCalledWith("pay", { x: 90, y: 110 });
    // the click that follows a drag is not a focus
    fireEvent.click(head, { detail: 1 });
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    fireEvent.pointerDown(head, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 130 });
    expect(actions.dropFrame).toHaveBeenCalledTimes(1);
    expect(useBoardStore.getState().drag).toBeNull();
  });

  it("even if the frame shifts aside mid-drag, the drop spot is the current spot + the drag distance (#221)", () => {
    const moved = { ...payments, board: { x: 240, y: 80 } };
    let kept = [payments];
    renderInBoard(
      <BoardFrame frame={frameOf(payments)} />,
      fakeApi([payments], {
        layout: () => persistentLayout(kept, effectiveBoards(kept, {}), {}),
      }),
    );
    fireEvent.pointerDown(nameButton(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
    // a listing lands mid-drag and the frame is settled elsewhere
    kept = [moved];
    fireEvent.pointerUp(window, { clientX: 150, clientY: 130 });
    expect(actions.dropFrame).toHaveBeenCalledWith("pay", { x: 290, y: 110 });
  });

  it("if the wheel moves the board mid-drag, the frame follows the pointer (#221)", () => {
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    renderInBoard(
      <BoardFrame frame={frameOf(payments)} />,
      fakeApi([payments], {
        toBoard: (client) => toWorld(useBoardStore.getState().viewport!, client),
      }),
    );
    fireEvent.pointerDown(nameButton(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
    expect(useBoardStore.getState().drag).toMatchObject({ dx: 50, dy: 30 });
    act(() => useBoardStore.getState().setViewport({ x: -100, y: 0, zoom: 1 }));
    expect(useBoardStore.getState().drag).toMatchObject({ dx: 150, dy: 30 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 130 });
    expect(actions.dropFrame).toHaveBeenCalledWith("pay", { x: 190, y: 110 });
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    expect(useBoardStore.getState().drag).toBeNull();
  });

  it("if the frame unmounts mid-drag (delete·view switch), removes window listeners and clears the drag (#221)", () => {
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    const view = show();
    fireEvent.pointerDown(nameButton(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
    expect(useBoardStore.getState().drag).toMatchObject({ kind: "frame", id: "pay" });
    const removed = vi.spyOn(window, "removeEventListener");
    view.unmount();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointermove", "pointerup"]),
    );
    removed.mockRestore();
    expect(useBoardStore.getState().drag).toBeNull();
    fireEvent.pointerMove(window, { clientX: 200, clientY: 160 });
    act(() => useBoardStore.getState().setViewport({ x: -100, y: 0, zoom: 1 }));
    fireEvent.pointerUp(window, { clientX: 200, clientY: 160 });
    expect(useBoardStore.getState().drag).toBeNull();
    expect(actions.dropFrame).not.toHaveBeenCalled();
  });

  it("stray cannot be dragged", () => {
    renderInBoard(<BoardFrame frame={frameOf(strayFolder)} />, fakeApi([strayFolder]));
    const name = screen.getByRole("button", { name: /^My Diagrams/ });
    fireEvent.pointerDown(name, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
    expect(useBoardStore.getState().drag).toBeNull();
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 });
  });
});
