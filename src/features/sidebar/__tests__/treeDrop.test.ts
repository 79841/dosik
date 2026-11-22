import { describe, expect, it } from "vitest";

import type { FolderMeta, ItemKey, ProjectMeta } from "../../library/libraryApi";
import { MAX_FOLDER_DEPTH } from "../../library/libraryApi";
import { placedInList } from "../../library/libraryTree";
import {
  AUTO_UNFOLD_MS,
  autoUnfoldKey,
  type DropTarget,
  dragView,
  dropAt,
  keyboardStep,
  LIST_PAD_TOP,
  placementNotice,
  ROW_HEIGHT,
  ROW_PITCH,
  refoldAfterDrag,
  rowBoxes,
} from "../treeDrop";
import { buildTree, folderKey, type TreeKey, visibleRows } from "../treeModel";

/** where a drag lands and where ⌥↑/⌥↓ go (#230 D9·D10, T13·T14) */

const diagram = (id: string, updatedAt = 1): ProjectMeta => ({
  id,
  title: id,
  updatedAt,
  readable: true,
});
const folder = (
  id: string,
  diagrams: ProjectMeta[] = [],
  folders: FolderMeta[] = [],
  extra: Partial<FolderMeta> = {},
): FolderMeta => ({ id, name: id, updatedAt: 1, diagrams, folders, ...extra });

/**
 * onb (collapsed) · pay ▾ [chk ▾ [ord] · led · pyt · arc (empty)] · My Diagrams ▾ [lost]
 * — rows 26 tall, 1 apart, from y = 100
 */
const library = (): FolderMeta[] => [
  folder("onb", [diagram("wel")], [], { order: ["diagram:wel"] }),
  folder(
    "pay",
    [diagram("led"), diagram("pyt")],
    [folder("chk", [diagram("ord")], [], { order: ["diagram:ord"] }), folder("arc")],
    { order: ["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"] },
  ),
];

const scene = (folders = library(), open = ["pay", "chk"]) => {
  const rows = visibleRows(buildTree(folders, []), new Set(open.map(folderKey)));
  const boxes = new Map<TreeKey, { top: number; bottom: number }>(
    rows.map((r, i) => [r.key, { top: 100 + i * 27, bottom: 126 + i * 27 }]),
  );
  const top = (key: TreeKey) => boxes.get(key)!.top;
  return {
    at: (dragged: ItemKey, y: number): DropTarget | null =>
      dropAt({ rows, boxes, y, dragged, folders }),
    top,
    rows,
  };
};

describe("dropAt — dragging a diagram (#230 D9, T13)", () => {
  const s = scene();
  const pyt: ItemKey = "diagram:pyt";

  it("top half of a diagram row = before it — moving up within the same parent keeps the index", () => {
    expect(s.at(pyt, s.top("diagram:led") + 3)).toEqual({
      kind: "slot",
      placement: { parent: "pay", index: 1 },
      spot: { row: "diagram:led", edge: "top", level: 2 },
    });
  });

  it("folder rows — top 7px is before, the middle is inside (at the top), the bottom 7px of an expanded folder is before its first child", () => {
    const chk = s.top("folder:chk");
    expect(s.at(pyt, chk + 2)).toEqual({
      kind: "slot",
      placement: { parent: "pay", index: 0 },
      spot: { row: "folder:chk", edge: "top", level: 2 },
    });
    expect(s.at(pyt, chk + 13)).toEqual({
      kind: "into",
      folder: "chk",
      row: "folder:chk",
      placement: { parent: "chk", index: 0 },
    });
    expect(s.at(pyt, chk + 24)).toEqual({
      kind: "slot",
      placement: { parent: "chk", index: 0 },
      spot: { row: "diagram:ord", edge: "top", level: 3 },
    });
  });

  it("the bottom 7px of a collapsed (empty) folder is after it — moving down within the same parent is −1", () => {
    expect(s.at(pyt, s.top("folder:arc") + 24)).toEqual({
      kind: "slot",
      placement: { parent: "pay", index: 3 },
      spot: { row: "folder:arc", edge: "bottom", level: 2 },
    });
  });

  it("staying in place has no target — over itself, or the bottom of the row right before it", () => {
    expect(s.at(pyt, s.top("diagram:pyt") + 5)).toBeNull();
    expect(s.at(pyt, s.top("diagram:pyt") + 20)).toBeNull();
    expect(s.at(pyt, s.top("diagram:led") + 20)).toBeNull();
  });

  it("a project row is inside along its whole height — unless it is the current parent and the item is already at the top", () => {
    expect(s.at(pyt, s.top("folder:pay") + 2)).toEqual({
      kind: "into",
      folder: "pay",
      row: "folder:pay",
      placement: { parent: "pay", index: 0 },
    });
    expect(s.at(pyt, s.top("folder:onb") + 24)).toMatchObject({ kind: "into", folder: "onb" });
    // already first of its parent: dropping into it changes nothing
    expect(s.at("folder:chk", s.top("folder:pay") + 13)).toBeNull();
  });

  it("outside the tree has no target", () => {
    expect(s.at(pyt, 50)).toBeNull();
    expect(s.at(pyt, 2000)).toBeNull();
  });

  it("the 1px gap between rows is the top of the row below", () => {
    expect(s.at(pyt, s.top("diagram:led") - 0.5)).toMatchObject({
      spot: { row: "diagram:led", edge: "top" },
    });
  });
});

