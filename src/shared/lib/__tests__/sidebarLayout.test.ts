import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DESIGN_TOKENS } from "../../../test/designTokens";
import {
  clampSidebarWidth,
  contentWidth,
  createSidebarStore,
  dockedWidth,
  loadSidebarPrefs,
  resolveEdgeDrag,
  SIDEBAR_HIDE_BELOW,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_WIDTH,
  saveSidebarPrefs,
  useContentWidth,
  useDockedWidth,
  useSidebarStore,
  useVisibleSidebarWidth,
  visibleSidebarWidth,
} from "../sidebarLayout";
import { useToastStore } from "../toastStore";

const KEY = "dosik.sidebar";
const layoutToken = (name: string): number =>
  Number.parseFloat(DESIGN_TOKENS.layout.tokens.find((t) => t.name === name)?.value ?? "NaN");
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;

describe("sidebar width (#217 D17·D18)", () => {
  it("the constants match the design tokens — sidebar-width·min·max (T40)", () => {
    expect(SIDEBAR_WIDTH).toBe(layoutToken("sidebar-width"));
    expect(SIDEBAR_MIN).toBe(layoutToken("sidebar-min"));
    expect(SIDEBAR_MAX).toBe(layoutToken("sidebar-max"));
    // dragging hides 40px past the minimum
    expect(SIDEBAR_HIDE_BELOW).toBe(SIDEBAR_MIN - 40);
  });

  it("a chosen width is an integer within 200–400; a broken value falls back to the default", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(260.6)).toBe(261);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH);
  });

  it("the visible width is what the window leaves — ≤248 at 960, 400 at 1112, the chosen value unchanged (T7)", () => {
    expect(visibleSidebarWidth(400, 960)).toBe(248);
    expect(visibleSidebarWidth(220, 960)).toBe(220);
    expect(visibleSidebarWidth(400, 1112)).toBe(400);
    expect(visibleSidebarWidth(300, 1440)).toBe(300);
    // never under the minimum, however narrow
    expect(visibleSidebarWidth(400, 500)).toBe(SIDEBAR_MIN);
  });

  it("the docked width is 0 when hidden — the content width is the window minus it", () => {
    expect(dockedWidth({ hidden: false, width: 300 }, 1440)).toBe(300);
    expect(dockedWidth({ hidden: true, width: 300 }, 1440)).toBe(0);
    expect(contentWidth({ hidden: false, width: 400 }, 960)).toBe(960 - 248);
    expect(contentWidth({ hidden: true, width: 400 }, 960)).toBe(960);
  });
});

