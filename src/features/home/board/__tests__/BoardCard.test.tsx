import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../../library/appStore";
import { DASHBOARD } from "../../../library/homeView";
import { resetPreviewCacheForTests } from "../../diagramPreview";
import { BoardCard } from "../BoardCard";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { toWorld } from "../boardViewport";
import { folder } from "./boardFixtures";
import { fakeApi, renderInBoard } from "./boardHarness";

const nav = vi.hoisted(() => ({ openFromLibrary: vi.fn() }));
vi.mock("../../../library/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openFromLibrary: nav.openFromLibrary,
}));
const actions = vi.hoisted(() => ({ moveCardInto: vi.fn(async () => true) }));
vi.mock("../boardActions", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  moveCardInto: actions.moveCardInto,
}));

const mockedInvoke = vi.mocked(invoke);
const a = folder("a", 2, { board: { x: 0, y: 0 } });
const b = folder("b", 1, { board: { x: 0, y: 400 } });
const diagram = {
  ...a.diagrams[0]!,
  title: "Checkout",
  readable: true,
  updatedAt: Date.now(),
};
const card = () => screen.getByRole("button", { name: /^Checkout,/ });

const show = (over: Partial<Parameters<typeof BoardCard>[0]> = {}) =>
  renderInBoard(
    <BoardCard diagram={diagram} folder="a" x={20} y={64} {...over} />,
    fakeApi([a, b]),
  );

describe("board card (#221 D13·D17·D20, T32)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetPreviewCacheForTests();
    useAppStore.setState({ homeView: DASHBOARD });
    mockedInvoke.mockReset();
    mockedInvoke.mockReturnValue(new Promise(() => {}));
  });

  it("named '{title}, edited {time}' — unreadable when it cannot be read, no page count (#229 D18)", () => {
    show();
    expect(card()).toHaveAccessibleName("Checkout, edited just now");
    expect(screen.getByText("Edited just now")).toBeInTheDocument();
    expect(screen.queryByText(/pages?\b/)).toBeNull();
    expect(card()).toHaveAttribute("data-board-key", "card:a-0");
    show({ diagram: { ...diagram, id: "x", title: "Broken", readable: false } });
    expect(screen.getByRole("button", { name: /^Broken,/ })).toHaveAccessibleName(
      "Broken, unreadable, edited just now",
    );
    expect(screen.getByText("No preview")).toBeInTheDocument();
  });

  it("Enter·Space·double click = open — no pages to expand (#229 D18)", () => {
    show();
    nav.openFromLibrary.mockClear();
    fireEvent.keyDown(card(), { key: "Enter" });
    fireEvent.keyDown(card(), { key: " " });
    fireEvent.doubleClick(card());
    expect(nav.openFromLibrary.mock.calls).toEqual([["a-0"], ["a-0"], ["a-0"]]);
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
  });

  it("a single click only selects — a keyboard-made click (detail 0) is ignored", () => {
    show();
    fireEvent.click(card(), { detail: 0 });
    expect(useBoardStore.getState().current).toBeNull();
    fireEvent.click(card(), { detail: 1 });
    expect(useBoardStore.getState().current).toBe("card:a-0");
    expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
  });

  it("Shift+F10·right click opens the diagram menu", () => {
    show();
    fireEvent.keyDown(card(), { key: "F10", shiftKey: true });
    expect(useBoardStore.getState().menu).toMatchObject({
      kind: "diagram",
      diagram: "a-0",
      from: "card:a-0",
    });
    act(() => useBoardStore.getState().closeMenu());
    fireEvent.contextMenu(card(), { clientX: 30, clientY: 40 });
    // 2 right of and below the pointer, as every right-click menu (#230)
    expect(useBoardStore.getState().menu).toMatchObject({ kind: "diagram", at: { x: 32, y: 42 } });
  });

  it("the Open pill is 'Open {title}', not a tab stop", () => {
    show();
    const open = screen.getByRole("button", { name: "Open Checkout" });
    expect(open).toHaveAttribute("tabindex", "-1");
    fireEvent.click(open);
    expect(nav.openFromLibrary).toHaveBeenCalledWith("a-0");
  });

  it("double-pressing the Open pill opens only once — the second click (detail 2) does not open (#231 D7)", () => {
    nav.openFromLibrary.mockClear();
    show();
    const open = screen.getByRole("button", { name: "Open Checkout" });
    fireEvent.click(open, { detail: 1 });
    fireEvent.click(open, { detail: 2 });
    expect(nav.openFromLibrary).toHaveBeenCalledTimes(1);
  });

  it("roving tab stop — only the current item is 0", () => {
    show();
    expect(card()).toHaveAttribute("tabindex", "-1");
    act(() => useBoardStore.getState().setCurrent("card:a-0"));
    expect(card()).toHaveAttribute("tabindex", "0");
  });

  it("does not request a thumbnail below 40% zoom", () => {
    useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 0.3 });
    show();
    expect(mockedInvoke).not.toHaveBeenCalledWith("load_project", expect.anything());
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 0.7 }));
    expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "a-0" });
  });
});

