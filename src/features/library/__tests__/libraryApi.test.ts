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
  loadProjectFile,
  locateProject,
  moveProject,
  newProjectId,
  removeProject,
  renameFolder,
  sameContents,
  createProject,
  saveProjectContents,
  setFolderBoards,
} from "../libraryApi";
import { loadedFile, savedFor } from "../../../test/rustAnswers";

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
    mockedInvoke.mockResolvedValueOnce(loadedFile(blankDoc()));
    expect(await loadProject("p1")).toEqual(blankDoc());
    expect(mockedInvoke).toHaveBeenCalledWith("load_project", { id: "p1" });

    mockedInvoke.mockResolvedValueOnce(loadedFile('{"nodes":"nope"}'));
    await expect(loadProject("p1")).rejects.toThrow("Not a valid diagram file");
  });

  it("loadProject — throws with a reason for multi-page documents (#229 D2, T20)", async () => {
    mockedInvoke.mockResolvedValueOnce(
      loadedFile(
        '{"version":2,"title":"Book","pages":[{"id":"p","name":"P","nodes":[],"edges":[]}]}',
      ),
    );
    await expect(loadProject("p1")).rejects.toThrow(
      "This diagram has pages — Dosik now opens one-canvas diagrams only",
    );
    // `pages` beside nodes and edges too
    mockedInvoke.mockResolvedValueOnce(
      loadedFile('{"version":1,"title":"T","nodes":[],"edges":[],"pages":[]}'),
    );
    await expect(loadProject("p1")).rejects.toThrow(
      "This diagram has pages — Dosik now opens one-canvas diagrams only",
    );
  });

  it("createProject serializes with indentation and asks save_project to make it — create, said so", async () => {
    mockedInvoke.mockResolvedValueOnce(savedFor({ contents: "{}" }));
    await createProject("p1", blankDoc());
    expect(mockedInvoke).toHaveBeenCalledWith("save_project", {
      id: "p1",
      contents: JSON.stringify(blankDoc(), null, 2),
      create: true,
    });
  });

  it("a new diagram is sent with the project it goes into (#161)", async () => {
    mockedInvoke.mockResolvedValueOnce(savedFor({ contents: "{}" }));
    await createProject("p1", blankDoc(), "f1");
    expect(mockedInvoke).toHaveBeenCalledWith("save_project", {
      id: "p1",
      contents: JSON.stringify(blankDoc(), null, 2),
      folder: "f1",
      create: true,
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

  describe("projects in real folders (#253)", () => {
    it("a project says whether it is missing or added and where it is — only when Rust says so, only on a project", async () => {
      mockedInvoke.mockResolvedValueOnce([
        {
          id: "gone",
          name: "Client",
          updatedAt: 0,
          diagrams: [],
          folders: [],
          order: [],
          missing: true,
          added: true,
          path: "/Volumes/Work/Client",
          shown: "/Volumes/Work/Client",
          held: ["d1", 7, "d2"],
        },
        {
          id: "here",
          name: "Payments",
          updatedAt: 1,
          diagrams: [],
          // a folder inside a project carries none of it
          folders: [
            {
              id: "sub",
              name: "Sub",
              updatedAt: 1,
              diagrams: [],
              missing: true,
              path: "/x",
            },
          ],
          path: "/Users/a/Dosik/Payments",
          shown: "~/Dosik/Payments",
        },
        // of the wrong type: left out
        { id: "odd", name: "Odd", updatedAt: 1, diagrams: [], missing: "yes", added: 1, path: 5 },
      ]);
      const [gone, here, odd] = await listLibrary();
      expect(gone).toMatchObject({
        missing: true,
        added: true,
        path: "/Volumes/Work/Client",
        shown: "/Volumes/Work/Client",
        // the diagrams it holds out of reach, ids only
        held: ["d1", "d2"],
      });
      expect(here).not.toHaveProperty("missing");
      expect(here).not.toHaveProperty("added");
      expect(here?.shown).toBe("~/Dosik/Payments");
      expect(here?.folders[0]).toEqual({
        id: "sub",
        name: "Sub",
        updatedAt: 1,
        diagrams: [],
        folders: [],
      });
      expect(here).not.toHaveProperty("held");
      for (const key of ["missing", "added", "path", "shown"]) expect(odd).not.toHaveProperty(key);
    });

    it("loadProjectFile titles the diagram after its file and keeps its stamp; loadProject gives the document alone", async () => {
      const answer = {
        contents: JSON.stringify({ ...blankDoc(), title: "What the JSON says" }),
        name: "Login flow",
        stamp: "1700000000000000000-120-00ff00ff00ff00ff",
      };
      mockedInvoke.mockResolvedValueOnce(answer);
      expect(await loadProjectFile("p1")).toEqual({
        doc: { ...blankDoc(), title: "Login flow" },
        stamp: answer.stamp,
      });
      expect(mockedInvoke).toHaveBeenLastCalledWith("load_project", { id: "p1" });
      mockedInvoke.mockResolvedValueOnce(answer);
      expect(await loadProject("p1")).toEqual({ ...blankDoc(), title: "Login flow" });
      // an answer of another shape throws: the contents alone, a name or stamp missing
      for (const odd of [
        JSON.stringify(blankDoc()),
        { contents: answer.contents, stamp: answer.stamp },
        { contents: answer.contents, name: "Login flow" },
        { ...answer, contents: 5 },
        null,
      ]) {
        mockedInvoke.mockResolvedValueOnce(odd);
        await expect(loadProjectFile("p1")).rejects.toThrow("Couldn't read the diagram");
      }
      // still a diagram, or it throws
      mockedInvoke.mockResolvedValueOnce({ ...answer, contents: '{"nodes":"nope"}' });
      await expect(loadProjectFile("p1")).rejects.toThrow("Not a valid diagram file");
    });

    it("a save brings the stamp its tab last saw and says what it came to", async () => {
      mockedInvoke.mockResolvedValueOnce({ kind: "saved", name: "Flow 2", stamp: "9-2-ab" });
      expect(await saveProjectContents("p1", "{}", "1-2-ab")).toEqual({
        kind: "saved",
        name: "Flow 2",
        stamp: "9-2-ab",
      });
      // in place: no create, so a diagram the library does not have is never made
      expect(mockedInvoke).toHaveBeenLastCalledWith("save_project", {
        id: "p1",
        contents: "{}",
        base: "1-2-ab",
      });
      mockedInvoke.mockResolvedValueOnce({ kind: "changedOnDisk" });
      expect(await saveProjectContents("p1", "{}", "1-2-ab")).toEqual({
        kind: "changedOnDisk",
      });
      mockedInvoke.mockResolvedValueOnce({ kind: "gone" });
      expect(await saveProjectContents("p1", "{}")).toEqual({ kind: "gone" });
      mockedInvoke.mockResolvedValueOnce({ kind: "unreachable" });
      expect(await saveProjectContents("p1", "{}")).toEqual({ kind: "unreachable" });
      // an answer of any other kind throws: whether it was written is not known —
      // and so does a save without the name and the stamp the next one needs
      for (const odd of [
        undefined,
        null,
        "saved",
        {},
        { kind: "written" },
        { kind: "saved" },
        { kind: "saved", name: "Flow" },
        { kind: "saved", stamp: "1-2-ab" },
        { kind: "saved", name: 3, stamp: null },
      ]) {
        mockedInvoke.mockResolvedValueOnce(odd);
        await expect(createProject("p1", blankDoc(), "f1")).rejects.toThrow(
          "Couldn't tell whether the diagram was saved",
        );
      }
    });

    it("two stamps are of the same contents when their length and hash agree, whenever written", () => {
      expect(sameContents("1-120-abcd", "2-120-abcd")).toBe(true);
      expect(sameContents("1-120-abcd", "1-121-abcd")).toBe(false);
      expect(sameContents("1-120-abcd", "1-120-abce")).toBe(false);
      expect(sameContents(undefined, "1-120-abcd")).toBe(false);
      expect(sameContents(undefined, undefined)).toBe(false);
      expect(sameContents("nodash", "nodash")).toBe(false);
    });

    it("Locate… and Remove from Library go to Rust by id — no path from here (R14)", async () => {
      mockedInvoke.mockResolvedValueOnce("already");
      expect(await locateProject("gone")).toBe("already");
      expect(mockedInvoke).toHaveBeenLastCalledWith("locate_project", { id: "gone" });
      await removeProject("gone");
      expect(mockedInvoke).toHaveBeenLastCalledWith("remove_project", { id: "gone" });
    });
  });
});