describe("dropAt — dragging a folder (#230 D7·D9)", () => {
  const s = scene();

  it("no target over itself or its descendants, but inside another folder works", () => {
    expect(s.at("folder:chk", s.top("folder:chk") + 13)).toBeNull();
    expect(s.at("folder:chk", s.top("diagram:ord") + 3)).toBeNull();
    expect(s.at("folder:chk", s.top("folder:arc") + 13)).toMatchObject({
      kind: "into",
      folder: "arc",
    });
  });

  it("no target where the move would exceed the depth limit", () => {
    let deep = folder(`c${MAX_FOLDER_DEPTH}`);
    for (let k = MAX_FOLDER_DEPTH - 1; k >= 2; k--) deep = folder(`c${k}`, [], [deep]);
    const tall = folder("x", [], [folder("y")]);
    const lib = [folder("c1", [], [deep, tall])];
    const open = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => `c${i + 1}`);
    const d = scene(lib, open);
    expect(d.at("folder:x", d.top(folderKey(`c${MAX_FOLDER_DEPTH - 1}`)) + 13)).toBeNull();
    expect(d.at("folder:x", d.top(folderKey(`c${MAX_FOLDER_DEPTH - 2}`)) + 13)).toMatchObject({
      kind: "into",
    });
  });
});

describe("dropAt — dragging a project: project blocks (#230 D9)", () => {
  const s = scene();

  it("top half of a block (row + visible descendants) is before it, bottom half after it", () => {
    expect(s.at("folder:pay", s.top("folder:onb") + 5)).toEqual({
      kind: "slot",
      placement: { parent: null, index: 0 },
      spot: { row: "folder:onb", edge: "top", level: 1 },
    });
    // pay's own block: no move
    expect(s.at("folder:pay", s.top("folder:pay") + 5)).toBeNull();
    expect(s.at("folder:pay", s.top("folder:arc") + 20)).toBeNull();
    // onb past pay's lower half: the end of the projects
    expect(s.at("folder:onb", s.top("diagram:pyt") + 20)).toEqual({
      kind: "slot",
      placement: { parent: null, index: 1 },
      spot: { row: "folder:arc", edge: "bottom", level: 1 },
    });
  });

  it("above or below the list is the start or end", () => {
    expect(s.at("folder:pay", 50)).toMatchObject({ placement: { parent: null, index: 0 } });
    expect(s.at("folder:onb", 2000)).toMatchObject({ placement: { parent: null, index: 1 } });
  });
});

