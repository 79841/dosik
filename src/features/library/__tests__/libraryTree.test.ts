import { describe, expect, it } from "vitest";

import { type FolderMeta, MAX_FOLDER_DEPTH, type ProjectMeta } from "../libraryApi";
import {
  allDiagrams,
  canHoldFolders,
  canMoveDiagrams,
  childrenOf,
  diagramsUnder,
  findDiagram,
  findFolder,
  folderList,
  foldersUnder,
  isInside,
  itemCount,
  newestFirst,
  projectOf,
  savableFolder,
} from "../libraryTree";

const diagram = (id: string, updatedAt = 1, title = id): ProjectMeta => ({
  id,
  title,
  updatedAt,
  readable: true,
});

const folder = (
  id: string,
  name: string,
  updatedAt: number,
  diagrams: ProjectMeta[] = [],
  folders: FolderMeta[] = [],
  extra: Partial<FolderMeta> = {},
): FolderMeta => ({ id, name, updatedAt, diagrams, folders, ...extra });

/** the spec's example (#229 "disk and listing example") with a second project and a stray listing */
const library = (): FolderMeta[] => [
  folder(
    "pay",
    "Payments",
    1761900000000,
    [diagram("led", 1761800000000, "Ledger schema")],
    [
      folder(
        "chk",
        "Checkout",
        1761900000000,
        [diagram("ord", 1761900000000, "Order flow")],
        [folder("flw", "Flows", 1730000600000)],
      ),
    ],
  ),
  folder("on", "Onboarding", 2, [diagram("wel", 2)], [folder("auth", "Auth", 1)]),
  folder("default", "My Diagrams", 1, [diagram("lost", 1)], [], { stray: true }),
];

