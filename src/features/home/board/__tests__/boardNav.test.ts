import { describe, expect, it } from "vitest";

import type { FolderMeta } from "../../../library/libraryApi";
import { effectiveBoards, persistentLayout, renderLayout } from "../boardLayout";
import {
  folderKey,
  type NavItem,
  navItems,
  neighbourOf,
  readingOrder,
  spatialNext,
  standIn,
} from "../boardNav";
import { folder } from "./boardFixtures";

const item = (key: string, x: number, y: number, w = 100, h = 100): NavItem => ({
  key,
  kind: "card",
  frame: "f",
  rect: { x, y, w, h },
});

describe("board items and reading order (#221 D20, T20)", () => {
  const folders: FolderMeta[] = [
    folder("b", 2, { board: { x: 0, y: 400 } }),
    folder("a", 4, { board: { x: 0, y: 0 } }),
    folder("c", 9, { board: { x: 700, y: 0 } }),
  ];
  const layout = persistentLayout(folders, effectiveBoards(folders, {}), {});

  it("frame names, cards, and stacks are items — frames top→bottom·left→right, contents in layout order", () => {
    expect(readingOrder(navItems(layout)).map((i) => i.key)).toEqual([
      "frame:a",
      "card:a-0",
      "card:a-1",
      "card:a-2",
      "card:a-3",
      "frame:c",
      "stack:c",
      "frame:b",
      "card:b-0",
      "card:b-1",
    ]);
  });

  it("an item's rect is in board coordinates — frame position + position inside", () => {
    const card = navItems(layout).find((i) => i.key === "card:a-1")!;
    expect(card.rect).toEqual({ x: 280, y: 64, w: 240, h: 192 });
    const name = navItems(layout).find((i) => i.key === "frame:c")!;
    expect(name.rect).toMatchObject({ x: 700, y: 0, h: 64 });
  });

  it("items are only frames·cards·stacks — no page tiles (#229 D18)", () => {
    expect(new Set(navItems(layout).map((i) => i.kind))).toEqual(
      new Set(["frame", "card", "stack"]),
    );
  });
});

describe("folder card items (#231 D13)", () => {
  const pay: FolderMeta = {
    ...folder("pay", 1, { board: { x: 0, y: 0 } }),
    order: ["folder:chk", "diagram:pay-0"],
    folders: [{ ...folder("chk", 2), folders: [{ ...folder("flw", 1) }] }],
  };
  const layout = persistentLayout([pay], effectiveBoards([pay], {}), {});

  it("folder:<id> key, kind folder, board coordinates — reading order follows the sidebar order", () => {
    expect(folderKey("chk")).toBe("folder:chk");
    expect(readingOrder(navItems(layout)).map((i) => i.key)).toEqual([
      "frame:pay",
      "folder:chk",
      "card:pay-0",
    ]);
    expect(navItems(layout).find((i) => i.key === "folder:chk")).toMatchObject({
      kind: "folder",
      frame: "pay",
      id: "chk",
      rect: { x: 20, y: 64, w: 240, h: 192 },
    });
  });

  it("standIn: a drawn folder card stays itself, a diagram·folder moved into a folder → the folder card holding it", () => {
    expect(standIn(layout, "folder:chk")).toBe("folder:chk");
    expect(standIn(layout, "card:chk-1")).toBe("folder:chk");
    expect(standIn(layout, "folder:flw")).toBe("folder:chk");
    expect(standIn(layout, "card:flw-0")).toBe("folder:chk");
  });

  it("standIn: a folder collapsed into a stack → the stack, its contents too → the stack, a vanished folder → null", () => {
    const folded = persistentLayout(
      [pay],
      effectiveBoards([pay], {}, { pay: { collapsed: true } }),
      {},
    );
    expect(standIn(folded, "folder:chk")).toBe("stack:pay");
    expect(standIn(folded, "card:flw-0")).toBe("stack:pay");
    expect(standIn(layout, "folder:gone")).toBeNull();
  });

  it("if an expanded stack's front item is a folder → that folder card", () => {
    expect(standIn(layout, "stack:pay")).toBe("folder:chk");
  });
});