describe("a project not found (#253 R7)", () => {
  /** onb · lost (not found) · pay ▾ […] */
  const lost = (): FolderMeta[] => {
    const [onb, pay] = library();
    return [onb!, folder("lost", [], [], { missing: true }), pay!];
  };
  const s = scene(lost(), ["pay", "chk"]);

  it("takes nothing dropped on it — its row is no way in", () => {
    expect(s.at("diagram:pyt", s.top("folder:lost") + 13)).toBeNull();
    expect(s.at("folder:chk", s.top("folder:lost") + 2)).toBeNull();
  });

  it("keeps its place among the projects — a project dragged past it counts it", () => {
    expect(s.at("folder:onb", s.top("diagram:pyt") + 20)).toMatchObject({
      placement: { parent: null, index: 2 },
    });
    expect(s.at("folder:pay", s.top("folder:lost") + 2)).toEqual({
      kind: "slot",
      placement: { parent: null, index: 1 },
      spot: { row: "folder:lost", edge: "top", level: 1 },
    });
  });

  it("does not move itself — no drop, no ⌥↑/⌥↓", () => {
    expect(s.at("folder:lost", 50)).toBeNull();
    expect(keyboardStep(lost(), "folder:lost", -1)).toBeNull();
    expect(keyboardStep(lost(), "folder:lost", 1)).toBeNull();
    // the others step over it
    expect(keyboardStep(lost(), "folder:pay", -1)).toEqual({ parent: null, index: 1, count: 3 });
  });
});

describe("keyboardStep (#230 D10, T14)", () => {
  it("a slot between siblings — edge at the ends", () => {
    expect(keyboardStep(library(), "diagram:led", 1)).toEqual({
      parent: "pay",
      index: 2,
      count: 4,
    });
    expect(keyboardStep(library(), "folder:chk", -1)).toEqual({ edge: "first" });
    expect(keyboardStep(library(), "folder:arc", 1)).toEqual({ edge: "last" });
    expect(keyboardStep(library(), "folder:pay", -1)).toEqual({
      parent: null,
      index: 0,
      count: 2,
    });
  });

  it("announcement sentences", () => {
    expect(placementNotice(library(), "Payouts", { parent: "pay", index: 1 }, 4)).toBe(
      "Moved “Payouts” to position 2 of 4 in pay",
    );
    expect(placementNotice(library(), "Payments", { parent: null, index: 0 }, 3)).toBe(
      "Moved “Payments” to position 1 of 3 projects",
    );
  });
});

describe("rowBoxes — the rows where they stand, worked out (#260)", () => {
  it("rows 30 tall, 31 apart, from the origin — the list's top padding is 2", () => {
    expect([ROW_HEIGHT, ROW_PITCH, LIST_PAD_TOP]).toEqual([30, 31, 2]);
    const rows = visibleRows(buildTree(library(), []), new Set([folderKey("pay")]));
    const boxes = rowBoxes(rows, 100);
    expect(boxes.get("folder:onb")).toEqual({ top: 100, bottom: 130 });
    expect(boxes.get("folder:pay")).toEqual({ top: 131, bottom: 161 });
    expect(boxes.get(rows.at(-1)!.key)).toEqual({
      top: 100 + (rows.length - 1) * 31,
      bottom: 130 + (rows.length - 1) * 31,
    });
    expect(boxes.size).toBe(rows.length);
  });
});

/**
 * The scene as a drag sees it: the dragged folder's rows folded away, the
 * boxes worked out from y = 100.
 */
const dragScene = (dragged: ItemKey, folders = library(), open = ["pay", "chk"]) => {
  const expanded = new Set(open.map(folderKey));
  expanded.delete(dragged);
  const rows = visibleRows(buildTree(folders, []), expanded);
  const boxes = rowBoxes(rows, 100);
  const top = (key: TreeKey) => boxes.get(key)!.top;
  const target = (y: number) => dropAt({ rows, boxes, y, dragged, folders });
  const view = (y: number) => dragView({ rows, dragged, target: target(y) });
  return { rows, top, target, view, expanded, folders };
};

