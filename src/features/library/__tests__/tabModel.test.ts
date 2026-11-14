import { describe, expect, it } from "vitest";

import { SIDEBAR_WIDTH } from "../../../shared/lib/sidebarLayout";
import { BAND_EDGE_INSET, tabsLeft } from "../../../shared/lib/windowChrome";
import {
  cycleTarget,
  type DocTab,
  findTab,
  NEW_TAB_ROOM,
  nextActiveAfterClose,
  nthTarget,
  parseSession,
  separatorAfter,
  serializeSession,
  stripLayout,
  TAB_MIN_WIDTH,
  tabTitle,
} from "../tabModel";

const tab = (id: string, over: Partial<DocTab> = {}): DocTab => ({
  id,
  projectId: id,
  filePath: null,
  title: id.toUpperCase(),
  doc: null,
  loaded: true,
  viewport: null,
  baseline: null,
  ...over,
});
const ext = (id: string, path: string) => tab(id, { projectId: null, filePath: path });

describe("finding tabs (#218 D9, T9)", () => {
  const tabs = [tab("a"), ext("f", "/x/f.dosik.json"), tab("b")];
  const live = { projectId: null, filePath: null };

  it("library diagrams by projectId, external files by path", () => {
    expect(findTab(tabs, null, live, { projectId: "b" })?.id).toBe("b");
    expect(findTab(tabs, null, live, { filePath: "/x/f.dosik.json" })?.id).toBe("f");
    expect(findTab(tabs, null, live, { projectId: "zz" })).toBeUndefined();
    expect(findTab(tabs, null, live, { filePath: "/other" })).toBeUndefined();
  });

  it("the active tab uses the live store's value — a path changed by Save As", () => {
    const moved = { projectId: null, filePath: "/y/saved-as.dosik.json" };
    expect(findTab(tabs, "f", moved, { filePath: "/y/saved-as.dosik.json" })?.id).toBe("f");
    expect(findTab(tabs, "f", moved, { filePath: "/x/f.dosik.json" })).toBeUndefined();
  });
});

describe("active tab after closing (#218 D10, T10)", () => {
  const tabs = [tab("a"), tab("b"), tab("c")];

  it("closing the active tab goes right → left → Home", () => {
    expect(nextActiveAfterClose(tabs, "b", "b")).toBe("c");
    expect(nextActiveAfterClose(tabs, "c", "c")).toBe("b");
    expect(nextActiveAfterClose([tab("a")], "a", "a")).toBeNull();
  });

  it("closing an inactive tab keeps the active one — even Home", () => {
    expect(nextActiveAfterClose(tabs, "b", "a")).toBe("b");
    expect(nextActiveAfterClose(tabs, null, "a")).toBeNull();
  });
});

describe("cycling and numbers (#218 D12, T11)", () => {
  const tabs = [tab("a"), tab("b"), tab("c")];

  it("⌃Tab / ⌃⇧Tab — cycles including Home", () => {
    expect(cycleTarget(tabs, null, 1)).toBe("a");
    expect(cycleTarget(tabs, "a", 1)).toBe("b");
    expect(cycleTarget(tabs, "c", 1)).toBeNull();
    expect(cycleTarget(tabs, null, -1)).toBe("c");
    expect(cycleTarget(tabs, "a", -1)).toBeNull();
    expect(cycleTarget([], null, 1)).toBeNull();
  });

  it("⌘1 Home, ⌘2~⌘8 the (n−1)th (ignored if missing), ⌘9 the last", () => {
    expect(nthTarget(tabs, 1)).toBeNull();
    expect(nthTarget(tabs, 2)).toBe("a");
    expect(nthTarget(tabs, 4)).toBe("c");
    expect(nthTarget(tabs, 5)).toBeUndefined();
    expect(nthTarget(tabs, 8)).toBeUndefined();
    expect(nthTarget(tabs, 9)).toBe("c");
    // no document tabs: ⌘9 is Home
    expect(nthTarget([], 9)).toBeNull();
  });
});

describe("separators (#218 D14, T12)", () => {
  const tabs = [tab("a"), tab("b"), tab("c"), tab("d")];

  it("only when an inactive document tab is followed by another inactive document tab", () => {
    // a | b · [c] · d — only between a and b
    expect(tabs.map((_, i) => separatorAfter(tabs, "c", i))).toEqual([true, false, false, false]);
    // Home active: all three gaps between documents
    expect(tabs.map((_, i) => separatorAfter(tabs, null, i))).toEqual([true, true, true, false]);
    expect(tabs.map((_, i) => separatorAfter(tabs, "a", i))).toEqual([false, true, true, false]);
  });
});

