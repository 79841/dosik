import { beforeEach, describe, expect, it } from "vitest";

import { useAppStore } from "../../../library/appStore";
import { DASHBOARD } from "../../../library/homeView";
import { useHomeMode } from "../../homeMode";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { folder } from "./boardFixtures";

const store = () => useBoardStore.getState();

describe("board store (#221 D9·D10·D11, T22)", () => {
  beforeEach(() => resetBoardForTests());

  it("the viewport is set once on first draw", () => {
    store().ensureViewport(() => ({ x: 1, y: 2, zoom: 0.7 }));
    store().ensureViewport(() => ({ x: 9, y: 9, zoom: 1 }));
    expect(store().viewport).toEqual({ x: 1, y: 2, zoom: 0.7 });
  });

  it("remembers the previous viewport when entering focus and restores it when going back — moves are transitions", () => {
    store().setViewport({ x: 1, y: 2, zoom: 0.7 });
    expect(store().animate).toBe(false);
    store().focusCamera({ x: 50, y: 50, zoom: 1 });
    expect(store().viewport).toEqual({ x: 50, y: 50, zoom: 1 });
    expect(store().animate).toBe(true);
    store().unfocusCamera();
    expect(store().viewport).toEqual({ x: 1, y: 2, zoom: 0.7 });
    expect(store().beforeFocus).toBeNull();
  });

  it("keeps the first one even when switching to another diagram within focus", () => {
    store().setViewport({ x: 1, y: 2, zoom: 0.7 });
    store().focusCamera({ x: 50, y: 50, zoom: 1 });
    store().focusCamera({ x: 90, y: 90, zoom: 0.8 });
    store().unfocusCamera();
    expect(store().viewport).toEqual({ x: 1, y: 2, zoom: 0.7 });
  });

  it("going back without focus does nothing", () => {
    store().setViewport({ x: 1, y: 2, zoom: 0.7 });
    store().unfocusCamera();
    expect(store().viewport).toEqual({ x: 1, y: 2, zoom: 0.7 });
  });

  it("holds sent positions in the copy and clears them when the list returns the same value", () => {
    store().sent([
      { id: "a", board: { x: 0, y: 0 } },
      { id: "b", board: { x: 40, y: 0, collapsed: true } },
    ]);
    expect(store().overlay).toEqual({ a: { x: 0, y: 0 }, b: { x: 40, y: 0, collapsed: true } });
    // a is listed as sent; b still stale; c was never sent
    store().reconcile([
      folder("a", 1, { board: { x: 0, y: 0 } }),
      folder("b", 1, { board: { x: 40, y: 0 } }),
      folder("c", 1),
    ]);
    expect(store().overlay).toEqual({ b: { x: 40, y: 0, collapsed: true } });
    // a project that is gone takes its entry with it
    store().reconcile([folder("c", 1)]);
    expect(store().overlay).toEqual({});
  });

  it("a failed write drops only that value from the copy — values sent after it stay", () => {
    store().sent([{ id: "a", board: { x: 0, y: 0 } }]);
    store().sent([{ id: "a", board: { x: 20, y: 0 } }]);
    store().unsent([{ id: "a", board: { x: 0, y: 0 } }]);
    expect(store().overlay).toEqual({ a: { x: 20, y: 0 } });
    store().unsent([{ id: "a", board: { x: 20, y: 0 } }]);
    expect(store().overlay).toEqual({});
  });

  it("remembers ids whose auto write failed for the session", () => {
    store().markFailed(["a", "b"]);
    store().markFailed(["b", "c"]);
    expect([...store().failed].sort()).toEqual(["a", "b", "c"]);
  });

  it("only one menu — opens and closes", () => {
    store().openMenu({ kind: "canvas", at: { x: 1, y: 2 }, board: { x: 10, y: 20 } });
    expect(store().menu?.kind).toBe("canvas");
    store().openMenu({ kind: "project", folder: "a", at: { x: 0, y: 0 }, from: "frame:a" });
    expect(store().menu).toMatchObject({ kind: "project", folder: "a" });
    store().closeMenu();
    expect(store().menu).toBeNull();
  });
});

/**
 * A name field open on the board goes with the screen (#231 D8·D13) — the request's rule (C1): a field taken off the page sends no
 * blur, so nothing else would end the rename.
 */
describe("the name field goes with the screen — renaming is cleared when the view·tab·Home view·mode changes (#231 D8·D13)", () => {
  beforeEach(() => {
    resetBoardForTests();
    useAppStore.setState({ view: "home", activeTab: null, homeView: DASHBOARD });
    useHomeMode.setState({ mode: "canvas" });
    store().setRenaming("pay");
  });

  it.each<[string, () => void]>([
    [
      "to a document tab (view·tab)",
      () => useAppStore.setState({ view: "editor", activeTab: "t-1" }),
    ],
    ["Home view", () => useAppStore.getState().setHomeView({ kind: "folder", folder: "pay" })],
    ["to Cards (mode)", () => useHomeMode.setState({ mode: "cards" })],
  ])("%s → no renaming", (_, go) => {
    go();
    expect(store().renaming).toBeNull();
  });

  it("re-picking the same view as a new object·the same mode leaves it — a move that only shifts header focus", () => {
    useAppStore.getState().setHomeView({ ...DASHBOARD }, true);
    useHomeMode.setState({ mode: "canvas" });
    useAppStore.setState({ homeFocus: 9 });
    expect(store().renaming).toBe("pay");
  });
});
