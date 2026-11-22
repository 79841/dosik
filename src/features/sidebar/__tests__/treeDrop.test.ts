import { describe, expect, it } from "vitest";

import type { FolderMeta, ItemKey, ProjectMeta } from "../../library/libraryApi";
import { MAX_FOLDER_DEPTH } from "../../library/libraryApi";
import { type DropTarget, dropAt, keyboardStep, placementNotice } from "../treeDrop";
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
      line: { row: "diagram:led", edge: "top", level: 2 },
    });
  });

  it("folder rows — top 7px is before, the middle is inside (at the top), the bottom 7px of an expanded folder is before its first child", () => {
    const chk = s.top("folder:chk");
    expect(s.at(pyt, chk + 2)).toEqual({
      kind: "slot",
      placement: { parent: "pay", index: 0 },
      line: { row: "folder:chk", edge: "top", level: 2 },
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
      line: { row: "diagram:ord", edge: "top", level: 3 },
    });
  });

  it("the bottom 7px of a collapsed (empty) folder is after it — moving down within the same parent is −1", () => {
    expect(s.at(pyt, s.top("folder:arc") + 24)).toEqual({
      kind: "slot",
      placement: { parent: "pay", index: 3 },
      line: { row: "folder:arc", edge: "bottom", level: 2 },
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
      line: { row: "diagram:led", edge: "top" },
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
      line: { row: "folder:onb", edge: "top", level: 1 },
    });
    // pay's own block: no move
    expect(s.at("folder:pay", s.top("folder:pay") + 5)).toBeNull();
    expect(s.at("folder:pay", s.top("folder:arc") + 20)).toBeNull();
    // onb past pay's lower half: the end of the projects
    expect(s.at("folder:onb", s.top("diagram:pyt") + 20)).toEqual({
      kind: "slot",
      placement: { parent: null, index: 1 },
      line: { row: "folder:arc", edge: "bottom", level: 1 },
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
      line: { row: "folder:lost", edge: "top", level: 1 },
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