describe("strip geometry (#218 D13, T13)", () => {
  /** what the strip has in a 960 window with the sidebar docked at 248 (tabs from 256) */
  const docked960 = 960 - tabsLeft(SIDEBAR_WIDTH, true) - NEW_TAB_ROOM - BAND_EDGE_INSET;

  it("176 when roomy — close left = tab left + width − 25 (197 / 375 / 553 in SPEC.md)", () => {
    const layout = stripLayout(1440, 3);
    expect(layout.width).toBe(176);
    expect(layout.lefts).toEqual([38, 216, 394]);
    expect(layout.closeLefts).toEqual([189, 367, 545]);
    // the board's close lefts are in strip coordinates, 8px further right
    expect(layout.closeLefts.map((l) => l + 8)).toEqual([197, 375, 553]);
    expect(layout.overflow).toBe(false);
    expect(layout.contentWidth).toBe(36 + 3 * 178);
  });

  it("960 + docked: 3 tabs are 176, 5 shrink without scrolling, 6 stop at 112 and overflow", () => {
    expect(stripLayout(docked960, 3)).toMatchObject({ width: 176, overflow: false });
    const five = stripLayout(docked960, 5);
    expect(five.width).toBeGreaterThanOrEqual(TAB_MIN_WIDTH);
    expect(five.width).toBeLessThan(176);
    expect(five.overflow).toBe(false);
    expect(five.contentWidth).toBeLessThanOrEqual(docked960);
    expect(stripLayout(docked960, 6)).toMatchObject({ width: TAB_MIN_WIDTH, overflow: true });
  });

  it("shrinks evenly — integer widths, never more than the available width", () => {
    for (let count = 1; count <= 12; count++) {
      for (const available of [300, 512, 700, 1000]) {
        const layout = stripLayout(available, count);
        expect(Number.isInteger(layout.width)).toBe(true);
        expect(layout.width).toBeLessThanOrEqual(176);
        expect(layout.width).toBeGreaterThanOrEqual(TAB_MIN_WIDTH);
        if (!layout.overflow) expect(layout.contentWidth).toBeLessThanOrEqual(available);
      }
    }
  });

  it("without document tabs only Home; an unmeasured width (Infinity) counts as roomy", () => {
    expect(stripLayout(400, 0)).toMatchObject({ lefts: [], overflow: false, contentWidth: 36 });
    expect(stripLayout(Number.POSITIVE_INFINITY, 20)).toMatchObject({
      width: 176,
      overflow: false,
    });
  });
});

describe("session (#218 D15, T15)", () => {
  const live = { title: "Live A" };

  it("library tabs only, in order — external tabs are dropped. The active tab's title is live", () => {
    const tabs = [tab("a"), ext("f", "/f.dosik.json"), tab("b", { title: "Bee" })];
    expect(JSON.parse(serializeSession(tabs, "a", live))).toEqual({
      v: 1,
      tabs: [
        { projectId: "a", title: "Live A" },
        { projectId: "b", title: "Bee" },
      ],
      active: "a",
    });
  });

  it("active is null when Home or an external file is active", () => {
    const tabs = [tab("a"), ext("f", "/f.dosik.json")];
    expect(JSON.parse(serializeSession(tabs, null, live)).active).toBeNull();
    expect(JSON.parse(serializeSession(tabs, "f", live)).active).toBeNull();
  });

  it("reading back — round trip", () => {
    const raw = serializeSession([tab("a"), tab("b")], "b", { title: "B live" });
    expect(parseSession(raw)).toEqual({
      tabs: [
        { projectId: "a", title: "A" },
        { projectId: "b", title: "B live" },
      ],
      active: "b",
    });
  });

  it("broken JSON, another version or bad ids give an empty session", () => {
    const empty = { tabs: [], active: null };
    expect(parseSession(null)).toEqual(empty);
    expect(parseSession("{nope")).toEqual(empty);
    expect(parseSession(JSON.stringify({ v: 2, tabs: [], active: null }))).toEqual(empty);
    expect(parseSession(JSON.stringify([]))).toEqual(empty);
    expect(
      parseSession(
        JSON.stringify({ v: 1, tabs: [{ projectId: "../etc", title: "x" }], active: null }),
      ),
    ).toEqual(empty);
    expect(
      parseSession(JSON.stringify({ v: 1, tabs: [{ projectId: "ok", title: 3 }], active: null })),
    ).toEqual(empty);
  });

  it("an active not in the list is null, and a repeated id appears once", () => {
    const raw = JSON.stringify({
      v: 1,
      tabs: [
        { projectId: "a", title: "A" },
        { projectId: "a", title: "A again" },
      ],
      active: "zz",
    });
    expect(parseSession(raw)).toEqual({ tabs: [{ projectId: "a", title: "A" }], active: null });
  });
});

describe("tab labels (#218 D14)", () => {
  it("live title when active, snapshot when inactive, listing for unread tabs, else the saved title", () => {
    const loaded = tab("a", { doc: { title: "Snap" } as DocTab["doc"] });
    expect(tabTitle(loaded, true, "Live", undefined)).toBe("Live");
    expect(tabTitle(loaded, false, "Live", "Listed")).toBe("Snap");
    const unread = tab("b", { loaded: false, title: "Saved" });
    expect(tabTitle(unread, false, "Live", "Listed")).toBe("Listed");
    expect(tabTitle(unread, false, "Live", undefined)).toBe("Saved");
  });
});
