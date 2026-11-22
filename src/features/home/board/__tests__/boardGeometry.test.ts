import { describe, expect, it } from "vitest";

import type { FolderMeta } from "../../../library/libraryApi";
import {
  CARD_H,
  CARD_W,
  EMPTY_H,
  EMPTY_W,
  drawsStack,
  type FrameItem,
  frameColumns,
  frameFold,
  frameLayout,
  isCollapsed,
  MISSING_H,
  STACK_FACES_W,
  STACK_FRAME_W,
  STACK_STEP,
  STACK_W,
  SUB_COLS,
  SUB_FOOT,
  SUB_HEAD,
  SUB_PAD,
  SUB_TITLE_INSET,
  SUB_TITLE_ICON,
  SUB_TITLE_ICON_GAP,
  SUB_TOOL,
  SUB_TOOL_GAP,
  SUB_TOOL_INSET,
  SUB_TOOLS_CLEAR,
  subFrameLayout,
  TILE_GAP,
  TILE_H,
  TILE_PAD,
  TILE_W,
  TILE_WELL_H,
  TILE_WELL_W,
  WELL_H,
  WELL_W,
} from "../boardGeometry";
import { folder } from "./boardFixtures";

const size = (n: number, collapsed?: boolean) => {
  const { w, h } = frameLayout(folder("p", n), collapsed);
  return [w, h];
};

describe("column count and frame size (#221 D4·D5, T8)", () => {
  it("cols(n): n for 3 or fewer (min 1), min(5, ⌈√n⌉) above that", () => {
    const cols = Array.from({ length: 21 }, (_, n) => frameColumns(n));
    expect(cols).toEqual([1, 1, 2, 3, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5]);
  });

  it("frame size is width 20 + 260c, height 64 + 212r — an empty project is one text line tall", () => {
    expect(size(0)).toEqual([344, 164]);
    expect(size(1)).toEqual([280, 276]);
    expect(size(2)).toEqual([540, 276]);
    expect(size(3)).toEqual([800, 276]);
    expect(size(4)).toEqual([540, 488]);
    expect(size(9, false)).toEqual([800, 700]);
  });

  it("cards sit at (20 + 260i, 64 + 212j), newest first", () => {
    const { items } = frameLayout(folder("p", 4), undefined);
    expect(items.map((it) => [it.kind, it.kind === "card" ? it.id : null, it.x, it.y])).toEqual([
      ["card", "p-0", 20, 64],
      ["card", "p-1", 280, 64],
      ["card", "p-2", 20, 276],
      ["card", "p-3", 280, 276],
    ]);
    expect(items.every((it) => it.w === CARD_W && it.h === CARD_H)).toBe(true);
  });

  it("a project not found holds its box alone — as wide as an empty frame, 216 high (#253 R7, Library-Missing 240·150 ÷ 0.7)", () => {
    const lost: FolderMeta = { ...folder("p", 3), missing: true };
    const layout = frameLayout(lost, true);
    expect(layout.items).toEqual([{ kind: "missing", x: 20, y: 64, w: EMPTY_W, h: MISSING_H }]);
    // the canvas's box, 92 high, ÷ 0.7 on the 4 grid
    expect(MISSING_H).toBe(132);
    expect(layout).toMatchObject({ w: STACK_FRAME_W, h: 216 });
    // nothing to fold
    expect(drawsStack(layout)).toBe(false);
    expect(frameFold(lost, layout)).toBeNull();
  });

  it("an empty project has one text cell — same width as a stack frame, height 80 (#231 D13, design 240·56 ÷ 0.7)", () => {
    const { items, w } = frameLayout(folder("p", 0), undefined);
    expect(items).toEqual([{ kind: "empty", x: 20, y: 64, w: EMPTY_W, h: EMPTY_H }]);
    expect(EMPTY_W).toBe(STACK_W);
    expect(w).toBe(STACK_FRAME_W);
    expect(EMPTY_H).toBe(80);
  });

  it("matches the design (Hybrid-Home-Canvas) sizes at 70%", () => {
    // design: card 168×136, well 154×84, a three-card frame 560 wide
    expect(CARD_W * 0.7).toBeCloseTo(168);
    expect(WELL_W * 0.7).toBeCloseTo(154);
    expect(WELL_H * 0.7).toBeCloseTo(84);
    expect(size(3)[0]! * 0.7).toBeCloseTo(560);
  });
});