describe("card drag — dropTarget picks the target, placeItem moves (#221 D13, #231 D15, T31)", () => {
  beforeEach(() => {
    resetBoardForTests();
    actions.moveCardInto.mockClear();
  });

  const press = (x: number, y: number) =>
    fireEvent.pointerDown(card(), { button: 0, clientX: x, clientY: y });
  const moveTo = (x: number, y: number) =>
    fireEvent.pointerMove(window, { clientX: x, clientY: y });
  const release = (x: number, y: number) => fireEvent.pointerUp(window, { clientX: x, clientY: y });

  it("dragging past 4px starts a drag — over another project it is the target, dropping moves", () => {
    show();
    press(30, 70);
    moveTo(32, 71);
    expect(useBoardStore.getState().drag).toBeNull();
    moveTo(60, 500);
    expect(useBoardStore.getState().drag).toMatchObject({
      kind: "card",
      item: "diagram:a-0",
      from: "a",
      dx: 30,
      dy: 430,
      target: "b",
    });
    release(60, 500);
    expect(useBoardStore.getState().drag).toBeNull();
    expect(actions.moveCardInto).toHaveBeenCalledWith("diagram:a-0", "b");
  });

  it("dropping on its own frame·empty space changes nothing", () => {
    show();
    press(30, 70);
    moveTo(100, 100);
    expect(useBoardStore.getState().drag).toMatchObject({ target: null });
    release(100, 100);
    press(30, 70);
    moveTo(3000, 3000);
    release(3000, 3000);
    expect(actions.moveCardInto).not.toHaveBeenCalled();
  });

  it("Esc cancels the drag — back in place, no calls", () => {
    show();
    press(30, 70);
    moveTo(60, 500);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useBoardStore.getState().drag).toBeNull();
    release(60, 500);
    expect(actions.moveCardInto).not.toHaveBeenCalled();
  });

  it("if the card unmounts mid-drag (list refresh·delete·view switch), removes window listeners and clears the drag (#221)", () => {
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    const view = show();
    press(30, 70);
    moveTo(60, 500);
    expect(useBoardStore.getState().drag).toMatchObject({ kind: "card", target: "b" });
    const removed = vi.spyOn(window, "removeEventListener");
    view.unmount();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointermove", "pointerup"]),
    );
    removed.mockRestore();
    // no drop target left lit, and nothing it left behind moves or drops
    expect(useBoardStore.getState().drag).toBeNull();
    moveTo(80, 520);
    act(() => useBoardStore.getState().setViewport({ x: -100, y: 0, zoom: 1 }));
    release(80, 520);
    expect(useBoardStore.getState().drag).toBeNull();
    expect(actions.moveCardInto).not.toHaveBeenCalled();
  });

  it("dropping on an island does not move", () => {
    renderInBoard(
      <BoardCard diagram={diagram} folder="a" x={20} y={64} />,
      fakeApi([a, b], { overIsland: () => true }),
    );
    press(30, 70);
    moveTo(60, 500);
    release(60, 500);
    expect(actions.moveCardInto).not.toHaveBeenCalled();
  });

  it("if the wheel moves the board mid-drag, the card and drop target follow — the pointer stays put (#221)", () => {
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    renderInBoard(
      <BoardCard diagram={diagram} folder="a" x={20} y={64} />,
      // the board's own mapping: the camera as it is now
      fakeApi([a, b], {
        toBoard: (client) => toWorld(useBoardStore.getState().viewport!, client),
      }),
    );
    press(30, 70);
    moveTo(60, 500);
    expect(useBoardStore.getState().drag).toMatchObject({ dy: 430, target: "b" });
    // a wheel pan brings project a back under the still pointer
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 400, zoom: 1 }));
    expect(useBoardStore.getState().drag).toMatchObject({ dx: 30, dy: 30, target: null });
    release(60, 500);
    expect(actions.moveCardInto).not.toHaveBeenCalled();
    // once let go, the camera moving draws no drag again
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
    expect(useBoardStore.getState().drag).toBeNull();
  });
});

describe("board card images only while visible (#221)", () => {
  /** the card's picture box, fired by hand */
  let fire: ((visible: boolean) => void) | null = null;
  class ManualObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe() {
      fire = (visible) =>
        this.callback(
          [{ isIntersecting: visible } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
    }
    disconnect() {
      fire = null;
    }
    unobserve() {}
  }

  beforeEach(() => {
    resetBoardForTests();
    resetPreviewCacheForTests();
    mockedInvoke.mockReset();
    mockedInvoke.mockReturnValue(new Promise(() => {}));
    globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it("a card passed at fit (below 40%) does not request when back at 70% — requests when visible again", () => {
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 0.3 }));
    show();
    act(() => fire?.(true));
    act(() => fire?.(false));
    act(() => useBoardStore.getState().setViewport({ x: 0, y: 0, zoom: 0.7 }));
    expect(mockedInvoke).not.toHaveBeenCalled();
    act(() => fire?.(true));
    expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "a-0" });
  });
});