/** the library's shape, worked out in one pure module (#229 D10) */
describe("libraryTree (#229 D8·D10, T33)", () => {
  it("childrenOf — without order, mixes folders and diagrams by recency, ties by key (#230 D2)", () => {
    const pay = library()[0]!;
    expect(
      childrenOf(pay).map((c) => [c.kind, c.kind === "folder" ? c.folder.id : c.diagram.id]),
    ).toEqual([
      ["folder", "chk"],
      ["diagram", "led"],
    ]);
    // a tie goes to the lower key — `diagram:` before `folder:`, as Rust breaks it
    const tied = folder("t", "T", 5, [diagram("b", 5), diagram("z", 5)], [folder("m", "M", 5)]);
    expect(childrenOf(tied).map((c) => (c.kind === "folder" ? c.folder.id : c.diagram.id))).toEqual(
      ["b", "z", "m"],
    );
  });

  it("findFolder — at any depth, with the path from the top down to that folder", () => {
    const found = findFolder(library(), "flw");
    expect(found?.folder.name).toBe("Flows");
    expect(found?.path.map((f) => f.id)).toEqual(["pay", "chk", "flw"]);
    expect(findFolder(library(), "pay")?.path.map((f) => f.id)).toEqual(["pay"]);
    expect(findFolder(library(), "nope")).toBeNull();
  });

  it("findDiagram — the diagram, its folder, and the path from the top to that folder", () => {
    const found = findDiagram(library(), "ord");
    expect(found?.diagram.title).toBe("Order flow");
    expect(found?.folder.id).toBe("chk");
    expect(found?.path.map((f) => f.name)).toEqual(["Payments", "Checkout"]);
    expect(findDiagram(library(), "led")?.path.map((f) => f.id)).toEqual(["pay"]);
    // a stray listing's diagram: My Diagrams
    expect(findDiagram(library(), "lost")?.path.map((f) => f.name)).toEqual(["My Diagrams"]);
    expect(findDiagram(library(), "nope")).toBeNull();
  });

  it("diagramsUnder — diagrams at every depth below that folder, by recency", () => {
    expect(diagramsUnder(library()[0]!).map((d) => d.id)).toEqual(["ord", "led"]);
    expect(diagramsUnder(folder("e", "E", 1))).toEqual([]);
  });

  it("allDiagrams — every diagram in the library with its folder and path", () => {
    const all = allDiagrams(library());
    expect(all.map((e) => e.diagram.id).sort()).toEqual(["led", "lost", "ord", "wel"]);
    expect(all.find((e) => e.diagram.id === "ord")?.path.map((f) => f.id)).toEqual(["pay", "chk"]);
  });

  it("itemCount — direct child folders + diagrams", () => {
    const [pay, on] = library();
    expect(itemCount(pay!)).toBe(2);
    expect(itemCount(on!)).toBe(2);
    expect(itemCount(findFolder(library(), "flw")!.folder)).toBe(0);
  });

  it("folderList — real folders only, depth first, with their depth (stray excluded)", () => {
    expect(folderList(library()).map(({ folder: f, depth }) => [f.id, depth])).toEqual([
      ["pay", 1],
      ["chk", 2],
      ["flw", 3],
      ["on", 1],
      ["auth", 2],
    ]);
  });

  it("isInside — the folder itself or anything below it (folder or diagram)", () => {
    const lib = library();
    expect(isInside(lib, "flw", "pay")).toBe(true);
    expect(isInside(lib, "ord", "chk")).toBe(true);
    expect(isInside(lib, "chk", "chk")).toBe(true);
    expect(isInside(lib, "led", "chk")).toBe(false);
    expect(isInside(lib, "wel", "pay")).toBe(false);
    expect(isInside(lib, "nope", "pay")).toBe(false);
  });

  it("projectOf — the top-level project holding a folder or diagram", () => {
    const lib = library();
    expect(projectOf(lib, "flw")?.id).toBe("pay");
    expect(projectOf(lib, "ord")?.id).toBe("pay");
    expect(projectOf(lib, "pay")?.id).toBe("pay");
    expect(projectOf(lib, "auth")?.id).toBe("on");
    expect(projectOf(lib, "nope")).toBeNull();
  });

  it("foldersUnder — the number of folders at every depth below, excluding itself", () => {
    const [pay, on] = library();
    expect(foldersUnder(pay!)).toBe(2);
    expect(foldersUnder(on!)).toBe(1);
    expect(foldersUnder(findFolder(library(), "flw")!.folder)).toBe(0);
  });

  it("savableFolder — a real folder at any depth; stray, missing and null give null", () => {
    const lib = library();
    expect(savableFolder(lib, "flw")?.name).toBe("Flows");
    expect(savableFolder(lib, "pay")?.name).toBe("Payments");
    expect(savableFolder(lib, "default")).toBeNull();
    expect(savableFolder(lib, "nope")).toBeNull();
    expect(savableFolder(lib, null)).toBeNull();
    expect(savableFolder(null, "pay")).toBeNull();
  });

  it("canMoveDiagrams — only when there are two or more real folders (stray not counted)", () => {
    expect(canMoveDiagrams(library())).toBe(true);
    expect(canMoveDiagrams([folder("solo", "Solo", 1)])).toBe(false);
    expect(
      canMoveDiagrams([
        folder("solo", "Solo", 1),
        folder("default", "My Diagrams", 1, [], [], { stray: true }),
      ]),
    ).toBe(false);
    expect(canMoveDiagrams([folder("solo", "Solo", 1, [], [folder("sub", "Sub", 1)])])).toBe(true);
  });

  it("newestFirst — most recent first, ties by id", () => {
    expect(
      [diagram("b", 1), diagram("c", 2), diagram("a", 1)].sort(newestFirst).map((d) => d.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("canHoldFolders — a folder at level 10 (MAX_FOLDER_DEPTH) cannot hold more (#229)", () => {
    // a chain: project c1 › c2 › … › c10
    let deepest = folder("c10", "C10", 1);
    for (let k = 9; k >= 1; k--) deepest = folder(`c${k}`, `C${k}`, 1, [], [deepest]);
    const lib = [deepest];
    expect(MAX_FOLDER_DEPTH).toBe(10);
    expect(canHoldFolders(lib, "c1")).toBe(true);
    expect(canHoldFolders(lib, "c9")).toBe(true);
    expect(canHoldFolders(lib, "c10")).toBe(false);
    expect(canHoldFolders(lib, "gone")).toBe(false);
  });
});