describe("collapsing (#221 D6, T9)", () => {
  it("collapsed by default from 7 items — the setting wins, fewer than 2 never collapse", () => {
    expect(isCollapsed(6, undefined)).toBe(false);
    expect(isCollapsed(7, undefined)).toBe(true);
    expect(isCollapsed(9, false)).toBe(false);
    expect(isCollapsed(3, true)).toBe(true);
    expect(isCollapsed(1, true)).toBe(false);
    expect(isCollapsed(0, true)).toBe(false);
  });

  it("a collapsed frame is 344×352 — one stack, the front is the first item in order, at most 2 behind", () => {
    const layout = frameLayout(folder("p", 9), undefined);
    expect([layout.w, layout.h]).toEqual([344, 352]);
    expect(layout.items).toHaveLength(1);
    const stack = layout.items[0]!;
    expect(stack).toMatchObject({
      kind: "stack",
      front: "diagram:p-0",
      count: 9,
      behind: 2,
      x: 20,
      y: 64,
    });
    expect(frameLayout(folder("p", 2), true).items[0]).toMatchObject({
      kind: "stack",
      count: 2,
      behind: 1,
    });
    expect(STACK_STEP).toEqual({ x: 12, y: 8 });
  });

  it("a collapsed frame's width is the canvas stack frame (240 at 70%) on a 4 grid — wider than the face so the bottom row fits (#231 D13)", () => {
    // design: Hybrid-Home-Canvas's Infrastructure stack frame, 240 wide at 70%
    expect(STACK_FRAME_W).toBe(Math.ceil(240 / 0.7 / 4) * 4);
    expect(STACK_FRAME_W).toBe(344);
    // the stack's box is the frame less its padding; the faces keep their 264 at its left
    expect(STACK_W).toBe(304);
    expect(STACK_FACES_W).toBe(CARD_W + 2 * STACK_STEP.x);
    expect(STACK_FACES_W).toBe(264);
    const stack = frameLayout(folder("p", 9), undefined).items[0]!;
    expect([stack.x, stack.w]).toEqual([20, STACK_W]);
    // the row: "7 items · 10 diagrams" (16/600, 157) + 12 + Expand (10 + 18 + 8 + 57 + 14)
    expect(157 + 12 + 107).toBeLessThanOrEqual(STACK_W);
  });

  it("with a stack beside a subframe, the wider one is the frame width — even an empty subframe (364) is wider than the stack (304)", () => {
    const project: FolderMeta = { ...folder("p", 2), folders: [folder("a", 0)] };
    expect(frameLayout(project, true, ["a"]).w).toBe(2 * 20 + 364);
    expect(364).toBeGreaterThan(STACK_W);
  });
});

/** a project of `diagrams` diagrams and the folders `subs` (each with `inside` diagrams) */
const mixed = (diagrams: number, subs: string[], inside = 2): FolderMeta => ({
  ...folder("p", diagrams),
  folders: subs.map((id, i) => ({ ...folder(id, inside), updatedAt: 2000 + i })),
});

