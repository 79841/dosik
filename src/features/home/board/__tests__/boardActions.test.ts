import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "../../../../shared/lib/toastStore";
import { useAppStore } from "../../../library/appStore";
import type { BoardSpot, FolderMeta } from "../../../library/libraryApi";
import { resetPlacementsForTests } from "../../../library/libraryActions";
import { useLibraryStore } from "../../../library/libraryStore";
import { resetTabsForTests } from "../../../library/tabActions";
import { resetAutosaveForTests } from "../../../library/useAutosave";
import {
  commitBoard,
  dropFrame,
  moveCardInto,
  newProjectAt,
  resetBoardActionsForTests,
  setCollapsed,
} from "../boardActions";
import { resetBoardForTests, useBoardStore } from "../boardStore";
import { folder } from "./boardFixtures";

const mockedInvoke = vi.mocked(invoke);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const sentBoards = (n = 0) =>
  (calls("set_folder_boards")[n]![1] as { boards: { id: string; board: BoardSpot }[] }).boards;
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const overlay = () => useBoardStore.getState().overlay;

let listed: FolderMeta[] = [];
type Pending = { resolve: () => void; reject: (e: unknown) => void };
let held: Pending[] = [];
/** while true, set_folder_boards waits until the test lets it go */
let holdWrites = false;
/** the call itself fails (it rejects) */
let failWrites: ((boards: { id: string }[]) => unknown) | null = null;
/** some projects cannot take their place: Rust names them, the rest are written */
let refuseWrites: ((boards: { id: string }[]) => { id: string; error: string }[]) | null = null;

const serve = () =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === "list_library") return listed;
    if (cmd === "set_folder_boards") {
      const boards = (args as { boards: { id: string }[] }).boards;
      if (failWrites) throw failWrites(boards);
      if (holdWrites) {
        await new Promise<void>((resolve, reject) => held.push({ resolve, reject }));
      }
      return refuseWrites ? refuseWrites(boards) : [];
    }
    return undefined;
  });

const setFolders = (folders: FolderMeta[]) => {
  listed = folders;
  useLibraryStore.setState({ folders, readFailed: false });
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("board actions (#221 D9, T23)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    resetTabsForTests();
    resetAutosaveForTests();
    useToastStore.getState().dismissAll();
    held = [];
    holdWrites = false;
    failWrites = null;
    refuseWrites = null;
    serve();
  });

  it("only the diff in a single set_folder_boards — applied to the copy the moment it is sent", async () => {
    setFolders([folder("a", 3, { board: { x: 0, y: 0 } }), folder("b", 2), folder("c", 1)]);
    holdWrites = true;
    const done = commitBoard({});
    expect(overlay()).toEqual({ b: { x: 0, y: 356 }, c: { x: 620, y: 356 } });
    await flush();
    expect(calls("set_folder_boards")).toHaveLength(1);
    expect(sentBoards().map((e) => e.id)).toEqual(["b", "c"]);
    held[0]!.resolve();
    expect(await done).toBe(true);
  });

  it("does not write when nothing changed", async () => {
    setFolders([folder("a", 3, { board: { x: 0, y: 0 } })]);
    expect(await commitBoard({})).toBe(true);
    expect(calls("set_folder_boards")).toHaveLength(0);
  });

  it("does not write folders opened in place — the saved position stays even if an open subframe enlarges the frame (#231 D14, T28)", async () => {
    // Checkout open in Payments would push Onboarding down on screen — only on screen
    const pay = {
      ...folder("pay", 1, { board: { x: 0, y: 0 } }),
      folders: [folder("chk", 5)],
    };
    setFolders([pay, folder("onb", 1, { board: { x: 0, y: 360 } })]);
    useAppStore.setState({ homeView: { kind: "folder", folder: "chk" } });
    expect(await commitBoard({})).toBe(true);
    await flush();
    expect(calls("set_folder_boards")).toHaveLength(0);
    expect(overlay()).toEqual({});
    useAppStore.setState({ homeView: { kind: "dashboard" } });
  });

  it("the copy wins even if a stale list arrives first — the copy entry is cleared when the same value arrives", async () => {
    setFolders([folder("a", 3)]);
    await commitBoard({});
    expect(overlay()).toEqual({ a: { x: 0, y: 0 } });
    useBoardStore.getState().reconcile([folder("a", 3)]);
    expect(overlay()).toEqual({ a: { x: 0, y: 0 } });
    // drawing again with the stale listing writes nothing new
    await commitBoard({});
    expect(calls("set_folder_boards")).toHaveLength(1);
    useBoardStore.getState().reconcile([folder("a", 3, { board: { x: 0, y: 0 } })]);
    expect(overlay()).toEqual({});
  });

  it("write order is kept — the second write runs after the first finishes", async () => {
    setFolders([folder("a", 1, { board: { x: 0, y: 0 } }), folder("b", 1)]);
    holdWrites = true;
    void commitBoard({});
    await flush();
    void dropFrame("a", { x: 1000, y: 0 });
    await flush();
    expect(calls("set_folder_boards")).toHaveLength(1);
    held[0]!.resolve();
    await flush();
    await flush();
    expect(calls("set_folder_boards")).toHaveLength(2);
    expect(sentBoards(1)).toEqual([{ id: "a", board: { x: 1000, y: 0 } }]);
    held[1]!.resolve();
  });

  it("a failed user action shows a toast (project name and reason) + rereads the list, and drops it from the copy", async () => {
    setFolders([folder("a", 1, { board: { x: 0, y: 0 } })]);
    refuseWrites = () => [{ id: "a", error: "disk full" }];
    expect(await dropFrame("a", { x: 400, y: 0 })).toBe(false);
    expect(toasts()).toEqual(["Error: Could not place “A” on the canvas — disk full"]);
    expect(calls("list_library")).toHaveLength(1);
    expect(overlay()).toEqual({});
  });

  it("a failed auto-commit does not retry that id and shows no toast — successful ones stay", async () => {
    setFolders([folder("a", 1), folder("b", 1)]);
    // Rust names what failed as data — no error text to read ids out of (#221)
    refuseWrites = () => [
      { id: "b", error: "could not place 1 project(s): a — not a project file" },
    ];
    expect(await commitBoard({})).toBe(false);
    expect(toasts()).toEqual([]);
    expect([...useBoardStore.getState().failed]).toEqual(["b"]);
    expect(overlay()).toEqual({ a: { x: 0, y: 0 } });
    failWrites = null;
    mockedInvoke.mockClear();
    serve();
    await commitBoard({});
    expect(calls("set_folder_boards")).toHaveLength(0);
  });

  it("if the call itself fails, everything sent failed", async () => {
    setFolders([folder("a", 1), folder("b", 1)]);
    failWrites = () => new Error("IPC is down");
    await commitBoard({});
    expect([...useBoardStore.getState().failed].sort()).toEqual(["a", "b"]);
  });
});

