import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import { useAppStore } from "../appStore";
import { DASHBOARD, type HomeView } from "../homeView";
import { savedFor } from "../../../test/rustAnswers";
import { blankDoc, type FolderMeta } from "../libraryApi";
import {
  deleteDiagramAsking,
  deleteFolderAsking,
  locateProjectAsking,
  moveDiagram,
  newFolder,
  removeFromLibrary,
  renameFolderTo,
} from "../libraryActions";
import { useLibraryStore } from "../libraryStore";
import { openDocument, resetTabsForTests } from "../tabActions";
import { flushAutosave, resetAutosaveForTests, useAutosave } from "../useAutosave";

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

const library = (): FolderMeta[] => [
  {
    folders: [],
    id: "work",
    name: "Work",
    updatedAt: 2,
    diagrams: [
      { id: "p1", title: "Login flow", updatedAt: 2, readable: true },
      { id: "p2", title: "Sequence", updatedAt: 1, readable: true },
    ],
  },
  { folders: [], id: "home", name: "Personal", updatedAt: 1, diagrams: [] },
];
const work = () => library()[0]!;
const personal = () => library()[1]!;
const loginFlow = () => work().diagrams[0]!;

/** what the app showed at the moment a command reached Rust */
const seen: Record<string, { view: string; homeView: HomeView; projectId: string | null }> = {};
/** how many files besides its diagrams a folder holds, as Rust counts them */
let others: unknown = 0;
const serve = () =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    seen[cmd] = {
      view: useAppStore.getState().view,
      homeView: useAppStore.getState().homeView,
      projectId: useDiagramStore.getState().projectId,
    };
    if (cmd === "list_library") return library();
    if (cmd === "count_other_files") return others;
    if (cmd === "save_project") return savedFor(args);
    return undefined;
  });

/** the editor, on Login flow in Work */
const openLoginFlow = () => openDocument(blankDoc(), { projectId: "p1" });
const openTabs = () => useAppStore.getState().tabs.map((t) => t.projectId ?? t.filePath);

