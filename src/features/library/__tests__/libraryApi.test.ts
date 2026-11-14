import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import {
  BOARD_LIMIT,
  blankDoc,
  cleanBoardSpot,
  createFolder,
  deleteFolder,
  deleteProject,
  listLibrary,
  loadProject,
  moveProject,
  newProjectId,
  renameFolder,
  saveProject,
  setFolderBoards,
} from "../libraryApi";

const mockedInvoke = vi.mocked(invoke);

describe("libraryApi", () => {
  it("ids are in the shape Rust accepts — 10 chars, [A-Za-z0-9_-]", () => {
    for (let i = 0; i < 50; i++) expect(newProjectId()).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it("listLibrary calls list_library — projects and their diagrams (#161)", async () => {
    const library = [
      {
        id: "f",
        name: "Work",
        updatedAt: 1,
        diagrams: [{ id: "a", title: "A", updatedAt: 1, readable: true }],
        folders: [],
      },
    ];
    mockedInvoke.mockResolvedValueOnce(library);
    expect(await listLibrary()).toEqual(library);
    expect(mockedInvoke).toHaveBeenCalledWith("list_library");
  });

  it("readable is kept as is, true when not a bool or missing — there are no pageNames (#229 D8, T32)", async () => {
    mockedInvoke.mockResolvedValueOnce([
      {
        id: "f",
        name: "Work",
        updatedAt: 1,
        diagrams: [
          { id: "a", title: "A", updatedAt: 1, readable: true },
          { id: "b", title: "B", updatedAt: 1, readable: false },
          // an older Rust sends page names and no `readable`: the file opens or says why
          { id: "c", title: "C", updatedAt: 1, pageNames: ["Page 1"] },
          { id: "d", title: "D", updatedAt: 1, readable: "yes" },
        ],
      },
    ]);
    const [folder] = await listLibrary();
    expect(folder?.diagrams.map((d) => d.readable)).toEqual([true, false, true, true]);
    for (const d of folder?.diagrams ?? []) expect(d).not.toHaveProperty("pageNames");
  });

  it("creates, renames and deletes projects and moves diagrams (#161)", async () => {
    const id = await createFolder("Work");
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(mockedInvoke).toHaveBeenCalledWith("create_folder", { id, name: "Work" });
    await renameFolder(id, "Client");
    expect(mockedInvoke).toHaveBeenCalledWith("rename_folder", { id, name: "Client" });
    await deleteFolder(id);
    expect(mockedInvoke).toHaveBeenCalledWith("delete_folder", { id });
    await moveProject("p1", id);
    expect(mockedInvoke).toHaveBeenCalledWith("move_project", { id: "p1", folder: id });
  });

  it("loadProject parses the file content and throws if it is not a diagram", async () => {
    mockedInvoke.mockResolvedValueOnce(JSON.stringify(blankDoc()));
    expect(await loadProject("p1")).toEqual(blankDoc());
    expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "p1" });

    mockedInvoke.mockResolvedValueOnce('{"nodes":"nope"}');
    await expect(loadProject("p1")).rejects.toThrow("Not a valid diagram file");
  });

  it("loadProject — throws with a reason for multi-page documents (#229 D2, T20)", async () => {
    mockedInvoke.mockResolvedValueOnce(
      '{"version":2,"title":"Book","pages":[{"id":"p","name":"P","nodes":[],"edges":[]}]}',
    );
    await expect(loadProject("p1")).rejects.toThrow(
      "This diagram has pages — Dosik now opens one-canvas diagrams only",
    );
    // `pages` beside nodes and edges too
    mockedInvoke.mockResolvedValueOnce(
      '{"version":1,"title":"T","nodes":[],"edges":[],"pages":[]}',
    );
    await expect(loadProject("p1")).rejects.toThrow(
      "This diagram has pages — Dosik now opens one-canvas diagrams only",
    );
  });

  it("saveProject serializes with indentation and sends it to save_project", async () => {
    await saveProject("p1", blankDoc());
    expect(mockedInvoke).toHaveBeenCalledWith("save_project", {
      id: "p1",
      contents: JSON.stringify(blankDoc(), null, 2),
    });
  });

  it("a new diagram is sent with the project it goes into (#161)", async () => {
    await saveProject("p1", blankDoc(), "f1");
    expect(mockedInvoke).toHaveBeenCalledWith("save_project", {
      id: "p1",
      contents: JSON.stringify(blankDoc(), null, 2),
      folder: "f1",
    });
  });

  it("deleteProject calls delete_project", async () => {
    await deleteProject("p1");
    expect(mockedInvoke).toHaveBeenCalledWith("delete_project", { id: "p1" });
  });

  describe("board spot (#221 D7)", () => {
    it("T6 board in the listing — rounded to integers when finite and in range, otherwise undefined", async () => {
      const raw = (board: unknown) => ({ id: "f", name: "F", updatedAt: 1, diagrams: [], board });
      mockedInvoke.mockResolvedValueOnce([
        raw({ x: 40, y: 80 }),
        raw({ x: 10.6, y: -20.4, collapsed: true }),
        raw({ x: 1, y: 2, collapsed: "yes" }),
        raw({ x: BOARD_LIMIT + 1, y: 0 }),
        raw({ x: Number.NaN, y: 0 }),
        raw({ x: "1", y: 2 }),
        raw([1, 2]),
        raw(null),
        raw(undefined),
      ]);
      const boards = (await listLibrary()).map((f) => f.board);
      expect(boards).toEqual([
        { x: 40, y: 80 },
        { x: 11, y: -20, collapsed: true },
        { x: 1, y: 2 },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    });

    it("cleanBoardSpot carries collapsed only when it is a bool — false is a value too", () => {
      expect(cleanBoardSpot({ x: 0, y: 0, collapsed: false })).toEqual({
        x: 0,
        y: 0,
        collapsed: false,
      });
      expect(cleanBoardSpot({ x: -BOARD_LIMIT, y: BOARD_LIMIT })).toEqual({
        x: -BOARD_LIMIT,
        y: BOARD_LIMIT,
      });
      expect(cleanBoardSpot({ x: 0 })).toBeUndefined();
    });

    it("setFolderBoards returns the projects it could not place as an {id, error} list — empty when none (#221)", async () => {
      mockedInvoke.mockResolvedValueOnce([{ id: "b", error: "not a project file" }]);
      expect(await setFolderBoards([{ id: "b", board: { x: 0, y: 0 } }])).toEqual([
        { id: "b", error: "not a project file" },
      ]);
      mockedInvoke.mockResolvedValueOnce([]);
      expect(await setFolderBoards([{ id: "a", board: { x: 0, y: 0 } }])).toEqual([]);
      // what is not a list of failures is none
      mockedInvoke.mockResolvedValueOnce(undefined);
      expect(await setFolderBoards([{ id: "a", board: { x: 0, y: 0 } }])).toEqual([]);
    });

    it("T7 setFolderBoards sends {boards:[{id, board}]}", async () => {
      await setFolderBoards([
        { id: "a", board: { x: 0, y: 20 } },
        { id: "b", board: { x: 40, y: 60, collapsed: false } },
      ]);
      expect(mockedInvoke).toHaveBeenCalledWith("set_folder_boards", {
        boards: [
          { id: "a", board: { x: 0, y: 20 } },
          { id: "b", board: { x: 40, y: 60, collapsed: false } },
        ],
      });
    });

    it("T7 createFolder(name, {board}) sends board along, and omits it when absent", async () => {
      const id = await createFolder("New project", { board: { x: 120, y: -40 } });
      expect(mockedInvoke).toHaveBeenCalledWith("create_folder", {
        id,
        name: "New project",
        board: { x: 120, y: -40 },
      });
      const plain = await createFolder("Plain");
      expect(mockedInvoke).toHaveBeenLastCalledWith("create_folder", { id: plain, name: "Plain" });
    });
  });

  describe("nested folders (#229 D8·D10, T32)", () => {
    it("listLibrary normalizes recursively — folders defaults to [], board only at the top, readable", async () => {
      mockedInvoke.mockResolvedValueOnce([
        {
          id: "pay",
          name: "Payments",
          updatedAt: 3,
          board: { x: 1.4, y: 2 },
          diagrams: [],
          folders: [
            {
              id: "chk",
              name: "Checkout",
              updatedAt: 3,
              board: { x: 9, y: 9 },
              diagrams: [{ id: "o", title: "O", updatedAt: 3 }],
              folders: [{ id: "flw", name: "Flows", updatedAt: 1, diagrams: [] }],
            },
          ],
        },
        // an older Rust: no folders at all
        { id: "old", name: "Old", updatedAt: 1, diagrams: [] },
      ]);
      const [pay, old] = await listLibrary();
      expect(pay?.board).toEqual({ x: 1, y: 2 });
      const chk = pay?.folders[0];
      expect(chk).not.toHaveProperty("board");
      expect(chk?.diagrams[0]?.readable).toBe(true);
      expect(chk?.folders[0]).toEqual({
        id: "flw",
        name: "Flows",
        updatedAt: 1,
        diagrams: [],
        folders: [],
      });
      expect(old?.folders).toEqual([]);
    });

    it("createFolder(name, {parent}) creates inside that folder — without sending board", async () => {
      const id = await createFolder("New folder", { parent: "chk" });
      expect(mockedInvoke).toHaveBeenLastCalledWith("create_folder", {
        id,
        name: "New folder",
        parent: "chk",
      });
    });
  });
});