describe("New project (#221 D15, T24)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    useToastStore.getState().dismissAll();
    failWrites = null;
    refuseWrites = null;
    holdWrites = false;
    serve();
  });

  it("one create_folder at the pointer — an offset spot if it overlaps, rename after creating", async () => {
    setFolders([folder("a", 3, { board: { x: 0, y: 0 } })]);
    const id = await newProjectAt({ x: 100.4, y: 20 });
    const args = calls("create_folder")[0]![1] as { id: string; name: string; board: BoardSpot };
    expect(args).toMatchObject({ id, name: "New project" });
    // on a: 740 right vs 296 down — down
    expect(args.board).toEqual({ x: 100, y: 316 });
    expect(useBoardStore.getState().renaming).toBe(id);
    expect(calls("list_library")).toHaveLength(1);
  });

  it("pressing twice creates only one", async () => {
    setFolders([]);
    const first = newProjectAt({ x: 0, y: 0 });
    const second = newProjectAt({ x: 0, y: 0 });
    await Promise.all([first, second]);
    expect(calls("create_folder")).toHaveLength(1);
  });

  it("on failure, a toast and no rename", async () => {
    setFolders([]);
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "create_folder") throw new Error("no room");
      return listed;
    });
    expect(await newProjectAt({ x: 0, y: 0 })).toBeUndefined();
    expect(toasts().some((t) => t.includes("no room"))).toBe(true);
    expect(useBoardStore.getState().renaming).toBeNull();
  });
});

describe("Expand/Collapse and frame drop (#221 D6·D14, T25·T28)", () => {
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    failWrites = null;
    holdWrites = false;
    serve();
  });

  it("the collapsed value and the displaced neighbors go in the same single write", async () => {
    setFolders([
      folder("a", 9, { board: { x: 0, y: 0 } }),
      folder("b", 1, { board: { x: 0, y: 400 } }),
    ]);
    await setCollapsed("a", false);
    expect(calls("set_folder_boards")).toHaveLength(1);
    expect(sentBoards()).toEqual([
      { id: "a", board: { x: 0, y: 0, collapsed: false } },
      // a grows to 800×700 in place; b makes room below it
      { id: "b", board: { x: 0, y: 740 } },
    ]);
  });

  it("frame drops snap to a 20 grid — if occupied, the dropped frame moves aside", async () => {
    setFolders([
      folder("a", 1, { board: { x: 0, y: 0 } }),
      folder("b", 1, { board: { x: 600, y: 0 } }),
    ]);
    await dropFrame("b", { x: 109, y: 31 });
    // snapped to (100, 40); on a: 220 right vs 236 down — right
    expect(sentBoards()).toEqual([{ id: "b", board: { x: 320, y: 40 } }]);
  });

  it("does not write when dropped in the same spot", async () => {
    setFolders([folder("a", 1, { board: { x: 0, y: 0 } })]);
    await dropFrame("a", { x: 4, y: -6 });
    expect(calls("set_folder_boards")).toHaveLength(0);
  });
});

