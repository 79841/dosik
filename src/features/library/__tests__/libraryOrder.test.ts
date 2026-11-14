import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type FolderMeta,
  itemKey,
  listLibrary,
  MAX_FOLDER_DEPTH,
  moveFolder,
  moveProject,
  parseItemKey,
  type ProjectMeta,
  reorderItem,
} from "../libraryApi";
import {
  canMoveFolder,
  canPlace,
  childKey,
  childrenOf,
  heightOf,
  latestProject,
  placedInList,
  siblingsOf,
} from "../libraryTree";
import { defaultTarget } from "../targets";

/** the order of a folder's items and of the projects (#230 D2·D5·D7·D13) */

const mockedInvoke = vi.mocked(invoke);

const diagram = (id: string, updatedAt = 1): ProjectMeta => ({
  id,
  title: id,
  updatedAt,
  readable: true,
});

const folder = (
  id: string,
  updatedAt: number,
  diagrams: ProjectMeta[] = [],
  folders: FolderMeta[] = [],
  extra: Partial<FolderMeta> = {},
): FolderMeta => ({ id, name: id, updatedAt, diagrams, folders, ...extra });

/**
 * The spec's example: Payments holds Checkout (with Order flow), Ledger,
 * Payouts and Archive in the user's order; Onboarding first among the
 * projects; a stray listing last.
 */
const library = (): FolderMeta[] => [
  folder("onb", 1, [diagram("wel", 1)], [], { order: ["diagram:wel"] }),
  folder(
    "pay",
    9,
    [diagram("led", 8), diagram("pyt", 2)],
    [
      folder("chk", 9, [diagram("ord", 9)], [], { order: ["diagram:ord"] }),
      folder("arc", 3, [], [], { order: [] }),
    ],
    { order: ["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"] },
  ),
  folder("my-diagrams", 0, [diagram("lost", 0)], [], { stray: true, order: ["diagram:lost"] }),
];

const keysOf = (f: FolderMeta) => childrenOf(f).map(childKey);
const find = (folders: FolderMeta[], id: string): FolderMeta => {
  for (const f of folders) {
    if (f.id === id) return f;
    const inner = f.folders.length ? find(f.folders, id) : null;
    if (inner) return inner;
  }
  return null as unknown as FolderMeta;
};

describe("item keys (#230 D1)", () => {
  it("folder:<id>·diagram:<id> — the same strings as tree keys", () => {
    expect(itemKey("folder", "chk")).toBe("folder:chk");
    expect(itemKey("diagram", "led")).toBe("diagram:led");
    expect(parseItemKey("folder:chk")).toEqual({ kind: "folder", id: "chk" });
    expect(parseItemKey("diagram:led")).toEqual({ kind: "diagram", id: "led" });
    expect(parseItemKey("page:x")).toBeNull();
    expect(parseItemKey("folder:")).toBeNull();
  });
});

describe("listing API (#230 D5, T10)", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("listLibrary keeps order and drops it when it is not a string list — root array order is kept too", async () => {
    mockedInvoke.mockResolvedValueOnce([
      { id: "b", name: "B", updatedAt: 1, diagrams: [], folders: [], order: ["x", 3] },
      {
        id: "a",
        name: "A",
        updatedAt: 9,
        diagrams: [],
        folders: [{ id: "s", name: "S", updatedAt: 1, diagrams: [], order: "no" }],
        order: ["folder:s"],
      },
    ]);
    const listed = await listLibrary();
    expect(listed.map((f) => f.id)).toEqual(["b", "a"]);
    expect(listed[0]?.order).toBeUndefined();
    expect(listed[1]?.order).toEqual(["folder:s"]);
    expect(listed[1]?.folders[0]?.order).toBeUndefined();
  });

  it("moveProject·moveFolder·reorderItem — index is not sent when omitted", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await moveProject("led", "chk");
    await moveProject("led", "chk", 2);
    await moveFolder("chk", "arc");
    await moveFolder("chk", "arc", 0);
    await reorderItem("pay", "diagram:pyt", 1);
    await reorderItem(null, "folder:pay", 0);
    expect(mockedInvoke.mock.calls).toEqual([
      ["move_project", { id: "led", folder: "chk" }],
      ["move_project", { id: "led", folder: "chk", index: 2 }],
      ["move_folder", { id: "chk", parent: "arc" }],
      ["move_folder", { id: "chk", parent: "arc", index: 0 }],
      ["reorder_item", { parent: "pay", item: "diagram:pyt", index: 1 }],
      ["reorder_item", { item: "folder:pay", index: 0 }],
    ]);
  });
});