describe("spatial navigation (#221 D20, T20)", () => {
  //  a  b  c
  //  d     e
  const grid = [
    item("a", 0, 0),
    item("b", 200, 0),
    item("c", 400, 0),
    item("d", 0, 200),
    item("e", 400, 200),
  ];

  it("beside on the same row", () => {
    expect(spatialNext(grid, "a", "ArrowRight")).toBe("b");
    expect(spatialNext(grid, "c", "ArrowLeft")).toBe("b");
  });

  it("another row: the smallest main-axis distance + 2 × cross-axis distance", () => {
    expect(spatialNext(grid, "a", "ArrowDown")).toBe("d");
    expect(spatialNext(grid, "b", "ArrowDown")).toBe("d");
    expect(spatialNext(grid, "e", "ArrowUp")).toBe("c");
    expect(spatialNext(grid, "d", "ArrowRight")).toBe("e");
  });

  it("ties go to the earlier one in reading order", () => {
    // from b, d and e are both 200 down and 200 across
    const tie = [item("b", 200, 0), item("e", 400, 200), item("d", 0, 200)];
    expect(spatialNext(tie, "b", "ArrowDown")).toBe("d");
  });

  it("stays put without candidates", () => {
    expect(spatialNext(grid, "a", "ArrowLeft")).toBe("a");
    expect(spatialNext(grid, "a", "ArrowUp")).toBe("a");
    expect(spatialNext(grid, "gone", "ArrowUp")).toBe("gone");
  });

  it("Home·End are the first·last in reading order", () => {
    expect(spatialNext(grid, "c", "Home")).toBe("a");
    expect(spatialNext(grid, "a", "End")).toBe("e");
  });
});

describe("neighbor after delete (#221)", () => {
  const row = [item("a", 0, 0), item("b", 200, 0), item("c", 400, 0)];
  const only =
    (...keys: string[]) =>
    (i: NavItem) =>
      keys.includes(i.key);

  it("next in reading order, else the closest earlier one, null if nothing is left", () => {
    expect(neighbourOf(row, "b", only("b"))).toBe("c");
    expect(neighbourOf(row, "c", only("c"))).toBe("b");
    expect(neighbourOf(row, "a", only("a", "b"))).toBe("c");
    expect(neighbourOf(row, "c", only("b", "c"))).toBe("a");
    expect(neighbourOf(row, "a", only("a", "b", "c"))).toBeNull();
  });
});

describe("stand-in for a vanished item (#221)", () => {
  const folders: FolderMeta[] = [
    folder("a", 3, { board: { x: 0, y: 0 } }),
    folder("c", 9, { board: { x: 1200, y: 0 } }),
  ];
  const kept = persistentLayout(folders, effectiveBoards(folders, {}), {});
  const unfolded = persistentLayout(
    folders,
    effectiveBoards(folders, {}, { c: { collapsed: false } }),
    {},
  );

  it("itself if it is drawn", () => {
    expect(standIn(kept, "card:a-1")).toBe("card:a-1");
    expect(standIn(kept, "stack:c")).toBe("stack:c");
  });

  it("a card collapsed into a stack → the stack", () => {
    expect(standIn(kept, "card:c-3")).toBe("stack:c");
  });

  it("an expanded stack → that project's front card (most recent)", () => {
    expect(standIn(unfolded, "stack:c")).toBe("card:c-0");
  });

  it("a stack whose diagrams are gone → the project name, missing project·diagram → null", () => {
    const emptied = folders.map((f) => (f.id === "c" ? { ...f, diagrams: [] } : f));
    const layout = persistentLayout(emptied, effectiveBoards(emptied, {}), {});
    expect(standIn(layout, "stack:c")).toBe("frame:c");
    expect(standIn(kept, "card:gone")).toBeNull();
    expect(standIn(kept, "frame:gone")).toBeNull();
    expect(standIn(kept, "stack:gone")).toBeNull();
  });
});