describe("library actions (#161, #217 D11, #218 D20)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    for (const key of Object.keys(seen)) delete seen[key];
    resetTabsForTests();
    useLibraryStore.setState({ folders: library(), readFailed: false });
    useToastStore.getState().dismissAll();
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    others = 0;
    serve();
  });

  it("creates a new project and rereads the listing — returns the id so it can be renamed", async () => {
    const id = await newFolder();
    expect(calls("create_folder")[0]![1]).toEqual({ id, name: "New project" });
    expect(calls("list_library")).toHaveLength(1);
  });

  it("the canvas New project sends its position along (#221 D15)", async () => {
    const id = await newFolder({ board: { x: 200, y: 40 } });
    expect(calls("create_folder")[0]![1]).toEqual({
      id,
      name: "New project",
      board: { x: 200, y: 40 },
    });
  });

  it("rename — trims before sending, and sends nothing when empty or unchanged", async () => {
    await renameFolderTo(work(), "  Client  ");
    expect(calls("rename_folder")[0]![1]).toEqual({ id: "work", name: "Client" });
    await renameFolderTo(work(), "   ");
    await renameFolderTo(work(), "Work");
    expect(calls("rename_folder")).toHaveLength(1);
  });

  describe("deleting a project", () => {
    it("says how many files besides its diagrams go with it, as Rust counts them", async () => {
      others = 3;
      await deleteFolderAsking(work());
      expect(calls("count_other_files")[0]![1]).toEqual({ id: "work" });
      expect(mockedAsk.mock.calls[0]![0]).toBe(
        "Delete the project “Work” and everything in it (2 diagrams and 3 other files)? It will be moved to the Trash.",
      );
      others = 1;
      await deleteFolderAsking(personal());
      expect(mockedAsk.mock.calls[1]![0]).toBe(
        "Delete the project “Personal” and everything in it (1 other file)? It will be moved to the Trash.",
      );
      // not counted: it may hold anything
      others = undefined;
      await deleteFolderAsking(personal());
      expect(mockedAsk.mock.calls[2]![0]).toBe(
        "Delete the project “Personal” and everything in it? It will be moved to the Trash.",
      );
    });

    it("asks with the diagram count, and leaves it when declined", async () => {
      await deleteFolderAsking(work());
      expect(mockedAsk.mock.calls[0]![0]).toBe(
        "Delete the project “Work” and everything in it (2 diagrams)? It will be moved to the Trash.",
      );
      expect(mockedAsk.mock.calls[0]![1]).toMatchObject({ title: "Delete project" });
      expect(calls("delete_folder")).toHaveLength(0);
      mockedAsk.mockResolvedValue(true);
      await deleteFolderAsking(work());
      expect(calls("delete_folder")[0]![1]).toEqual({ id: "work" });
    });

    it("goes back to the dashboard when Home was showing that project (#220 D1)", async () => {
      mockedAsk.mockResolvedValue(true);
      useAppStore.getState().setHomeView({ kind: "folder", folder: "work" });
      await deleteFolderAsking(work());
      expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    });

    it("Home showing another project stays", async () => {
      mockedAsk.mockResolvedValue(true);
      useAppStore.getState().setHomeView({ kind: "folder", folder: "home" });
      await deleteFolderAsking(work());
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "home" });
    });

    it("a project holding open diagrams — closes all its tabs, then delete_folder (T36)", async () => {
      mockedAsk.mockResolvedValue(true);
      openDocument(blankDoc(), { filePath: "/tmp/keep.dosik.json" });
      openDocument(blankDoc(), { projectId: "p2" });
      openLoginFlow();
      await deleteFolderAsking(work());
      expect(seen.delete_folder).toEqual({ view: "editor", homeView: DASHBOARD, projectId: null });
      expect(openTabs()).toEqual(["/tmp/keep.dosik.json"]);
      expect(useDiagramStore.getState().filePath).toBe("/tmp/keep.dosik.json");
    });

    it("goes Home and then delete_folder when only its diagrams were open", async () => {
      mockedAsk.mockResolvedValue(true);
      openLoginFlow();
      await deleteFolderAsking(work());
      expect(seen.delete_folder).toEqual({ view: "home", homeView: DASHBOARD, projectId: null });
      expect(openTabs()).toEqual([]);
    });

    it("deleting another project from the editor stays in the editor — there is no old view guard", async () => {
      mockedAsk.mockResolvedValue(true);
      openLoginFlow();
      await deleteFolderAsking(personal());
      expect(calls("delete_folder")[0]![1]).toEqual({ id: "home" });
      expect(useAppStore.getState().view).toBe("editor");
      expect(useDiagramStore.getState().projectId).toBe("p1");
    });

    // Home's project screen stays where the Home tab goes back to while a
    // document tab is up — deleting that project must not throw the user out
    // of a document that has nothing to do with it (#217)
    it.each([
      [
        "an unsaved external file",
        () => {
          openDocument(blankDoc(), { filePath: "/tmp/ext.dosik.json" });
          useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
        },
      ],
      ["a diagram in another project", () => openDocument(blankDoc(), { projectId: "p9" })],
    ])(
      "stays on the %s tab when the project Home last showed is deleted from another tab — Home forgets that project",
      async (_, openOther) => {
        mockedAsk.mockResolvedValue(true);
        useAppStore.getState().setHomeView({ kind: "folder", folder: "work" });
        openOther();
        const before = useDiagramStore.getState();
        const { activeTab } = useAppStore.getState();
        await deleteFolderAsking(work());
        expect(calls("delete_folder")[0]![1]).toEqual({ id: "work" });
        expect(useAppStore.getState()).toMatchObject({
          view: "editor",
          activeTab,
          homeView: DASHBOARD,
        });
        // nothing was loaded over it — not a blank, not unasked (#123)
        expect(useDiagramStore.getState()).toMatchObject({
          projectId: before.projectId,
          filePath: before.filePath,
          nodes: before.nodes,
        });
        expect(mockedAsk).toHaveBeenCalledTimes(1);
      },
    );

    it("does not delete if the bridge opened a diagram while the confirmation was up (#161, T36)", async () => {
      mockedAsk.mockImplementation(async () => {
        // an agent's ops reached Home: a diagram was made and opened in a new tab
        openDocument(blankDoc(), { projectId: "agent" });
        return true;
      });
      await deleteFolderAsking(work());
      expect(calls("delete_folder")).toHaveLength(0);
      expect(toasts()).toEqual(["“Work” was not deleted — a diagram was opened meanwhile."]);
    });
  });

  describe("a project not found, a folder added from elsewhere (#253 R7·R8)", () => {
    const lost = (): FolderMeta => ({
      folders: [],
      id: "arc",
      name: "architecture",
      updatedAt: 0,
      diagrams: [],
      missing: true,
    });
    const answer = (locate: unknown) =>
      mockedInvoke.mockImplementation(async (cmd) => {
        seen[cmd] = {
          view: useAppStore.getState().view,
          homeView: useAppStore.getState().homeView,
          projectId: useDiagramStore.getState().projectId,
        };
        if (cmd === "list_library") return library();
        if (cmd === "locate_project") {
          if (locate instanceof Error) throw locate;
          return locate;
        }
        return undefined;
      });

    it("Locate… located — the library is listed again, nothing said", async () => {
      answer("located");
      expect(await locateProjectAsking(lost())).toBe(true);
      expect(calls("locate_project")[0]![1]).toEqual({ id: "arc" });
      expect(calls("list_library")).toHaveLength(1);
      expect(toasts()).toEqual([]);
    });

    it("Locate… on a folder already in the library — the toast says so, nothing else", async () => {
      answer("already");
      expect(await locateProjectAsking(lost())).toBe(false);
      expect(toasts()).toEqual(["Already in the library"]);
      expect(calls("list_library")).toHaveLength(0);
    });

    it("Locate… cancelled says nothing; one that fails says why", async () => {
      answer("cancelled");
      expect(await locateProjectAsking(lost())).toBe(false);
      expect(toasts()).toEqual([]);
      answer(new Error("no such project"));
      expect(await locateProjectAsking(lost())).toBe(false);
      expect(toasts()).toEqual(["Error: no such project"]);
    });

    it("Remove from Library — no question: closes its diagrams' tabs, lets every write land, removes the record, lists again", async () => {
      renderHook(() => useAutosave());
      openDocument(blankDoc(), { filePath: "/tmp/keep.dosik" });
      openLoginFlow();
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      expect(await removeFromLibrary(work())).toBe(true);
      expect(mockedAsk).not.toHaveBeenCalled();
      expect(calls("remove_project")[0]![1]).toEqual({ id: "work" });
      expect(calls("delete_folder")).toHaveLength(0);
      const order = mockedInvoke.mock.calls.map(([c]) => c);
      expect(order.indexOf("save_project")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("save_project")).toBeLessThan(order.indexOf("remove_project"));
      expect(openTabs()).toEqual(["/tmp/keep.dosik"]);
      expect(order.at(-1)).toBe("list_library");
    });

    it("Remove from Library sends Home showing it, or a folder in it, to the dashboard", async () => {
      useLibraryStore.setState({ folders: [...library(), lost()] });
      useAppStore.getState().setHomeView({ kind: "folder", folder: "arc" });
      await removeFromLibrary(lost());
      expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
      useAppStore.getState().setHomeView({ kind: "folder", folder: "home" });
      await removeFromLibrary(work());
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "home" });
    });

    it("Remove from Library closes the tabs of the diagrams it holds out of reach — asking first for edits not saved", async () => {
      renderHook(() => useAutosave());
      const held = (): FolderMeta => ({ ...lost(), held: ["d1", "d2"] });
      useLibraryStore.setState({ folders: [...library(), held()] });
      let save: unknown = { kind: "unreachable" };
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "list_library") return library();
        if (cmd === "save_project") return save;
        return undefined;
      });
      openDocument(blankDoc(), { projectId: "d2" });
      openDocument(blankDoc(), { projectId: "d1" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(1);
      // declined: nothing removed, the tabs and the edits stay
      expect(await removeFromLibrary(held())).toBe(false);
      expect(mockedAsk.mock.calls[0]![0]).toBe(
        "“Untitled Diagram” has unsaved changes. Discard them?",
      );
      expect(calls("remove_project")).toHaveLength(0);
      expect(openTabs()).toEqual(["d2", "d1"]);
      // discarded: both tabs close, nothing is written, the record goes
      mockedAsk.mockResolvedValue(true);
      save = { kind: "saved", name: "Untitled Diagram", stamp: "1-1-a" };
      expect(await removeFromLibrary(held())).toBe(true);
      expect(openTabs()).toEqual([]);
      expect(calls("save_project")).toHaveLength(1);
      expect(calls("remove_project")[0]![1]).toEqual({ id: "arc" });
    });

    it("Delete closes the tabs of the diagrams a project holds out of reach — asking first for edits not saved", async () => {
      renderHook(() => useAutosave());
      const held = (): FolderMeta => ({ ...work(), held: ["d1"] });
      useLibraryStore.setState({ folders: [held(), personal()] });
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "list_library") return library();
        if (cmd === "save_project") return { kind: "unreachable" };
        if (cmd === "count_other_files") return 0;
        return undefined;
      });
      openDocument(blankDoc(), { projectId: "d1" });
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      await flushAutosave();
      // Delete said yes to, its edits kept: nothing deleted
      mockedAsk.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      expect(await deleteFolderAsking(held())).toBe(false);
      expect(mockedAsk.mock.calls[1]![0]).toBe(
        "“Untitled Diagram” has unsaved changes. Discard them?",
      );
      expect(calls("delete_folder")).toHaveLength(0);
      expect(openTabs()).toEqual(["d1"]);
      // and let go: the tab closes with the project
      mockedAsk.mockResolvedValue(true);
      expect(await deleteFolderAsking(held())).toBe(true);
      expect(openTabs()).toEqual([]);
      expect(calls("delete_folder")[0]![1]).toEqual({ id: "work" });
    });

    it("Remove from Library that fails — a toast, nothing gone", async () => {
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "remove_project") throw new Error("no such project");
        return cmd === "list_library" ? library() : undefined;
      });
      expect(await removeFromLibrary(work())).toBe(false);
      expect(toasts()).toEqual(["Error: no such project"]);
    });
  });

  describe("deleting a diagram", () => {
    it("delete_project after confirmation — returns whether it deleted", async () => {
      expect(await deleteDiagramAsking(loginFlow())).toBe(false);
      mockedAsk.mockResolvedValue(true);
      expect(await deleteDiagramAsking(loginFlow())).toBe(true);
      expect(mockedAsk.mock.calls[0]![0]).toBe(
        "Delete “Login flow”? It will be moved to the Trash.",
      );
      expect(calls("delete_project")[0]![1]).toEqual({ id: "p1" });
    });

    it.each<[string, HomeView]>([
      ["the project that holds it", { kind: "folder", folder: "work" }],
      ["another project", { kind: "folder", folder: "home" }],
      ["the dashboard", DASHBOARD],
    ])("Home's view stays — %s (#231 D1·T7, there is no diagram view)", async (_, view) => {
      mockedAsk.mockResolvedValue(true);
      useAppStore.getState().setHomeView(view);
      await deleteDiagramAsking(loginFlow());
      expect(useAppStore.getState().homeView).toEqual(view);
    });

    it("an open diagram — closes its tab, then delete_project, and the neighbouring tab becomes active (T36)", async () => {
      mockedAsk.mockResolvedValue(true);
      openDocument(blankDoc(), { projectId: "p2" });
      openLoginFlow();
      await deleteDiagramAsking(loginFlow());
      expect(seen.delete_project).toEqual({ view: "editor", homeView: DASHBOARD, projectId: "p2" });
      expect(openTabs()).toEqual(["p2"]);
    });

    it("goes Home when the open diagram was the only one", async () => {
      mockedAsk.mockResolvedValue(true);
      openLoginFlow();
      await deleteDiagramAsking(loginFlow());
      expect(seen.delete_project).toEqual({ view: "home", homeView: DASHBOARD, projectId: null });
    });

    it("a diagram in an inactive tab closes only that tab", async () => {
      mockedAsk.mockResolvedValue(true);
      openLoginFlow();
      openDocument(blankDoc(), { projectId: "p2" });
      await deleteDiagramAsking(loginFlow());
      expect(openTabs()).toEqual(["p2"]);
      expect(useDiagramStore.getState().projectId).toBe("p2");
    });

    it("close tab → pending writes → delete_project, in that order — autosave does not resurrect the deleted file (T36)", async () => {
      renderHook(() => useAutosave());
      mockedAsk.mockResolvedValue(true);
      openLoginFlow();
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      await deleteDiagramAsking(loginFlow());
      const order = mockedInvoke.mock.calls.map(([c]) => c);
      expect(order.indexOf("save_project")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("save_project")).toBeLessThan(order.indexOf("delete_project"));
    });

    it("does not delete if a new tab opened while the confirmation was up (T36)", async () => {
      openLoginFlow();
      mockedAsk.mockImplementation(async () => {
        openDocument(blankDoc(), { projectId: "agent" });
        return true;
      });
      await deleteDiagramAsking(loginFlow());
      expect(calls("delete_project")).toHaveLength(0);
      expect(toasts()).toEqual(["“Login flow” was not deleted — a diagram was opened meanwhile."]);
    });
  });

  describe("moving", () => {
    it("rereads the listing after move_project", async () => {
      await moveDiagram(loginFlow(), "home");
      expect(calls("move_project")[0]![1]).toEqual({ id: "p1", folder: "home" });
      expect(calls("list_library")).toHaveLength(1);
    });

    it("reports the result when moved — 'Moved “X” to Y', returns whether it moved (#221 D13, T27)", async () => {
      expect(await moveDiagram(loginFlow(), "home")).toBe(true);
      expect(toasts()).toContain("Moved “Login flow” to Personal");
    });

    it("on failure, a toast + reread of the listing, false (#221 D13)", async () => {
      mockedInvoke.mockImplementation(async (cmd) => {
        if (cmd === "move_project") throw new Error("disk full");
        if (cmd === "list_library") return library();
        return undefined;
      });
      expect(await moveDiagram(loginFlow(), "home")).toBe(false);
      expect(toasts().some((t) => t.includes("disk full"))).toBe(true);
      expect(toasts().some((t) => t.startsWith("Moved"))).toBe(false);
      expect(calls("list_library")).toHaveLength(1);
    });

    it("an open diagram finishes autosaving before it moves (T25)", async () => {
      renderHook(() => useAutosave());
      openLoginFlow();
      useDiagramStore.getState().addNode("rect", { x: 0, y: 0 });
      await moveDiagram(loginFlow(), "home");
      const order = mockedInvoke.mock.calls.map(([c]) => c);
      expect(order.indexOf("save_project")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("save_project")).toBeLessThan(order.indexOf("move_project"));
    });
  });

  /** folders nest (#229 D11·D12·D13, T36) */
  describe("nested folders", () => {
    const nested = (): FolderMeta[] => [
      {
        id: "pay",
        name: "Payments",
        updatedAt: 3,
        diagrams: [{ id: "led", title: "Ledger", updatedAt: 1, readable: true }],
        folders: [
          {
            id: "chk",
            name: "Checkout",
            updatedAt: 3,
            diagrams: [
              { id: "ord", title: "Order", updatedAt: 3, readable: true },
              { id: "cart", title: "Cart", updatedAt: 2, readable: true },
            ],
            folders: [
              {
                id: "flw",
                name: "Flows",
                updatedAt: 1,
                diagrams: [{ id: "deep", title: "Deep", updatedAt: 1, readable: true }],
                folders: [],
              },
            ],
          },
          { id: "empty", name: "Empty", updatedAt: 1, diagrams: [], folders: [] },
        ],
      },
    ];
    const find = (id: string) => {
      const walk = (fs: FolderMeta[]): FolderMeta | undefined =>
        fs.map((f) => (f.id === id ? f : walk(f.folders))).find(Boolean);
      return walk(nested())!;
    };

    beforeEach(() => {
      useLibraryStore.setState({ folders: nested(), readFailed: false });
      mockedInvoke.mockImplementation(async (cmd) => {
        seen[cmd] = {
          view: useAppStore.getState().view,
          homeView: useAppStore.getState().homeView,
          projectId: useDiagramStore.getState().projectId,
        };
        if (cmd === "count_other_files") return 0;
        return cmd === "list_library" ? nested() : undefined;
      });
    });

    it("newFolder({parent}) — 'New folder' inside it, returns the id (D11)", async () => {
      const id = await newFolder({ parent: "chk" });
      expect(calls("create_folder")[0]![1]).toEqual({ id, name: "New folder", parent: "chk" });
      expect(calls("list_library")).toHaveLength(1);
    });

    it("deleting a folder — asks with the folder and diagram counts of everything below, briefly when empty (D12)", async () => {
      await deleteFolderAsking(find("chk"));
      expect(mockedAsk.mock.calls[0]).toEqual([
        "Delete the folder “Checkout” and everything in it (1 folder, 3 diagrams)? It will be moved to the Trash.",
        expect.objectContaining({ title: "Delete folder" }),
      ]);
      await deleteFolderAsking(find("empty"));
      expect(mockedAsk.mock.calls[1]![0]).toBe(
        "Delete the folder “Empty”? It will be moved to the Trash.",
      );
      await deleteFolderAsking(find("pay"));
      expect(mockedAsk.mock.calls[2]![0]).toBe(
        "Delete the project “Payments” and everything in it (3 folders, 4 diagrams)? It will be moved to the Trash.",
      );
      expect(calls("delete_folder")).toHaveLength(0);
    });

    it("deleting a folder closes every diagram tab below it and finishes writes before delete_folder (D12)", async () => {
      mockedAsk.mockResolvedValue(true);
      openDocument(blankDoc(), { projectId: "led" });
      openDocument(blankDoc(), { projectId: "deep" });
      openDocument(blankDoc(), { projectId: "ord" });
      expect(await deleteFolderAsking(find("chk"))).toBe(true);
      expect(calls("delete_folder")[0]![1]).toEqual({ id: "chk" });
      expect(openTabs()).toEqual(["led"]);
      expect(seen.delete_folder?.projectId).toBe("led");
    });

    it.each<[string, HomeView, HomeView]>([
      ["that folder", { kind: "folder", folder: "chk" }, { kind: "folder", folder: "pay" }],
      ["a folder below it", { kind: "folder", folder: "flw" }, { kind: "folder", folder: "pay" }],
      ["another folder", { kind: "folder", folder: "empty" }, { kind: "folder", folder: "empty" }],
    ])(
      "Home goes to the deleted folder's parent if it was showing %s (D5)",
      async (_, before, after) => {
        mockedAsk.mockResolvedValue(true);
        useAppStore.getState().setHomeView(before);
        await deleteFolderAsking(find("chk"));
        expect(useAppStore.getState().homeView).toEqual(after);
      },
    );

    it("deleting a project sends Home showing something inside it to the dashboard (D5)", async () => {
      mockedAsk.mockResolvedValue(true);
      useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" });
      await deleteFolderAsking(find("pay"));
      expect(useAppStore.getState().homeView).toEqual(DASHBOARD);
    });

    it("deleting a nested diagram keeps the view of the folder that held it (#231 T7)", async () => {
      mockedAsk.mockResolvedValue(true);
      useAppStore.getState().setHomeView({ kind: "folder", folder: "flw" });
      await deleteDiagramAsking({ id: "deep", title: "Deep", updatedAt: 1, readable: true });
      expect(calls("delete_project")[0]![1]).toEqual({ id: "deep" });
      expect(useAppStore.getState().homeView).toEqual({ kind: "folder", folder: "flw" });
    });

    it("moving into a nested folder reports that folder's name (D13)", async () => {
      expect(
        await moveDiagram({ id: "led", title: "Ledger", updatedAt: 1, readable: true }, "flw"),
      ).toBe(true);
      expect(calls("move_project")[0]![1]).toEqual({ id: "led", folder: "flw" });
      expect(toasts()).toEqual(["Moved “Ledger” to Flows"]);
    });
  });
});