describe("childrenOf — manual order (#230 D5, T11)", () => {
  it("mixes folders and diagrams following order", () => {
    expect(keysOf(find(library(), "pay"))).toEqual([
      "folder:chk",
      "diagram:led",
      "diagram:pyt",
      "folder:arc",
    ]);
  });

  it("items missing from order go on top by recency; unknown keys are skipped", () => {
    const pay = find(library(), "pay");
    const f: FolderMeta = {
      ...pay,
      diagrams: [...pay.diagrams, diagram("new", 20), diagram("new2", 10)],
      order: ["diagram:gone", ...(pay.order ?? [])],
    };
    expect(keysOf(f)).toEqual([
      "diagram:new",
      "diagram:new2",
      "folder:chk",
      "diagram:led",
      "diagram:pyt",
      "folder:arc",
    ]);
  });

  it("without order, by recency as in #229", () => {
    const f = folder("x", 1, [diagram("a", 1), diagram("b", 3)], [folder("c", 2)]);
    expect(keysOf(f)).toEqual(["diagram:b", "folder:c", "diagram:a"]);
  });
});

describe("latestProject — independent of array order (#230 D5, T12)", () => {
  it("the real project with the most recent descendant, ties go to the smaller id", () => {
    expect(latestProject(library())?.id).toBe("pay");
    const tie = [folder("b", 5), folder("a", 5), folder("z", 9, [], [], { stray: true })];
    expect(latestProject(tie)?.id).toBe("a");
    expect(latestProject([])).toBeNull();
    expect(latestProject(null)).toBeNull();
  });

  it("defaultTarget is the most recent project, not the first in manual order", () => {
    expect(library()[0]?.id).toBe("onb");
    expect(defaultTarget(library())?.id).toBe("pay");
  });
});

describe("where things can go (#230 D7)", () => {
  it("heightOf — 1 for itself plus down to the deepest descendant", () => {
    expect(heightOf(folder("x", 1))).toBe(1);
    expect(heightOf(folder("x", 1, [], [folder("y", 1, [], [folder("z", 1)])]))).toBe(3);
  });

  it("canPlace — projects only at the root, folders and diagrams only inside real folders", () => {
    const lib = library();
    expect(canPlace(lib, "folder:pay", null)).toBe(true);
    expect(canPlace(lib, "folder:pay", "onb")).toBe(false);
    expect(canPlace(lib, "diagram:led", null)).toBe(false);
    expect(canPlace(lib, "folder:chk", null)).toBe(false);
    expect(canPlace(lib, "diagram:led", "chk")).toBe(true);
    expect(canPlace(lib, "diagram:led", "my-diagrams")).toBe(false);
    expect(canPlace(lib, "folder:chk", "onb")).toBe(true);
    expect(canPlace(lib, "folder:chk", "arc")).toBe(true);
    expect(canPlace(lib, "folder:chk", "gone")).toBe(false);
    // the stray listing's diagram can go out to a real folder
    expect(canPlace(lib, "diagram:lost", "pay")).toBe(true);
  });

  it("canPlace — a folder does not go into itself or its descendants", () => {
    const lib = library();
    const inner = folder("in", 1);
    const chk = find(lib, "chk");
    chk.folders = [inner];
    expect(canPlace(lib, "folder:chk", "chk")).toBe(false);
    expect(canPlace(lib, "folder:chk", "in")).toBe(false);
    expect(canPlace(lib, "folder:in", "arc")).toBe(true);
  });

  it("canPlace — the deepest descendant stays within the limit after the move", () => {
    // a chain c2 … c(MAX) under project c1: c(MAX - 1) is at depth MAX - 1
    let deepest = folder(`c${MAX_FOLDER_DEPTH}`, 1);
    for (let k = MAX_FOLDER_DEPTH - 1; k >= 2; k--) deepest = folder(`c${k}`, 1, [], [deepest]);
    const tall = folder("x", 1, [], [folder("y", 1)]);
    const lib = [folder("c1", 1, [], [deepest, tall])];
    expect(canPlace(lib, "folder:x", `c${MAX_FOLDER_DEPTH - 2}`)).toBe(true);
    expect(canPlace(lib, "folder:x", `c${MAX_FOLDER_DEPTH - 1}`)).toBe(false);
    expect(canPlace(lib, "folder:y", `c${MAX_FOLDER_DEPTH - 1}`)).toBe(true);
  });

  it("canMoveFolder — when there is at least one place other than the current parent", () => {
    expect(canMoveFolder(library(), "chk")).toBe(true);
    expect(canMoveFolder([folder("p", 1, [], [folder("only", 1)])], "only")).toBe(false);
    expect(canMoveFolder(library(), "pay")).toBe(false);
  });
});