describe("dragView — the rows with the drop's preview (#260 R2)", () => {
  it("a slot among siblings: the dragged row leaves its place, its preview stands at the slot's depth, the rows between move", () => {
    const s = dragScene("diagram:pyt");
    const v = s.view(s.top("diagram:led") + 3);
    expect(v.shown.map((r) => `${r.key}@${r.level}`)).toEqual([
      "folder:onb@1",
      "folder:pay@1",
      "folder:chk@2",
      "diagram:ord@3",
      "diagram:pyt@2",
      "diagram:led@2",
      "folder:arc@2",
    ]);
    expect(v.preview).toEqual({ index: 4, level: 2 });
    expect(v.offsets).toEqual(new Map([["diagram:led", 31]]));
  });

  it("dragging up into another folder's slot: the preview takes that depth, every row in between moves down", () => {
    const s = dragScene("diagram:pyt");
    // the bottom band of the unfolded chk: before its first item, level 3
    const v = s.view(s.top("folder:chk") + 28);
    expect(v.preview).toEqual({ index: 3, level: 3 });
    expect(v.offsets).toEqual(
      new Map([
        ["diagram:ord", 31],
        ["diagram:led", 31],
      ]),
    );
  });

  it("dragging down: the rows between the place and the slot move up", () => {
    const s = dragScene("diagram:led");
    const v = s.view(s.top("folder:arc") + 28);
    expect(v.preview).toEqual({ index: 6, level: 2 });
    expect(v.offsets).toEqual(
      new Map([
        ["diagram:pyt", -31],
        ["folder:arc", -31],
      ]),
    );
  });

  it("into an unfolded folder: the preview is its first item, one level deeper — the folder row itself does not move", () => {
    const s = dragScene("diagram:pyt");
    const v = s.view(s.top("folder:chk") + 15);
    expect(s.target(s.top("folder:chk") + 15)).toMatchObject({ kind: "into", row: "folder:chk" });
    expect(v.preview).toEqual({ index: 3, level: 3 });
    expect(v.shown[3]).toEqual({ key: "diagram:pyt", level: 3 });
    expect(v.offsets.has("folder:chk")).toBe(false);
    expect(v.offsets.get("diagram:ord")).toBe(31);
  });

  it("into a collapsed folder: no preview, the dragged row keeps its place (empty) and nothing moves", () => {
    const s = dragScene("diagram:pyt");
    for (const y of [s.top("folder:onb") + 15, s.top("folder:arc") + 15]) {
      expect(s.target(y)).toMatchObject({ kind: "into" });
      const v = s.view(y);
      expect(v.preview).toBeNull();
      expect(v.shown.map((r) => r.key)).toEqual(s.rows.map((r) => r.key));
      expect(v.offsets.size).toBe(0);
    }
  });

  it("no target: the preview stays in the dragged row's own place and nothing moves", () => {
    const s = dragScene("diagram:pyt");
    const v = s.view(s.top("diagram:pyt") + 5);
    expect(v.preview).toEqual({ index: 5, level: 2 });
    expect(v.shown).toHaveLength(s.rows.length);
    expect(v.offsets.size).toBe(0);
    expect(dragView({ rows: s.rows, dragged: "diagram:pyt", target: null }).preview).toEqual({
      index: 5,
      level: 2,
    });
  });

  it("a project goes by whole blocks: its preview is the folded project row at level 1, an unfolded project moves with its rows", () => {
    const s = dragScene("folder:onb");
    // onb past pay's lower half: after pay's block, at the end
    const v = s.view(s.top("diagram:pyt") + 20);
    expect(v.preview).toEqual({ index: 6, level: 1 });
    expect([...v.offsets.keys()]).toEqual([
      "folder:pay",
      "folder:chk",
      "diagram:ord",
      "diagram:led",
      "diagram:pyt",
      "folder:arc",
    ]);
    expect(new Set(v.offsets.values())).toEqual(new Set([-31]));
  });

  it("dragging an unfolded folder folds it: its rows are not among the rows, the preview is one row", () => {
    const s = dragScene("folder:pay");
    expect(s.rows.map((r) => r.key)).toEqual(["folder:onb", "folder:pay"]);
    const v = s.view(s.top("folder:onb") + 5);
    expect(v.preview).toEqual({ index: 0, level: 1 });
    expect(v.offsets).toEqual(new Map([["folder:onb", 31]]));

    const c = dragScene("folder:chk");
    expect(c.rows.some((r) => r.key === "diagram:ord")).toBe(false);
    const w = c.view(c.top("diagram:pyt") + 25);
    expect(w.preview).toEqual({ index: 4, level: 2 });
    expect(w.offsets).toEqual(
      new Map([
        ["diagram:led", -31],
        ["diagram:pyt", -31],
      ]),
    );
  });

  it("the rows the drag shows are the rows the drop leaves — no jump on release (every y, diagrams, folders, projects)", () => {
    let checked = 0;
    for (const dragged of [
      "diagram:pyt",
      "diagram:ord",
      "diagram:lost",
      "folder:chk",
      "folder:arc",
      "folder:pay",
      "folder:onb",
    ] as ItemKey[]) {
      const s = dragScene(dragged);
      const end = 100 + s.rows.length * ROW_PITCH + 10;
      for (let y = 90; y < end; y++) {
        const target = s.target(y);
        if (!target) continue;
        const v = s.view(y);
        if (!v.preview) {
          expect(target.kind).toBe("into");
          continue;
        }
        const after = visibleRows(
          buildTree(placedInList(s.folders, dragged, target.placement), []),
          s.expanded,
        );
        expect(v.shown.map((r) => `${r.key}@${r.level}`)).toEqual(
          after.map((r) => `${r.key}@${r.level}`),
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("autoUnfoldKey — the folder a drag resting on it would unfold (#260 R3)", () => {
  it("waits 600ms", () => {
    expect(AUTO_UNFOLD_MS).toBe(600);
  });

  it("into a collapsed folder or project that has something in it — its key", () => {
    const s = dragScene("diagram:pyt", library(), ["pay"]);
    const chk = s.target(s.top("folder:chk") + 15);
    expect(chk).toMatchObject({ kind: "into", row: "folder:chk" });
    expect(autoUnfoldKey(chk, s.rows)).toBe("folder:chk");
    expect(autoUnfoldKey(s.target(s.top("folder:onb") + 15), s.rows)).toBe("folder:onb");
  });

  it("nothing for an unfolded folder, an empty one, a slot or no target", () => {
    const s = dragScene("diagram:pyt");
    expect(autoUnfoldKey(s.target(s.top("folder:chk") + 15), s.rows)).toBeNull();
    // arc holds nothing: nothing to unfold
    expect(s.target(s.top("folder:arc") + 15)).toMatchObject({ kind: "into" });
    expect(autoUnfoldKey(s.target(s.top("folder:arc") + 15), s.rows)).toBeNull();
    expect(autoUnfoldKey(s.target(s.top("diagram:led") + 3), s.rows)).toBeNull();
    expect(autoUnfoldKey(null, s.rows)).toBeNull();
  });

  it("never itself or a folder inside it — those take no drop", () => {
    const s = dragScene("folder:chk", library(), ["pay"]);
    expect(autoUnfoldKey(s.target(s.top("folder:chk") + 15), s.rows)).toBeNull();
  });
});

describe("refoldAfterDrag — what a drag unfolded folds back when it ends (#260 R3)", () => {
  const nested = (): FolderMeta[] => [
    folder("p", [], [folder("a", [diagram("d")], [folder("b", [diagram("e")])]), folder("c")]),
  ];

  it("dropped in an unfolded folder, or anywhere under it: it stays open", () => {
    expect(refoldAfterDrag(["folder:a"], "a", nested())).toEqual([]);
    expect(refoldAfterDrag(["folder:a", "folder:b"], "b", nested())).toEqual([]);
  });

  it("cancelled, or dropped outside it: it folds back — each folder on its own", () => {
    expect(refoldAfterDrag(["folder:a", "folder:b"], null, nested())).toEqual([
      "folder:a",
      "folder:b",
    ]);
    expect(refoldAfterDrag(["folder:a", "folder:b"], "a", nested())).toEqual(["folder:b"]);
    expect(refoldAfterDrag(["folder:a"], "c", nested())).toEqual(["folder:a"]);
    expect(refoldAfterDrag(["folder:a"], "p", nested())).toEqual(["folder:a"]);
  });

  it("nothing unfolded, nothing folds", () => {
    expect(refoldAfterDrag([], null, nested())).toEqual([]);
  });
});
