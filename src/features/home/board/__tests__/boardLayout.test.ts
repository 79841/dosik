import { describe, expect, it } from "vitest";

import type { BoardSpot, FolderMeta } from "../../../library/libraryApi";
import {
  autoPlace,
  boardBounds,
  dropTarget,
  effectiveBoards,
  type FrameRect,
  frameAtPoint,
  landingFolder,
  persistentLayout,
  NEW_FRAME,
  placeNewFrame,
  planCommit,
  renderLayout,
  settleFrames,
} from "../boardLayout";
import { frameLayout } from "../boardGeometry";
import { folder } from "./boardFixtures";

const rect = (id: string, x: number, y: number, w = 100, h = 100): FrameRect => ({
  id,
  x,
  y,
  w,
  h,
});
const at = (frames: FrameRect[]) => Object.fromEntries(frames.map((f) => [f.id, [f.x, f.y]]));
const gapOk = (a: FrameRect, b: FrameRect) =>
  a.x >= b.x + b.w + 40 || b.x >= a.x + a.w + 40 || a.y >= b.y + b.h + 40 || b.y >= a.y + a.h + 40;
const noOverlap = (frames: FrameRect[]) =>
  frames.every((a, i) => frames.every((b, j) => i === j || gapOk(a, b)));

describe("initial layout (#221 D8, T11)", () => {
  it("without pins, from (0,0) with row width 1600, gap 80, in list order", () => {
    const placed = autoPlace(
      [
        { id: "a", w: 800, h: 276 },
        { id: "b", w: 540, h: 488 },
        { id: "c", w: 540, h: 276 },
        { id: "d", w: 280, h: 276 },
      ],
      [],
    );
    expect(at(placed)).toEqual({ a: [0, 0], b: [880, 0], c: [0, 568], d: [620, 568] });
  });

  it("one wide frame takes a row by itself", () => {
    const placed = autoPlace(
      [
        { id: "a", w: 2000, h: 100 },
        { id: "b", w: 100, h: 100 },
      ],
      [],
    );
    expect(at(placed)).toEqual({ a: [0, 0], b: [0, 180] });
  });

  it("with pins, a new row 80 below their bounding box — row width is max(1600, box width)", () => {
    const pinned = [rect("p", -200, 40, 2400, 300)];
    const placed = autoPlace(
      [
        { id: "a", w: 1200, h: 100 },
        { id: "b", w: 1000, h: 100 },
        { id: "c", w: 1000, h: 100 },
      ],
      pinned,
    );
    expect(at(placed)).toEqual({ a: [-200, 420], b: [1080, 420], c: [-200, 600] });
  });

  it("persistentLayout: pinned stay in place, new projects on a new row below, stray always at the very bottom", () => {
    const folders: FolderMeta[] = [
      folder("stray", 2, { stray: true }),
      folder("fresh", 3),
      folder("old", 2, { board: { x: 0, y: 0 } }),
    ];
    const layout = persistentLayout(folders, effectiveBoards(folders, {}), {});
    expect(at(layout.frames)).toEqual({ old: [0, 0], fresh: [0, 356], stray: [0, 712] });
    expect(layout.byId.get("old")?.pinned).toBe(true);
    expect(layout.byId.get("fresh")?.pinned).toBe(false);
    expect(layout.byId.get("stray")?.stray).toBe(true);
  });
});