describe("items inside subframes (#231 D14, T29)", () => {
  /** Payments: Ledger, then Checkout (two diagrams, then Flows), then Payouts */
  const pay: FolderMeta = {
    ...folder("pay", 2, { board: { x: 100, y: 50 } }),
    order: ["diagram:pay-0", "folder:chk", "diagram:pay-1"],
    folders: [
      {
        ...folder("chk", 2),
        order: ["diagram:chk-0", "diagram:chk-1", "folder:flw"],
        folders: [{ ...folder("flw", 1) }, { ...folder("emp", 0) }],
      },
    ],
  };
  const persistent = persistentLayout([pay], effectiveBoards([pay], {}), {});
  const open = (viewed: string) => renderLayout(persistent, viewed);
  const keys = (viewed: string) => readingOrder(navItems(open(viewed))).map((i) => i.key);

  it("the open folder's card disappears and its tiles are items — board coordinates (frame + subframe + tile)", () => {
    expect(keys("chk")).toEqual([
      "frame:pay",
      "card:pay-0",
      "folder:emp",
      "card:chk-0",
      "card:chk-1",
      "folder:flw",
      "card:pay-1",
    ]);
    // pay at (100, 50): Ledger's row, then the sub-frame at (20, 276) in it; the first tile 20, 68 in that, 344 apart
    expect(navItems(open("chk")).find((i) => i.key === "card:chk-0")).toMatchObject({
      kind: "card",
      frame: "pay",
      id: "chk-0",
      rect: { x: 100 + 20 + 20 + 344, y: 50 + 276 + 68, w: 324, h: 276 },
    });
  });

  it("nesting: tiles of an inner subframe are items too — offsets add up layer by layer", () => {
    expect(keys("flw")).toContain("card:flw-0");
    expect(keys("flw")).not.toContain("folder:flw");
    const sub = open("flw")
      .byId.get("pay")!
      .layout.items.find((it) => it.kind === "sub")!;
    const flw = sub.kind === "sub" ? sub.items.find((it) => it.kind === "sub")! : sub;
    expect(navItems(open("flw")).find((i) => i.key === "card:flw-0")!.rect).toEqual({
      x: 100 + sub.x + flw.x + 20,
      y: 50 + sub.y + flw.y + 68,
      w: 324,
      h: 276,
    });
  });

  it("spatialNext moves in and out of subframes", () => {
    const items = navItems(open("chk"));
    expect(spatialNext(items, "card:pay-0", "ArrowDown")).toBe("folder:emp");
    expect(spatialNext(items, "folder:emp", "ArrowUp")).toBe("card:pay-0");
    expect(spatialNext(items, "folder:flw", "ArrowDown")).toBe("card:pay-1");
    expect(spatialNext(items, "folder:emp", "ArrowRight")).toBe("card:chk-0");
  });

  it("standIn: an open folder card → the first item of its subframe, an empty folder → the project name", () => {
    expect(standIn(open("chk"), "folder:chk")).toBe("folder:emp");
    expect(standIn(open("emp"), "folder:emp")).toBe("frame:pay");
    expect(standIn(open("flw"), "folder:flw")).toBe("card:flw-0");
  });

  it("standIn: when closed, that folder card — including the tiles that were inside", () => {
    expect(standIn(persistent, "folder:chk")).toBe("folder:chk");
    expect(standIn(persistent, "card:chk-1")).toBe("folder:chk");
    expect(standIn(open("chk"), "folder:flw")).toBe("folder:flw");
    expect(standIn(open("chk"), "card:flw-0")).toBe("folder:flw");
  });
});