describe("folder cards in a frame (#231 D13, T25)", () => {
  it("direct children in sidebar order — folders are 'folder' items, the same box as diagram cards", () => {
    const project: FolderMeta = {
      ...mixed(2, ["chk", "arc"]),
      order: ["folder:chk", "diagram:p-0", "diagram:p-1", "folder:arc"],
    };
    const { items } = frameLayout(project, undefined);
    expect(items.map((it) => [it.kind, "id" in it ? it.id : null, it.x, it.y])).toEqual([
      ["folder", "chk", 20, 64],
      ["card", "p-0", 280, 64],
      ["card", "p-1", 20, 276],
      ["folder", "arc", 280, 276],
    ]);
    expect(items.every((it) => it.w === CARD_W && it.h === CARD_H)).toBe(true);
  });

  it("diagrams inside folders are not flattened into the frame — size follows the item count only", () => {
    const { items, w, h } = frameLayout(mixed(1, ["chk"], 5), undefined);
    expect(items.map((it) => it.kind)).toEqual(["folder", "card"]);
    expect([w, h]).toEqual(size(2));
  });

  it("the collapse threshold of 7 counts items — three diagrams + four folders collapse, contents of folders are not counted", () => {
    expect(frameLayout(mixed(3, ["a", "b", "c"], 9), undefined).items[0]!.kind).not.toBe("stack");
    const folded = frameLayout(mixed(3, ["a", "b", "c", "d"]), undefined).items[0]!;
    expect(folded).toMatchObject({ kind: "stack", count: 7 });
  });

  it("a stack lists item keys in order — the front can be a folder", () => {
    const project: FolderMeta = {
      ...mixed(1, ["chk"]),
      order: ["folder:chk", "diagram:p-0"],
    };
    const stack = frameLayout(project, true).items[0]!;
    expect(stack).toMatchObject({
      kind: "stack",
      keys: ["folder:chk", "diagram:p-0"],
      front: "folder:chk",
      count: 2,
      behind: 1,
    });
  });

  it("a project holding only folders is not an empty project", () => {
    const { items } = frameLayout(mixed(0, ["chk"], 0), undefined);
    expect(items).toEqual([{ kind: "folder", id: "chk", x: 20, y: 64, w: CARD_W, h: CARD_H }]);
  });
});

/** folder `id` holding `n` diagrams and the folders `subs` */
const box = (id: string, n: number, subs: FolderMeta[] = [], extra: Partial<FolderMeta> = {}) => ({
  ...folder(id, n),
  folders: subs,
  ...extra,
});
/** what a frame item stands for, and where */
const spots = (items: readonly FrameItem[]) =>
  items.map((it) => [it.kind, "id" in it ? it.id : null, it.x, it.y]);