describe("overlap resolution (#221 D9, T12)", () => {
  it("unchanged when nothing overlaps", () => {
    const frames = [rect("a", 0, 0), rect("b", 140, 0), rect("c", 0, 140)];
    expect(settleFrames(frames)).toEqual(frames);
  });

  it("to the right if the right is shorter, down if equal", () => {
    // b overlaps a's right end: 40 right vs 140 down
    expect(at(settleFrames([rect("a", 0, 0), rect("b", 100, 20)]))).toEqual({
      a: [0, 0],
      b: [140, 20],
    });
    // b is a's twin, shifted: 140 right vs 140 down — down
    expect(at(settleFrames([rect("a", 0, 0), rect("b", 0, 0)]))).toEqual({
      a: [0, 0],
      b: [0, 140],
    });
  });

  it("chain: a pushed frame pushes the next one", () => {
    const settled = settleFrames([rect("a", 0, 0, 100, 400), rect("b", 120, 0), rect("c", 260, 0)]);
    expect(at(settled)).toEqual({ a: [0, 0], b: [140, 0], c: [280, 0] });
    expect(noOverlap(settled)).toBe(true);
  });

  it("'first' stays put, 'later' moves aside", () => {
    const frames = [rect("a", 0, 0), rect("b", 100, 0)];
    expect(at(settleFrames(frames, { first: "b" }))).toEqual({ a: [0, 140], b: [100, 0] });
    expect(at(settleFrames([rect("a", 100, 0), rect("b", 0, 0)], { last: "a" }))).toEqual({
      a: [140, 0],
      b: [0, 0],
    });
  });

  it("terminates without overlaps even with 40 frames at one point", () => {
    const frames = Array.from({ length: 40 }, (_, i) => rect(`f${i}`, 0, 0, 300, 200));
    const settled = settleFrames(frames);
    expect(noOverlap(settled)).toBe(true);
  });

  it("below everything once the safety cap is exceeded", () => {
    const frames = [rect("a", 0, 0), rect("b", 120, 0), rect("c", 60, 0)];
    const settled = settleFrames(frames, { limit: 0 });
    expect(at(settled)).toEqual({ a: [0, 0], b: [120, 280], c: [60, 140] });
    expect(noOverlap(settled)).toBe(true);
  });
});

describe("commit plan (#221 D9, T13)", () => {
  const folders: FolderMeta[] = [
    folder("a", 3, { board: { x: 0, y: 0 } }),
    folder("b", 3),
    folder("c", 1),
    folder("s", 1, { stray: true }),
  ];

  it("unpinned frames become entries, and recomputing after applying gives an empty plan (idempotent)", () => {
    const base = effectiveBoards(folders, {});
    const plan = planCommit(persistentLayout(folders, base, {}), base, base, new Set());
    expect(plan.map((e) => e.id)).toEqual(["b", "c"]);
    expect(plan[0]!.board).toEqual({ x: 0, y: 356 });
    const overlay = Object.fromEntries(plan.map((e) => [e.id, e.board]));
    const after = effectiveBoards(folders, overlay);
    expect(planCommit(persistentLayout(folders, after, {}), after, after, new Set())).toEqual([]);
  });

  it("failed ids and stray are left out", () => {
    const base = effectiveBoards(folders, {});
    const plan = planCommit(persistentLayout(folders, base, {}), base, base, new Set(["b"]));
    expect(plan.map((e) => e.id)).toEqual(["c"]);
  });

  it("collapsed carries only set values, and becomes an entry when changed", () => {
    const placed: FolderMeta[] = [
      folder("a", 9, { board: { x: 0, y: 0, collapsed: false } }),
      folder("b", 3, { board: { x: 0, y: 1200 } }),
    ];
    const base = effectiveBoards(placed, {});
    expect(planCommit(persistentLayout(placed, base, {}), base, base, new Set())).toEqual([]);
    const next = effectiveBoards(placed, {}, { a: { collapsed: true } });
    const plan = planCommit(persistentLayout(placed, next, { first: "a" }), next, base, new Set());
    expect(plan).toEqual([{ id: "a", board: { x: 0, y: 0, collapsed: true } }]);
  });

  it("list ⊕ copy (overlay) ⊕ overrides — later wins", () => {
    const listed = [folder("a", 1, { board: { x: 1, y: 2, collapsed: true } })];
    const overlay: Record<string, BoardSpot> = { a: { x: 5, y: 6 } };
    expect(effectiveBoards(listed, overlay).get("a")).toEqual({ x: 5, y: 6 });
    expect(effectiveBoards(listed, overlay, { a: { collapsed: false } }).get("a")).toEqual({
      x: 5,
      y: 6,
      collapsed: false,
    });
    expect(effectiveBoards([folder("b", 1)], {}, { b: { collapsed: true } }).get("b")).toEqual({
      collapsed: true,
    });
  });
});

