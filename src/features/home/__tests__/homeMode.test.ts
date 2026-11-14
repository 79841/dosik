import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "../../library/appStore";
import { HOME_KEY, loadHome, saveHome, useCardSize, useHomeMode } from "../homeMode";
import { act, renderHook } from "@testing-library/react";

const loadHomeMode = () => loadHome().mode;

describe("Cards/Canvas persistence (#221 D1, T21)", () => {
  beforeEach(() => {
    localStorage.clear();
    useHomeMode.setState({ mode: "cards", size: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cards by default", () => {
    expect(loadHomeMode()).toBe("cards");
  });

  it("reads the saved value", () => {
    localStorage.setItem(HOME_KEY, JSON.stringify({ v: 1, mode: "canvas" }));
    expect(loadHomeMode()).toBe("canvas");
  });

  it("broken JSON·other version·unknown value → cards, does not throw", () => {
    for (const raw of [
      "{nope",
      JSON.stringify({ v: 2, mode: "canvas" }),
      JSON.stringify({ v: 1, mode: "grid" }),
      "null",
      "[]",
    ]) {
      localStorage.setItem(HOME_KEY, raw);
      expect(loadHomeMode()).toBe("cards");
    }
  });

  it("blocked storage → cards, writing does not throw either", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadHomeMode()).toBe("cards");
    expect(() => saveHome({ mode: "canvas", size: null })).not.toThrow();
    expect(() => useHomeMode.getState().setMode("canvas")).not.toThrow();
    expect(useHomeMode.getState().mode).toBe("canvas");
  });

  it("setMode writes {v:1, mode} on every change", () => {
    useHomeMode.getState().setMode("canvas");
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toEqual({ v: 1, mode: "canvas" });
    useHomeMode.getState().setMode("cards");
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toEqual({ v: 1, mode: "cards" });
  });

  it("holds only the mode and card size — no switch focus flag (#231 D4: the header row does not remount)", () => {
    useHomeMode.getState().setMode("canvas");
    expect(Object.keys(useHomeMode.getState()).sort()).toEqual([
      "mode",
      "setMode",
      "setSize",
      "size",
    ]);
  });

  it("a mode change clears a pending folder rename request — picking the same mode again leaves it (#231 C1)", () => {
    useAppStore.getState().requestFolderRename("f-1");
    useHomeMode.getState().setMode("cards");
    expect(useAppStore.getState().folderRenameRequest?.id).toBe("f-1");
    useHomeMode.getState().setMode("canvas");
    expect(useAppStore.getState().folderRenameRequest).toBeNull();
  });
});

/** the cards' size, kept beside the mode (#236 R5, T12) */
describe("card size persistence (#236)", () => {
  beforeEach(() => {
    localStorage.clear();
    useHomeMode.setState({ mode: "cards", size: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("null if never chosen — a value with only the old {v:1, mode} still reads the mode", () => {
    expect(loadHome()).toEqual({ mode: "cards", size: null });
    localStorage.setItem(HOME_KEY, JSON.stringify({ v: 1, mode: "canvas" }));
    expect(loadHome()).toEqual({ mode: "canvas", size: null });
  });

  it("reads only small·medium·large — an unknown value counts as never chosen, mode unchanged", () => {
    for (const size of ["small", "medium", "large"]) {
      localStorage.setItem(HOME_KEY, JSON.stringify({ v: 1, mode: "canvas", size }));
      expect(loadHome()).toEqual({ mode: "canvas", size });
    }
    for (const size of ["huge", "Small", "", 3, null, true, {}]) {
      localStorage.setItem(HOME_KEY, JSON.stringify({ v: 1, mode: "canvas", size }));
      expect(loadHome()).toEqual({ mode: "canvas", size: null });
    }
  });

  it("does not read the first draft's column count (columns) — only the mode reads, size counts as never chosen", () => {
    localStorage.setItem(HOME_KEY, JSON.stringify({ v: 1, mode: "canvas", columns: 5 }));
    expect(loadHome()).toEqual({ mode: "canvas", size: null });
  });

  it("broken JSON·other version → both defaults", () => {
    for (const raw of ["{nope", JSON.stringify({ v: 2, mode: "canvas", size: "large" })]) {
      localStorage.setItem(HOME_KEY, raw);
      expect(loadHome()).toEqual({ mode: "cards", size: null });
    }
  });

  it("setSize writes along with the mode, and setMode does not clear the size", () => {
    useHomeMode.getState().setSize("large");
    expect(useHomeMode.getState().size).toBe("large");
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toEqual({
      v: 1,
      mode: "cards",
      size: "large",
    });
    useHomeMode.getState().setMode("canvas");
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toEqual({
      v: 1,
      mode: "canvas",
      size: "large",
    });
    useHomeMode.getState().setSize("small");
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toEqual({
      v: 1,
      mode: "canvas",
      size: "small",
    });
  });

  it("blocked storage — the chosen value lasts for this run", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => useHomeMode.getState().setSize("small")).not.toThrow();
    expect(useHomeMode.getState().size).toBe("small");
  });
});

describe("useCardSize — the size every card grid lays out (#236 R5)", () => {
  beforeEach(() => {
    localStorage.clear();
    useHomeMode.setState({ mode: "cards", size: null });
  });

  it("Medium until one is picked, then the pick", () => {
    const size = renderHook(() => useCardSize());
    expect(size.result.current).toBe("medium");
    act(() => useHomeMode.getState().setSize("large"));
    expect(size.result.current).toBe("large");
  });
});