describe("saved prefs (#217 D17, T6)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults when absent — shown, 248, not hinted", () => {
    expect(loadSidebarPrefs()).toEqual({ hidden: false, width: 248, hinted: false });
  });

  it("reads the saved values", () => {
    saveSidebarPrefs({ hidden: true, width: 320, hinted: true });
    expect(stored()).toEqual({ hidden: true, width: 320, hinted: true });
    expect(loadSidebarPrefs()).toEqual({ hidden: true, width: 320, hinted: true });
  });

  it("broken JSON gives the defaults, an out-of-range width is clamped, and a wrongly typed field falls back on its own", () => {
    localStorage.setItem(KEY, "{ nope");
    expect(loadSidebarPrefs()).toEqual({ hidden: false, width: 248, hinted: false });
    localStorage.setItem(KEY, JSON.stringify({ hidden: "yes", width: 9999, hinted: 1 }));
    expect(loadSidebarPrefs()).toEqual({ hidden: false, width: 400, hinted: false });
    localStorage.setItem(KEY, JSON.stringify([1, 2]));
    expect(loadSidebarPrefs()).toEqual({ hidden: false, width: 248, hinted: false });
    localStorage.setItem(KEY, "null");
    expect(loadSidebarPrefs()).toEqual({ hidden: false, width: 248, hinted: false });
  });

  it("does not throw when storage is blocked — for reads and writes", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      expect(loadSidebarPrefs()).toEqual({ hidden: false, width: 248, hinted: false });
      expect(() => saveSidebarPrefs({ hidden: true, width: 300, hinted: true })).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("edge drag resolution (#217 D14, T9)", () => {
  it("the width follows the pointer within 200–400", () => {
    expect(resolveEdgeDrag(250, false)).toEqual({ hidden: false, width: 250 });
    expect(resolveEdgeDrag(450, false)).toEqual({ hidden: false, width: 400 });
  });

  it("stops at 200 between 160 and 200, and hides below 160", () => {
    expect(resolveEdgeDrag(180, false)).toEqual({ hidden: false, width: 200 });
    expect(resolveEdgeDrag(160, false)).toEqual({ hidden: false, width: 200 });
    expect(resolveEdgeDrag(150, false).hidden).toBe(true);
  });

  it("once hidden in a gesture, it shows again only above 200", () => {
    expect(resolveEdgeDrag(180, true).hidden).toBe(true);
    expect(resolveEdgeDrag(210, true)).toEqual({ hidden: false, width: 210 });
  });
});

describe("sidebar state (#217 R4·R6)", () => {
  beforeEach(() => {
    localStorage.clear();
    useToastStore.getState().dismissAll();
  });

  it("defaults to shown at 248, and starts from saved prefs", () => {
    expect(createSidebarStore().getState()).toMatchObject({
      hidden: false,
      width: 248,
      peek: false,
    });
    saveSidebarPrefs({ hidden: true, width: 300, hinted: true });
    expect(createSidebarStore().getState()).toMatchObject({ hidden: true, width: 300 });
  });

  it("hide·show·toggle — saves on every change (T8)", () => {
    const store = createSidebarStore();
    store.getState().hide();
    expect(store.getState().hidden).toBe(true);
    expect(stored()).toMatchObject({ hidden: true });
    store.getState().show();
    expect(store.getState().hidden).toBe(false);
    expect(stored()).toMatchObject({ hidden: false });
    store.getState().toggle();
    expect(store.getState().hidden).toBe(true);
    store.getState().toggle();
    expect(store.getState().hidden).toBe(false);
  });

  it("toasts only on the first hide — not again even after a restart (T8, D15)", () => {
    const store = createSidebarStore();
    store.getState().hide();
    expect(toasts()).toEqual(["Sidebar hidden · Ctrl+\\ to show"]);
    expect(useToastStore.getState().toasts[0]?.keys).toBe("Ctrl+\\");
    store.getState().show();
    store.getState().hide();
    expect(toasts()).toHaveLength(1);
    useToastStore.getState().dismissAll();
    // a restart: a new store reads what the old one saved
    const again = createSidebarStore();
    again.getState().show();
    again.getState().hide();
    expect(toasts()).toEqual([]);
  });

  it("hints with ⌘\\ on macOS", () => {
    const store = createSidebarStore({ mac: true });
    store.getState().hide();
    expect(toasts()).toEqual(["Sidebar hidden · ⌘\\ to show"]);
    // the shortcut is drawn apart, as a kbd (#231 D18)
    expect(useToastStore.getState().toasts[0]?.keys).toBe("⌘\\");
  });

  it("keeps the chosen width while hidden", () => {
    const store = createSidebarStore();
    store.getState().setWidth(320);
    store.getState().commitWidth();
    store.getState().hide();
    expect(store.getState().width).toBe(320);
    store.getState().show();
    expect(store.getState().width).toBe(320);
  });

  it("setWidth does not save; commitWidth does", () => {
    const store = createSidebarStore();
    store.getState().setWidth(300);
    expect(localStorage.getItem(KEY)).toBeNull();
    store.getState().commitWidth();
    expect(stored()).toMatchObject({ width: 300 });
  });

  it("peek opens only while hidden and is not saved — Pin docks it (T10)", () => {
    const store = createSidebarStore();
    store.getState().openPeek();
    expect(store.getState().peek).toBe(false);
    store.getState().hide();
    const before = localStorage.getItem(KEY);
    store.getState().openPeek();
    expect(store.getState().peek).toBe(true);
    expect(localStorage.getItem(KEY)).toBe(before);
    store.getState().closePeek();
    expect(store.getState().peek).toBe(false);
    store.getState().openPeek();
    store.getState().pin();
    expect(store.getState()).toMatchObject({ hidden: false, peek: false });
    expect(stored()).toMatchObject({ hidden: false });
  });

  it("toggling while peeking docks it", () => {
    const store = createSidebarStore();
    store.getState().hide();
    store.getState().openPeek();
    store.getState().toggle();
    expect(store.getState()).toMatchObject({ hidden: false, peek: false });
  });

  describe("drag gesture (T9)", () => {
    it("saves once, at the end", () => {
      const store = createSidebarStore();
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      try {
        store.getState().beginDrag();
        store.getState().dragTo(300);
        store.getState().dragTo(320);
        expect(store.getState()).toMatchObject({ width: 320, resizing: true });
        expect(setItem).not.toHaveBeenCalled();
        store.getState().endDrag();
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(store.getState().resizing).toBe(false);
        expect(stored()).toMatchObject({ hidden: false, width: 320 });
      } finally {
        setItem.mockRestore();
      }
    });

    it("hides when dragged below 160, and shows again when brought back above 200 in the same gesture", () => {
      const store = createSidebarStore();
      store.getState().beginDrag();
      store.getState().dragTo(150);
      expect(store.getState().hidden).toBe(true);
      store.getState().dragTo(180);
      expect(store.getState().hidden).toBe(true);
      store.getState().dragTo(210);
      expect(store.getState()).toMatchObject({ hidden: false, width: 210 });
      store.getState().endDrag();
      expect(toasts()).toEqual([]);
    });

    it("ending hidden shows the first toast then, and the width stays at its pre-drag value", () => {
      const store = createSidebarStore();
      store.getState().setWidth(320);
      store.getState().beginDrag();
      store.getState().dragTo(180);
      store.getState().dragTo(120);
      expect(toasts()).toEqual([]);
      store.getState().endDrag();
      expect(store.getState()).toMatchObject({ hidden: true, width: 320 });
      expect(toasts()).toEqual(["Sidebar hidden · Ctrl+\\ to show"]);
      expect(stored()).toEqual({ hidden: true, width: 320, hinted: true });
    });
  });
});

describe("width hooks — following the window (D18·D24)", () => {
  /** the window, `w` wide — and the resize event a real one would send */
  const windowOf = (w: number) =>
    act(() => {
      vi.spyOn(window, "innerWidth", "get").mockReturnValue(w);
      window.dispatchEvent(new Event("resize"));
    });

  beforeEach(() => {
    useSidebarStore.setState({ hidden: false, width: 300 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("visible, docked and content widths — a narrow window shrinks the chosen width; hidden gives 0 and the whole window", () => {
    windowOf(1440);
    const visible = renderHook(() => useVisibleSidebarWidth());
    const docked = renderHook(() => useDockedWidth());
    const content = renderHook(() => useContentWidth());
    expect([visible, docked, content].map((h) => h.result.current)).toEqual([300, 300, 1140]);
    windowOf(960);
    expect([visible, docked, content].map((h) => h.result.current)).toEqual([248, 248, 712]);
    act(() => useSidebarStore.setState({ hidden: true }));
    // the peek still floats at the visible width
    expect([visible, docked, content].map((h) => h.result.current)).toEqual([248, 0, 960]);
  });

  it("each hook listens to the window size only once", () => {
    const listen = vi.spyOn(window, "addEventListener");
    renderHook(() => useContentWidth());
    expect(listen.mock.calls.filter(([type]) => type === "resize")).toHaveLength(1);
  });
});