describe("drop hit-testing and new frames (#221 D13·D15, T15)", () => {
  const folders: FolderMeta[] = [
    folder("a", 3, { board: { x: 0, y: 0 } }),
    folder("b", 1, { board: { x: 0, y: 400 } }),
    folder("s", 1, { stray: true }),
  ];
  const base = effectiveBoards(folders, {});
  const layout = persistentLayout(folders, base, {});

  it("frameAtPoint is the frame containing the point, null outside", () => {
    expect(frameAtPoint(layout, { x: 10, y: 10 })?.id).toBe("a");
    expect(frameAtPoint(layout, { x: 799, y: 275 })?.id).toBe("a");
    expect(frameAtPoint(layout, { x: 900, y: 10 })).toBeNull();
  });

  it("landingFolder: the folder of the frame under the point, null outside", () => {
    expect(landingFolder(layout, { x: 10, y: 10 })).toBe("a");
    expect(landingFolder(layout, { x: 10, y: 410 })).toBe("b");
    expect(landingFolder(layout, { x: 900, y: 10 })).toBeNull();
  });

  it("a new frame goes at that point, an offset spot if occupied — other frames unchanged", () => {
    expect(placeNewFrame(layout, { x: 2000, y: 0 })).toEqual({ x: 2000, y: 0 });
    // on top of a: 840 right vs 316 down — down, then b is in the way: right of b
    expect(placeNewFrame(layout, { x: 0, y: 0 })).toEqual({ x: 320, y: 316 });
    // a new project's frame is an empty one: its message, not a card's slot (#231 D13)
    expect(NEW_FRAME).toEqual({ w: 344, h: 164 });
  });

  it("boardBounds is the box around all frames, null when there are none", () => {
    expect(boardBounds([rect("a", -10, 0), rect("b", 200, 300, 50, 50)])).toEqual({
      x: -10,
      y: 0,
      w: 260,
      h: 350,
    });
    expect(boardBounds([])).toBeNull();
  });
});

describe("drop target — another folder's frame, only when canPlace allows (#231 D15, T31)", () => {
  /** Payments › Checkout › Flows; Onboarding; a stray listing */
  const pay: FolderMeta = {
    ...folder("pay", 2, { board: { x: 0, y: 0 } }),
    folders: [
      {
        ...folder("chk", 1),
        folders: [{ ...folder("flw", 1) }],
      },
    ],
  };
  const folders: FolderMeta[] = [
    pay,
    folder("onb", 1, { board: { x: 0, y: 600 } }),
    folder("s", 1, { stray: true }),
  ];
  const layout = persistentLayout(folders, effectiveBoards(folders, {}), {});
  const onOnb = { x: 10, y: 610 };
  const onPay = { x: 10, y: 10 };
  const onStray = (() => {
    const s = layout.byId.get("s")!;
    return { x: s.x + 10, y: s.y + 10 };
  })();

  it("diagram card → another project frame ○, current frame ✕, stray ✕, empty space ✕", () => {
    expect(dropTarget(layout, "diagram:pay-0", "pay", onOnb)).toBe("onb");
    expect(dropTarget(layout, "diagram:pay-0", "pay", onPay)).toBeNull();
    expect(dropTarget(layout, "diagram:pay-0", "pay", onStray)).toBeNull();
    expect(dropTarget(layout, "diagram:pay-0", "pay", { x: 5000, y: 5000 })).toBeNull();
  });

  it("a project not found takes no card — its frame is in its place, but no way in (#253 R7)", () => {
    const lost: FolderMeta[] = [
      pay,
      folder("arc", 0, { missing: true, board: { x: 0, y: 600 }, diagrams: [] }),
    ];
    const lostLayout = persistentLayout(lost, effectiveBoards(lost, {}), {});
    expect(lostLayout.byId.get("arc")).toMatchObject({ x: 0, y: 600, pinned: true });
    expect(dropTarget(lostLayout, "diagram:pay-0", "pay", onOnb)).toBeNull();
    expect(dropTarget(lostLayout, "folder:chk", "pay", onOnb)).toBeNull();
  });

  it("folder card → another project frame ○ — with its subfolders", () => {
    expect(dropTarget(layout, "folder:chk", "pay", onOnb)).toBe("onb");
    expect(dropTarget(layout, "folder:chk", "pay", onPay)).toBeNull();
  });

  it("✕ where canPlace blocks — a folder exceeding the depth cap, an item not in the list", () => {
    // a listing deeper than allowed (an older build's): the folder would pass
    // MAX_FOLDER_DEPTH under another project too (#230 D7) — canPlace says no
    const chain = (n: number): FolderMeta =>
      n === 0 ? folder("leaf", 0) : { ...folder(`deep${n}`, 0), folders: [chain(n - 1)] };
    const tall: FolderMeta[] = [
      { ...folder("pay", 0, { board: { x: 0, y: 0 } }), folders: [chain(9)] },
      folder("onb", 1, { board: { x: 0, y: 600 } }),
    ];
    const tallLayout = persistentLayout(tall, effectiveBoards(tall, {}), {});
    expect(dropTarget(tallLayout, "folder:deep9", "pay", onOnb)).toBeNull();
    expect(dropTarget(layout, "diagram:gone", "pay", onOnb)).toBeNull();
  });
});