describe("a folder opened in place — subframe (#231 D14, T28)", () => {
  /**
   * `Hybrid-Folder-Canvas` draws a frame card 180 wide where the app's is
   * 240, so every sub-frame number is the canvas's × 240/180 — "big cards"
   */
  const SCALE = CARD_W / 180;
  /** the canvas's sub-frame numbers (`Hybrid-Folder-Canvas`, `Home-States` 6) */
  const CANVAS = {
    tile: [244, 206],
    well: [224, 140],
    tilePad: 10,
    tileGap: 14,
    pad: 14,
    head: 50,
    foot: 50,
    tool: 28,
    toolInset: 10,
    titleInset: 14,
    titleIcon: 15,
  };
  /** the canvas's number × 240/180, on the 4 grid: within half a step of it */
  const scaled = (app: number, canvas: number) => {
    expect(app % 4).toBe(0);
    expect(Math.abs(app - canvas * SCALE)).toBeLessThanOrEqual(2);
  };

  it("constants are the canvas subframe × 240/180 on a 4 grid: inset 20, header 68, footer 68, tile 324×276 (well 300×188, inset 12), gap 20, 4 per row", () => {
    expect([SUB_PAD, SUB_HEAD, SUB_FOOT]).toEqual([20, 68, 68]);
    expect([TILE_W, TILE_H, TILE_PAD, TILE_GAP, SUB_COLS]).toEqual([324, 276, 12, 20, 4]);
    expect([TILE_WELL_W, TILE_WELL_H]).toEqual([300, 188]);
    scaled(TILE_W, CANVAS.tile[0]!);
    scaled(TILE_H, CANVAS.tile[1]!);
    scaled(TILE_WELL_W, CANVAS.well[0]!);
    scaled(TILE_WELL_H, CANVAS.well[1]!);
    scaled(TILE_PAD, CANVAS.tilePad);
    scaled(TILE_GAP, CANVAS.tileGap);
    scaled(SUB_PAD, CANVAS.pad);
    scaled(SUB_HEAD, CANVAS.head);
    scaled(SUB_FOOT, CANVAS.foot);
    // the well fills the tile across, less its padding
    expect(TILE_WELL_W + 2 * TILE_PAD).toBe(TILE_W);
  });

  it("tiles are larger cards than frame cards — same ratio as the canvas (244/180 ≈ 1.36)", () => {
    expect(TILE_W / CARD_W).toBeCloseTo(244 / 180, 1);
    expect(TILE_H / CARD_H).toBeCloseTo(206 / 147, 1);
    expect(TILE_WELL_H / WELL_H).toBeCloseTo(140 / 88, 1);
  });

  it("size: 1 item 364×412, 4 items 1396×412, 5 wrap to a second row 1396×708 — tiles at (20 + 344i, 68 + 296j)", () => {
    const size = (n: number) => {
      const { w, h } = subFrameLayout(box("chk", n), []);
      return [w, h];
    };
    expect(size(1)).toEqual([364, 412]);
    expect(size(3)).toEqual([1052, 412]);
    expect(size(4)).toEqual([1396, 412]);
    expect(size(5)).toEqual([1396, 708]);
    // the canvas's three-tile sub-frame, 788×306, × 240/180
    expect(Math.abs(size(3)[0]! - 788 * SCALE)).toBeLessThanOrEqual(2);
    expect(Math.abs(size(3)[1]! - 306 * SCALE)).toBeLessThanOrEqual(4);
    const sub = subFrameLayout(box("chk", 5), []);
    expect(sub).toMatchObject({ kind: "sub", id: "chk" });
    expect(spots(sub.items)).toEqual([
      ["card", "chk-0", 20, 68],
      ["card", "chk-1", 364, 68],
      ["card", "chk-2", 708, 68],
      ["card", "chk-3", 1052, 68],
      ["card", "chk-4", 20, 364],
    ]);
    expect(sub.items.every((it) => it.w === TILE_W && it.h === TILE_H)).toBe(true);
  });

  it("items inside are folder tiles and diagram tiles in sidebar order", () => {
    const chk = box("chk", 1, [box("flw", 2)], { order: ["folder:flw", "diagram:chk-0"] });
    expect(spots(subFrameLayout(chk, []).items)).toEqual([
      ["folder", "flw", 20, 68],
      ["card", "chk-0", 364, 68],
    ]);
  });

  it("the header is × 240/180 too: buttons 36×36 (28 → 37.3, the same cell as the project frame's 36 buttons), gap 4, right 12, title cell left 20·FolderOpen 20·gap 10·12 clear of the buttons", () => {
    expect([SUB_TOOL, SUB_TOOL_GAP, SUB_TOOL_INSET]).toEqual([36, 4, 12]);
    expect([SUB_TITLE_INSET, SUB_TITLE_ICON, SUB_TITLE_ICON_GAP]).toEqual([20, 20, 10]);
    scaled(SUB_TOOL, CANVAS.tool);
    scaled(SUB_TOOL_INSET, CANVAS.toolInset);
    scaled(SUB_TITLE_INSET, CANVAS.titleInset);
    expect(SUB_TITLE_ICON).toBeCloseTo(CANVAS.titleIcon * SCALE);
    // next to the project frame's header (BoardFrame: 36 buttons; the canvas 26 against 28): no smaller
    expect(SUB_TOOL).toBeGreaterThanOrEqual(36);
    // the title box's right inset — the canvas's 78, × 240/180 ≈ 104, on the grid
    expect(SUB_TOOLS_CLEAR).toBe(SUB_TOOL_INSET + 2 * SUB_TOOL + SUB_TOOL_GAP + 12);
    expect(SUB_TOOLS_CLEAR).toBe(100);
  });

  it("the title is not clipped even at one empty-folder cell wide — the title slot is wider than 'New folder · 0 items' (16px, 148) (Home-States 6)", () => {
    const { w } = subFrameLayout(box("chk", 0), []);
    const room = w - SUB_TITLE_INSET - SUB_TITLE_ICON - SUB_TITLE_ICON_GAP - SUB_TOOLS_CLEAR;
    expect(room).toBe(214);
    // Manrope 600 "New folder " + 500 "· 0 items" at 16px, from the font's advances
    expect(room).toBeGreaterThanOrEqual(148);
  });

  it("an empty folder shows text in a single tile slot — 364×412", () => {
    const sub = subFrameLayout(box("chk", 0), []);
    expect([sub.w, sub.h]).toEqual([364, 412]);
    expect(sub.items).toEqual([{ kind: "empty", x: 20, y: 68, w: TILE_W, h: TILE_H }]);
  });

  it("nesting: an inner subframe takes its own row in the outer subframe — the inner widens the outer", () => {
    const flw = box("flw", 5);
    const chk = box("chk", 2, [flw], { order: ["diagram:chk-0", "folder:flw", "diagram:chk-1"] });
    const sub = subFrameLayout(chk, ["flw"]);
    // flw: 1396×708, its own row between chk-0 and chk-1
    expect(spots(sub.items)).toEqual([
      ["card", "chk-0", 20, 68],
      ["sub", "flw", 20, 364],
      ["card", "chk-1", 20, 1092],
    ]);
    expect([sub.w, sub.h]).toEqual([2 * 20 + 1396, 68 + 276 + 20 + 708 + 20 + 276 + 68]);
    const inner = sub.items[1]!;
    expect(inner.kind === "sub" && [inner.w, inner.h]).toEqual([1396, 708]);
    // a chain past what is there opens nothing more
    expect(subFrameLayout(chk, ["gone"]).items.some((it) => it.kind === "sub")).toBe(false);
  });
});