describe("placedInList — the list shown right away (#230 D13, T11)", () => {
  it("reorders within the same parent", () => {
    const next = placedInList(library(), "diagram:pyt", { parent: "pay", index: 1 });
    expect(keysOf(find(next, "pay"))).toEqual([
      "folder:chk",
      "diagram:pyt",
      "diagram:led",
      "folder:arc",
    ]);
    expect(find(next, "pay").diagrams.map((d) => d.id)).toEqual(["pyt", "led"]);
  });

  it("to another parent — leaves its old spot and takes that spot in the target; untouched places keep the same object", () => {
    const before = library();
    const next = placedInList(before, "diagram:led", { parent: "chk", index: 0 });
    expect(keysOf(find(next, "chk"))).toEqual(["diagram:led", "diagram:ord"]);
    expect(keysOf(find(next, "pay"))).toEqual(["folder:chk", "diagram:pyt", "folder:arc"]);
    expect(next[0]).toBe(before[0]);
    const folderMoved = placedInList(before, "folder:chk", { parent: "arc", index: 0 });
    expect(keysOf(find(folderMoved, "arc"))).toEqual(["folder:chk"]);
    expect(find(folderMoved, "pay").folders.map((f) => f.id)).toEqual(["arc"]);
  });

  it("project order — the stray list stays at the end", () => {
    const next = placedInList(library(), "folder:pay", { parent: null, index: 0 });
    expect(next.map((f) => f.id)).toEqual(["pay", "onb", "my-diagrams"]);
    const end = placedInList(library(), "folder:onb", { parent: null, index: 99 });
    expect(end.map((f) => f.id)).toEqual(["pay", "onb", "my-diagrams"]);
  });

  it("a parent without order starts from the order it showed", () => {
    const lib = [folder("p", 5, [diagram("a", 1), diagram("b", 3)]), folder("q", 1)];
    const next = placedInList(lib, "diagram:a", { parent: "p", index: 0 });
    expect(find(next, "p").order).toEqual(["diagram:a", "diagram:b"]);
  });

  it("items or parents not in the listing are left as is", () => {
    const lib = library();
    expect(placedInList(lib, "diagram:ghost", { parent: "pay", index: 0 })).toBe(lib);
    expect(placedInList(lib, "diagram:led", { parent: "gone", index: 0 })).toBe(lib);
  });
});

describe("siblingsOf (#230 D10)", () => {
  it("parent, sibling keys and position — the root for projects, null for stray", () => {
    expect(siblingsOf(library(), "diagram:pyt")).toEqual({
      parent: "pay",
      keys: ["folder:chk", "diagram:led", "diagram:pyt", "folder:arc"],
      index: 2,
    });
    expect(siblingsOf(library(), "folder:pay")).toEqual({
      parent: null,
      keys: ["folder:onb", "folder:pay"],
      index: 1,
    });
    expect(siblingsOf(library(), "diagram:lost")).toBeNull();
    expect(siblingsOf(library(), "folder:my-diagrams")).toBeNull();
    expect(siblingsOf(library(), "diagram:ghost")).toBeNull();
  });
});