describe("order in a frame is sidebar order — childrenOf, nested diagrams are not flattened in (#231 D13, T25 — changes 'newest first' from #230 T26)", () => {
  // the user put the older one first; the listing's arrays follow that order (#230 D5)
  const flat: FolderMeta = {
    ...folder("pay", 0),
    order: ["diagram:old", "diagram:new"],
    diagrams: [
      { id: "old", title: "Old", updatedAt: 1, readable: true },
      { id: "new", title: "New", updatedAt: 2, readable: true },
    ],
  };
  const nested: FolderMeta = {
    ...flat,
    id: "pay2",
    order: ["diagram:old", "folder:sub", "diagram:new"],
    folders: [
      {
        ...folder("sub", 0),
        updatedAt: 1,
        diagrams: [{ id: "inner", title: "Inner", updatedAt: 9, readable: true }],
      },
    ],
  };
  const drawn = (f: FolderMeta) => {
    const layout = persistentLayout([f], effectiveBoards([f], {}), {});
    const frame = layout.byId.get(f.id)!;
    return { frame, items: frame.layout.items };
  };
  const ids = (f: FolderMeta) =>
    drawn(f).items.flatMap((i) => (i.kind === "card" || i.kind === "folder" ? [i.id] : []));

  it("project without subfolders: cards in the user's order, the stack front is the first item", () => {
    expect(ids(flat)).toEqual(["old", "new"]);
    expect(frameLayout(flat, true).items[0]).toMatchObject({ kind: "stack", front: "diagram:old" });
  });

  it("project with subfolders: folder cards in place, their diagrams are not in the frame", () => {
    expect(ids(nested)).toEqual(["old", "sub", "new"]);
    expect(drawn(nested).items.map((i) => i.kind)).toEqual(["card", "folder", "card"]);
  });

  it("the frame's folder is the list's project as is — not a flattened copy", () => {
    expect(drawn(nested).frame.folder).toBe(nested);
  });
});