describe("subframes in a project frame — answer to Q1: their own row (#231 D14, T28)", () => {
  /** Payments: Ledger, Checkout (three diagrams), Payouts, Archive — in that order */
  const pay = box("pay", 2, [box("chk", 3), box("arc", 0)], {
    order: ["diagram:pay-0", "folder:chk", "diagram:pay-1", "folder:arc"],
  });

  it("the open folder takes a whole row at its card's spot — earlier items in the row above, later ones in the row below", () => {
    const layout = frameLayout(pay, undefined, ["chk"]);
    // the sub-frame (1052 wide) is wider than two cards (500): the rest wraps at 1052
    expect(spots(layout.items)).toEqual([
      ["card", "pay-0", 20, 64],
      ["sub", "chk", 20, 276],
      ["card", "pay-1", 20, 708],
      ["folder", "arc", 280, 708],
    ]);
    expect([layout.w, layout.h]).toEqual([2 * 20 + 1052, 64 + 192 + 20 + 412 + 20 + 192 + 20]);
  });

  it("if the open folder is the first item, the first row — the rest in sidebar order on the rows below (Hybrid-Folder-Canvas)", () => {
    const first: FolderMeta = {
      ...pay,
      order: ["folder:chk", "diagram:pay-0", "diagram:pay-1", "folder:arc"],
    };
    expect(spots(frameLayout(first, undefined, ["chk"]).items)).toEqual([
      ["sub", "chk", 20, 64],
      ["card", "pay-0", 20, 496],
      ["card", "pay-1", 280, 496],
      ["folder", "arc", 540, 496],
    ]);
  });

  it("collapsed project = [subframe, stack of the rest] — the stack count is the project's item count, like the header (#231 D13)", () => {
    const layout = frameLayout(pay, true, ["chk"]);
    expect(layout.items.map((it) => it.kind)).toEqual(["sub", "stack"]);
    expect(layout.items[1]).toMatchObject({
      kind: "stack",
      keys: ["diagram:pay-0", "diagram:pay-1", "folder:arc"],
      front: "diagram:pay-0",
      // the project's four items — the header's number — not the three left in the stack
      count: 4,
      behind: 2,
      x: 20,
      y: 64 + 412 + 20,
    });
  });

  it("opening a folder in a collapsed project leaves fewer than two in the stack → cards — no one-card stacks (#231 D13)", () => {
    const two = box("pay", 1, [box("chk", 3)], { order: ["folder:chk", "diagram:pay-0"] });
    const layout = frameLayout(two, true, ["chk"]);
    // the sub-frame (1052 wide) on its own row, the one left a card under it
    expect(spots(layout.items)).toEqual([
      ["sub", "chk", 20, 64],
      ["card", "pay-0", 20, 64 + 412 + 20],
    ]);
    expect(layout.items[1]).toMatchObject({ w: CARD_W, h: CARD_H });
    expect([layout.w, layout.h]).toEqual([2 * 20 + 1052, 64 + 412 + 20 + 192 + 20]);
    // closed, it is a stack of two again
    expect(frameLayout(two, true).items[0]).toMatchObject({ kind: "stack", count: 2 });
  });

  it("opens nothing if the chain is not under the project — same as no chain", () => {
    expect(frameLayout(pay, undefined, ["gone"])).toEqual(frameLayout(pay, undefined));
    expect(frameLayout(pay, undefined, [])).toEqual(frameLayout(pay, undefined));
  });

  it("nested chain: project → Checkout → Flows, the inner frame inside the outer frame", () => {
    const deep = box("pay", 1, [box("chk", 1, [box("flw", 2)])]);
    const layout = frameLayout(deep, undefined, ["chk", "flw"]);
    const chk = layout.items.find((it) => it.kind === "sub")!;
    expect(chk.kind === "sub" && chk.items.find((it) => it.kind === "sub")).toMatchObject({
      kind: "sub",
      id: "flw",
      w: 2 * 20 + 2 * 324 + 20,
    });
  });
});