describe("moving cards — the single placeItem path (#231 D15, T31)", () => {
  const card = () => listed[0]!.diagrams[0]!;
  beforeEach(() => {
    resetBoardForTests();
    resetBoardActionsForTests();
    resetPlacementsForTests();
    resetTabsForTests();
    resetAutosaveForTests();
    useToastStore.getState().dismissAll();
    failWrites = null;
    refuseWrites = null;
    holdWrites = false;
    serve();
    setFolders([
      folder("a", 2, { board: { x: 0, y: 0 } }),
      folder("b", 3, { board: { x: 0, y: 400 } }),
      folder("c", 1, { board: { x: 0, y: 800 } }),
    ]);
  });

  it("does nothing when it cannot drop (current folder·missing folder)", async () => {
    for (const target of ["a", "gone"]) {
      expect(await moveCardInto(`diagram:${card().id}`, target)).toBe(false);
    }
    expect(calls("move_project")).toHaveLength(0);
    expect(calls("set_folder_boards")).toHaveLength(0);
  });

  it("diagram: shows right away at the top of the receiving folder, commits the receiving project 'first', move_project(index 0), toast", async () => {
    const moving = moveCardInto(`diagram:${card().id}`, "b");
    const folders = useLibraryStore.getState().folders!;
    // at the top of the project that took it, as Rust writes it (#230 D4)
    expect(folders.find((f) => f.id === "b")!.order?.[0]).toBe("diagram:a-0");
    expect(folders.find((f) => f.id === "a")!.diagrams.map((d) => d.id)).toEqual(["a-1"]);
    // b grows to 4 cards (540×488) in place; c makes room
    expect(overlay().c).toEqual({ x: 0, y: 928 });
    expect(overlay().b).toBeUndefined();
    expect(await moving).toBe(true);
    expect(calls("move_project")[0]![1]).toEqual({ id: "a-0", folder: "b", index: 0 });
    expect(toasts()).toContain("Moved “A- 0” to B");
  });

  it("folder: with its contents to the top of another project — move_folder(index 0), the receiving project goes 'first'", async () => {
    const nested = folder("a", 1, { board: { x: 0, y: 0 } });
    nested.folders = [{ ...folder("chk", 2), name: "Checkout" }];
    setFolders([nested, folder("b", 3, { board: { x: 0, y: 400 } }), listed[2]!]);
    const moving = moveCardInto("folder:chk", "b");
    const folders = useLibraryStore.getState().folders!;
    expect(folders[0]!.folders).toEqual([]);
    expect(folders[1]!.folders.map((f) => f.id)).toEqual(["chk"]);
    expect(folders[1]!.order?.[0]).toBe("folder:chk");
    expect(overlay().b).toBeUndefined();
    expect(await moving).toBe(true);
    expect(calls("move_folder")[0]![1]).toEqual({ id: "chk", parent: "b", index: 0 });
    expect(toasts()).toContain("Moved “Checkout” to B");
  });

  it("a nested folder's diagram to another project — leaves there for that project's top level", async () => {
    const deep = { id: "deep", title: "Deep", updatedAt: 2000, readable: true };
    const nested = folder("a", 1, { board: { x: 0, y: 0 } });
    nested.folders = [{ ...folder("chk", 0), name: "Checkout", diagrams: [deep] }];
    setFolders([nested, folder("b", 1, { board: { x: 0, y: 400 } })]);
    const moving = moveCardInto("diagram:deep", "b");
    const folders = useLibraryStore.getState().folders!;
    expect(folders[0]!.folders[0]!.diagrams).toEqual([]);
    expect(folders[1]!.diagrams.map((d) => d.id)).toEqual(["deep", "b-0"]);
    expect(await moving).toBe(true);
    expect(calls("move_project")[0]![1]).toEqual({ id: "deep", folder: "b", index: 0 });
  });

  it("Move to… — to a folder at any depth, even within the same project (#229 D13)", async () => {
    const nested = folder("a", 2, { board: { x: 0, y: 0 } });
    nested.folders = [{ ...folder("chk", 0), name: "Checkout" }];
    setFolders([nested, folder("b", 1, { board: { x: 0, y: 400 } })]);
    const moving = moveCardInto(`diagram:${card().id}`, "chk");
    const folders = useLibraryStore.getState().folders!;
    expect(folders[0]!.diagrams.map((d) => d.id)).toEqual(["a-1"]);
    expect(folders[0]!.folders[0]!.diagrams.map((d) => d.id)).toEqual(["a-0"]);
    expect(await moving).toBe(true);
    expect(calls("move_project")[0]![1]).toEqual({ id: "a-0", folder: "chk", index: 0 });
  });

  it("on failure, a toast + reread the list", async () => {
    mockedInvoke.mockImplementation(async (cmd) => {
      if (cmd === "move_project") throw new Error("locked");
      if (cmd === "list_library") return listed;
      return undefined;
    });
    expect(await moveCardInto(`diagram:${card().id}`, "b")).toBe(false);
    expect(toasts().some((t) => t.includes("locked"))).toBe(true);
    expect(useLibraryStore.getState().folders).toEqual(listed);
  });
});