describe("visible layout — folders opened in place (#231 D14, T28)", () => {
  /** Payments › Checkout (two diagrams) › Flows (one diagram); Onboarding under Payments */
  const pay: FolderMeta = {
    ...folder("pay", 1, { board: { x: 0, y: 0 } }),
    order: ["folder:chk", "diagram:pay-0"],
    folders: [
      {
        ...folder("chk", 2),
        order: ["diagram:chk-0", "diagram:chk-1", "folder:flw"],
        folders: [folder("flw", 1)],
      },
    ],
  };
  const folders: FolderMeta[] = [pay, folder("onb", 1, { board: { x: 0, y: 340 } })];
  const boards = effectiveBoards(folders, {});
  const persistent = persistentLayout(folders, boards, {});
  const kinds = (layout: ReturnType<typeof renderLayout>, id: string) =>
    layout.byId.get(id)!.layout.items.map((it) => it.kind);

  it("without an open folder, the saved layout as is — project focus, dashboard, missing folder", () => {
    expect(renderLayout(persistent, null)).toBe(persistent);
    expect(renderLayout(persistent, "pay")).toBe(persistent);
    expect(renderLayout(persistent, "gone")).toBe(persistent);
  });

  it("only the project holding the chain is relaid — its frame grows in place and neighbors move aside for now (first: project)", () => {
    const shown = renderLayout(persistent, "chk");
    const p = shown.byId.get("pay")!;
    expect([p.x, p.y]).toEqual([0, 0]);
    expect(kinds(shown, "pay")).toEqual(["sub", "card"]);
    expect(p.h).toBe(frameLayout(pay, undefined, ["chk"]).h);
    expect(shown.byId.get("onb")!.y).toBe(p.y + p.h + 40);
    expect(shown.byId.get("onb")!.layout).toBe(persistent.byId.get("onb")!.layout);
  });

  it("nested chain: project → Checkout → Flows open in turn", () => {
    const shown = renderLayout(persistent, "flw");
    const chk = shown.byId.get("pay")!.layout.items[0]!;
    expect(chk).toMatchObject({ kind: "sub", id: "chk" });
    expect(chk.kind === "sub" && chk.items.map((it) => [it.kind, "id" in it && it.id])).toEqual([
      ["card", "chk-0"],
      ["card", "chk-1"],
      ["sub", "flw"],
    ]);
  });

  it("the saved layout·commit know nothing of open folders — no subframes in persistentLayout, nothing to write", () => {
    const before = at(persistent.frames);
    renderLayout(persistent, "flw");
    expect(at(persistent.frames)).toEqual(before);
    const subs = persistent.frames.flatMap((f) => f.layout.items).filter((it) => it.kind === "sub");
    expect(subs).toEqual([]);
    const stored = new Map(folders.map((f) => [f.id, f.board!]));
    expect(planCommit(persistent, boards, stored, new Set())).toEqual([]);
  });

  describe("the drop target is the innermost frame under the pointer (#231 D15, T31)", () => {
    const shown = renderLayout(persistent, "flw");
    // pay at (0,0): chk sub at (20,64); in it chk-0, chk-1 on the first row, flw on its own row at (20, 364)
    const inChk = { x: 20 + 600, y: 64 + 20 };
    const inFlw = { x: 20 + 20 + 20, y: 64 + 364 + 20 };
    const inPay = { x: 10, y: 10 };

    it("landingFolder: that folder inside an open subframe, the deeper folder inside a nested subframe", () => {
      expect(landingFolder(shown, inPay)).toBe("pay");
      expect(landingFolder(shown, inChk)).toBe("chk");
      expect(landingFolder(shown, inFlw)).toBe("flw");
      // drawn without the open folders, the same point is the project's
      expect(landingFolder(shown, { x: 100, y: 100 })).toBe("chk");
      expect(landingFolder(persistent, { x: 100, y: 100 })).toBe("pay");
    });

    it("dropTarget: project diagram → open subframe ○, subframe card → project frame ○, current place ✕", () => {
      expect(dropTarget(shown, "diagram:pay-0", "pay", inChk)).toBe("chk");
      expect(dropTarget(shown, "diagram:pay-0", "pay", inFlw)).toBe("flw");
      expect(dropTarget(shown, "diagram:chk-0", "chk", inPay)).toBe("pay");
      expect(dropTarget(shown, "diagram:chk-0", "chk", inChk)).toBeNull();
      expect(dropTarget(shown, "diagram:pay-0", "pay", inPay)).toBeNull();
    });
  });
});