describe("collapsing as drawn — the header's ', collapsed' and the frame ⋯ collapse toggle (#231 D13)", () => {
  /** Payments: Checkout (a folder of three), then one diagram */
  const two = box("pay", 1, [box("chk", 3)], { order: ["folder:chk", "diagram:pay-0"] });
  /** Payments: Ledger, Checkout (three diagrams), Payouts, Archive */
  const four = box("pay", 2, [box("chk", 3), box("arc", 0)], {
    order: ["diagram:pay-0", "folder:chk", "diagram:pay-1", "folder:arc"],
  });

  it("whether a stack was drawn comes from the layout's items — not when a folder opened in a collapsed pair is drawn as cards", () => {
    expect(drawsStack(frameLayout(two, true))).toBe(true);
    expect(drawsStack(frameLayout(two, true, ["chk"]))).toBe(false);
    expect(drawsStack(frameLayout(four, true, ["chk"]))).toBe(true);
    expect(drawsStack(frameLayout(four, false, ["chk"]))).toBe(false);
    expect(drawsStack(frameLayout(folder("p", 9), undefined))).toBe(true);
    expect(drawsStack(frameLayout(folder("p", 0), true))).toBe(false);
  });

  it("the toggle hides when pressing it would not change the drawing — stack = Expand, expanded drawing = Collapse, none if collapsing still leaves cards", () => {
    const fold = (f: FolderMeta, collapsed: boolean | undefined, chain: string[] = []) =>
      frameFold(f, frameLayout(f, collapsed, chain));
    // a stack: Expand always draws cards
    expect(fold(two, true)).toBe("expand");
    expect(fold(four, true, ["chk"])).toBe("expand");
    expect(fold(folder("p", 9), undefined)).toBe("expand");
    // cards drawn expanded: Collapse folds them into a stack
    expect(fold(folder("p", 9), false)).toBe("collapse");
    expect(fold(two, false)).toBe("collapse");
    // a folder open beside two or more: Collapse stacks them beside it
    expect(fold(four, undefined, ["chk"])).toBe("collapse");
    expect(fold(four, false, ["chk"])).toBe("collapse");
    // stored collapsed, drawn as cards — a folder open beside one
    expect(fold(two, true, ["chk"])).toBeNull();
    // expanded, a folder open beside one: collapsed it would stay cards
    expect(fold(two, false, ["chk"])).toBeNull();
    expect(fold(two, undefined, ["chk"])).toBeNull();
    // under two: a stack of one is a card
    expect(fold(folder("p", 1), true)).toBeNull();
    expect(fold(folder("p", 0), undefined)).toBeNull();
  });
});
