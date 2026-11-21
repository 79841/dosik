import { invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeDoc, makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import type { DiagramDoc } from "../../../shared/lib/types";
import { applyForChat, captureChatTarget } from "../../ai/chatTarget";
import { registerViewportRead } from "../../canvas/canvasViewport";
import { useAppStore } from "../appStore";
import { blankDoc } from "../libraryApi";
import { useLibraryStore } from "../libraryStore";
import {
  activateNth,
  activateTab,
  closeActiveTab,
  closeTab,
  confirmDiscardTabs,
  cycleTab,
  documentOnScreen,
  newDiagramTab,
  noteSavedToFile,
  openDocument,
  openLibraryDiagram,
  openPathInTab,
  resetTabsForTests,
  showHomeTab,
} from "../tabActions";
import { newTab } from "../tabModel";
import { namedTarget } from "../targets";
import {
  externalBaseline,
  hasUnsavedExternalChanges,
  resetUnsavedGuardForTests,
} from "../unsavedGuard";
import {
  AUTOSAVE_DEBOUNCE_MS,
  baseStampOf,
  flushAutosave,
  resetAutosaveForTests,
  useAutosave,
} from "../useAutosave";

const mockedInvoke = vi.mocked(invoke);
const mockedAsk = vi.mocked(ask);
const mockedOpen = vi.mocked(open);
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const store = () => useDiagramStore.getState();
const app = () => useAppStore.getState();
const ids = () => store().nodes.map((n) => n.id);
const add = (id: string) =>
  store().applyOps([{ op: "add_node", node: { id, label: id, x: 0, y: 0 } }]);
const tabOf = (match: { projectId?: string; filePath?: string }) =>
  app().tabs.find((t) =>
    match.projectId ? t.projectId === match.projectId : t.filePath === match.filePath,
  )!;

const book = (title: string): DiagramDoc => ({
  version: 1,
  title,
  nodes: [makeNode({ id: `${title}-n` })],
  edges: [],
});

/** load_project and read_text_file answer from `files`; every other command resolves undefined */
const serve = (files: Record<string, unknown> = {}) =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    if (cmd === "load_project" || cmd === "read_text_file") {
      const key =
        cmd === "load_project" ? (args as { id: string }).id : (args as { path: string }).path;
      if (!(key in files)) throw new Error(`no such diagram: ${key}`);
      return JSON.stringify(files[key]);
    }
    return undefined;
  });

/**
 * The tab model's promises (D1, D4, D8): at most one active tab, the active
 * tab's document only in the store, every other read tab with its snapshot,
 * and Home on screen exactly when no tab is active.
 */
const expectTabInvariants = () => {
  const { tabs, activeTab, view } = app();
  expect(view === "home").toBe(activeTab === null);
  if (activeTab !== null) expect(tabs.filter((t) => t.id === activeTab)).toHaveLength(1);
  for (const tab of tabs) {
    if (tab.id === activeTab) expect(tab.doc).toBeNull();
    else if (tab.loaded) expect(tab.doc).not.toBeNull();
  }
  if (activeTab === null) expect(store()).toMatchObject({ projectId: null, filePath: null });
};

describe("tab actions (#218)", () => {
  beforeEach(() => {
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useLibraryStore.setState({ folders: [], readFailed: false });
    mockedAsk.mockReset();
    mockedAsk.mockResolvedValue(false);
    serve({
      p1: book("Checkout"),
      p2: book("Ledger"),
      p3: book("Login"),
      "/x/a.dosik.json": makeDoc([], [], "File A"),
      "/x/b.dosik.json": makeDoc([], [], "File B"),
    });
  });
  afterEach(() => expectTabInvariants());

  describe("opening a library diagram (T18~T20)", () => {
    it("a new tab at the end, active, in the editor — the tab left behind keeps a snapshot (T18)", async () => {
      await openLibraryDiagram("p1");
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
      expect(app()).toMatchObject({ view: "editor", activeTab: tabOf({ projectId: "p1" }).id });
      expect(store()).toMatchObject({ projectId: "p1", title: "Checkout" });
      await openLibraryDiagram("p2");
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1", "p2"]);
      expect(app().activeTab).toBe(tabOf({ projectId: "p2" }).id);
      expect(tabOf({ projectId: "p1" }).doc).toMatchObject({ projectId: "p1", title: "Checkout" });
    });

    it("opening is not an edit — the first no-op change is not written (T18)", async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useAutosave());
        await openLibraryDiagram("p1");
        useDiagramStore.setState((s) => ({
          nodes: s.nodes.map((n) => ({ ...n, selected: true })),
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
        expect(calls("save_project")).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("an already open one switches to its tab without rereading (T19)", async () => {
      await openLibraryDiagram("p1");
      await openLibraryDiagram("p2");
      await openLibraryDiagram("p1");
      expect(calls("load_project")).toHaveLength(2);
      expect(app().tabs).toHaveLength(2);
      expect(store().projectId).toBe("p1");
    });

    it("opening the same id twice at once gives one tab — it checks again after loading (T19)", async () => {
      await Promise.all([openLibraryDiagram("p1"), openLibraryDiagram("p1")]);
      expect(app().tabs).toHaveLength(1);
      // another path opened it while this one was reading
      let release!: () => void;
      mockedInvoke.mockImplementationOnce(
        (_cmd, _args) =>
          new Promise((resolve) => {
            release = () => resolve(JSON.stringify(book("Ledger")));
          }),
      );
      const reading = openLibraryDiagram("p2");
      openDocument(book("Ledger"), { projectId: "p2" });
      release();
      await reading;
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1", "p2"]);
    });

    it("a broken document — throws, and tabs, active tab, live document and view all stay unchanged (T22)", async () => {
      await openLibraryDiagram("p1");
      const before = { app: app(), doc: store().nodes, title: store().title };
      const broken = {
        version: 1,
        title: "Broken",
        nodes: [{ ...makeNode({ id: "n" }), position: { x: Number.NaN, y: 0 } }],
        edges: [],
      } as DiagramDoc;
      expect(() => openDocument(broken, { projectId: "bad" })).toThrow(/Invalid diagram file/);
      serve({ bad: broken });
      await expect(openLibraryDiagram("bad")).rejects.toThrow(/Invalid diagram file/);
      // a document with pages: refused the same way, with its own reason (#229 D2)
      const multi = { version: 2, title: "Book", pages: [] } as unknown as DiagramDoc;
      expect(() => openDocument(multi, { projectId: "book" })).toThrow(/has pages/);
      expect(app().tabs).toBe(before.app.tabs);
      expect(app().activeTab).toBe(before.app.activeTab);
      expect(app().view).toBe("editor");
      expect(store().nodes).toBe(before.doc);
      expect(store().title).toBe(before.title);
    });
  });

  describe("external files (T21, T25)", () => {
    it("opens in a new tab — if the same path is open, switches without rereading and without asking (T21)", async () => {
      expect(await openPathInTab("/x/a.dosik.json")).toBe(true);
      expect(store()).toMatchObject({ filePath: "/x/a.dosik.json", title: "File A" });
      await openLibraryDiagram("p1");
      expect(await openPathInTab("/x/a.dosik.json")).toBe(false);
      expect(calls("read_text_file")).toHaveLength(1);
      expect(store().filePath).toBe("/x/a.dosik.json");
      expect(app().tabs).toHaveLength(2);
      expect(mockedAsk).not.toHaveBeenCalled();
    });

    describe("after Save waits on the disk — what was written belongs to the document that started the save (#218)", () => {
      const B_PATH = "/x/b.dosik.json";

      it("still on screen: the live store gets the path and baseline", async () => {
        await openPathInTab("/x/a.dosik.json");
        const from = documentOnScreen();
        add("edit");
        noteSavedToFile(from, B_PATH, "written");
        expect(store().filePath).toBe(B_PATH);
        expect(externalBaseline()).toBe("written");
      });

      it("left and came back: the live store gets them if that tab is active", async () => {
        await openPathInTab("/x/a.dosik.json");
        const from = documentOnScreen();
        await openLibraryDiagram("p1");
        await activateTab(tabOf({ filePath: "/x/a.dosik.json" }).id);
        noteSavedToFile(from, B_PATH, "written");
        expect(store().filePath).toBe(B_PATH);
        expect(externalBaseline()).toBe("written");
      });

      it("another tab is active: that tab's record gets the path, snapshot path and baseline, the current document is untouched", async () => {
        await openPathInTab("/x/a.dosik.json");
        const a = app().activeTab!;
        const from = documentOnScreen();
        await openLibraryDiagram("p1");
        const baseline = externalBaseline();
        noteSavedToFile(from, B_PATH, "written");
        expect(store()).toMatchObject({ projectId: "p1", filePath: null });
        expect(externalBaseline()).toBe(baseline);
        const tab = app().tabs.find((t) => t.id === a)!;
        expect(tab).toMatchObject({ filePath: B_PATH, baseline: "written" });
        expect(tab.doc?.filePath).toBe(B_PATH);
      });

      it("changes nothing if that tab closed in the meantime", async () => {
        await openPathInTab("/x/a.dosik.json");
        const from = documentOnScreen();
        await openLibraryDiagram("p1");
        await closeTab(tabOf({ filePath: "/x/a.dosik.json" }).id);
        const before = { tabs: app().tabs, filePath: store().filePath };
        noteSavedToFile(from, B_PATH, "written");
        expect(app().tabs).toBe(before.tabs);
        expect(store().filePath).toBe(before.filePath);
      });

      it("a write started on Home attaches nowhere if a tab opens in the meantime", async () => {
        const from = documentOnScreen();
        await openLibraryDiagram("p1");
        noteSavedToFile(from, B_PATH, "written");
        expect(store().filePath).toBeNull();
        expect(app().tabs.map((t) => t.filePath)).toEqual([null]);
      });
    });

    it("a path handed over by the OS (#149) — opens without a dialog; throws and changes nothing if it is not a diagram", async () => {
      expect(await openPathInTab("/x/a.dosik.json")).toBe(true);
      expect(calls("read_text_file")[0]![1]).toEqual({ path: "/x/a.dosik.json" });
      expect(mockedOpen).not.toHaveBeenCalled();
      const before = app().tabs;
      mockedInvoke.mockImplementation(async (cmd) =>
        cmd === "read_text_file" ? '{"hello":1}' : undefined,
      );
      await expect(openPathInTab("/x/not.dosik.json")).rejects.toThrow(/Not a valid diagram/);
      expect(app().tabs).toBe(before);
      expect(store().filePath).toBe("/x/a.dosik.json");
    });

    it("the baseline follows the tab — dirty A is still dirty when back, clean B stays clean (T25)", async () => {
      await openPathInTab("/x/a.dosik.json");
      add("edit");
      expect(hasUnsavedExternalChanges()).toBe(true);
      await openPathInTab("/x/b.dosik.json");
      expect(hasUnsavedExternalChanges()).toBe(false);
      await activateTab(tabOf({ filePath: "/x/a.dosik.json" }).id);
      expect(hasUnsavedExternalChanges()).toBe(true);
      await activateTab(tabOf({ filePath: "/x/b.dosik.json" }).id);
      expect(hasUnsavedExternalChanges()).toBe(false);
    });
  });

  describe("switching (T23, T24, T26, T29, T30)", () => {
    it("selection, history and viewport come back as they were (T23)", async () => {
      let view = { x: 0, y: 0, zoom: 1 };
      const off = registerViewportRead(() => view);
      try {
        await openLibraryDiagram("p1");
        add("x");
        add("y");
        useDiagramStore.setState((s) => ({
          nodes: s.nodes.map((n) => ({ ...n, selected: true })),
        }));
        view = { x: -40, y: 12, zoom: 1.5 };
        const past = store().past;
        await openLibraryDiagram("p2");
        view = { x: 0, y: 0, zoom: 1 };
        await activateTab(tabOf({ projectId: "p1" }).id);
        expect(store().nodes.map((n) => [n.id, n.selected])).toEqual([
          ["Checkout-n", true],
          ["x", true],
          ["y", true],
        ]);
        expect(store().past).toBe(past);
        expect(store().revealRequest).toMatchObject({
          mode: "viewport",
          viewport: { x: -40, y: 12, zoom: 1.5 },
        });
        store().undo();
        expect(ids()).toEqual(["Checkout-n", "x"]);
      } finally {
        off();
      }
    });

    it("a tab shown for the first time uses fit/origin — before its viewport is remembered", async () => {
      await openLibraryDiagram("p1");
      expect(store().revealRequest?.mode).toBe("fit");
    });

    it("switching right after an edit — the leaving document is written to its file, the incoming one is not (T24)", async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useAutosave());
        await openLibraryDiagram("p1");
        await openLibraryDiagram("p2");
        await activateTab(tabOf({ projectId: "p1" }).id);
        // a switch with no edit writes nothing
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
        expect(calls("save_project")).toHaveLength(0);
        add("fresh");
        await activateTab(tabOf({ projectId: "p2" }).id);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
        const saves = calls("save_project");
        expect(saves).toHaveLength(1);
        const [, args] = saves[0]!;
        expect(args).toMatchObject({ id: "p1" });
        const written = JSON.parse((args as { contents: string }).contents) as DiagramDoc;
        expect(written.nodes.map((n) => n.id)).toEqual(["Checkout-n", "fresh"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("Home — document tabs stay, live is an empty document, the Home view is kept. Coming back restores it (T26, #220 D1)", async () => {
      useAppStore.getState().setHomeView({ kind: "folder", folder: "work" });
      await openLibraryDiagram("p1");
      add("x");
      showHomeTab();
      expect(app()).toMatchObject({
        view: "home",
        activeTab: null,
        homeView: { kind: "folder", folder: "work" },
      });
      expect(app().tabs).toHaveLength(1);
      expect(store()).toMatchObject({ projectId: null, filePath: null, nodes: [] });
      showHomeTab({ kind: "folder", folder: "other" });
      expect(app().homeView).toEqual({ kind: "folder", folder: "other" });
      await activateTab(tabOf({ projectId: "p1" }).id);
      expect(ids()).toEqual(["Checkout-n", "x"]);
      store().undo();
      expect(ids()).toEqual(["Checkout-n"]);
    });

    it("editing a label during a keyboard switch — the text commits to the leaving document's node (T29)", async () => {
      await openLibraryDiagram("p1");
      const editor = document.createElement("textarea");
      document.body.append(editor);
      editor.focus();
      const onBlur = vi.fn(() => store().updateNodeData("Checkout-n", { label: "typed" }));
      editor.addEventListener("blur", onBlur);
      await openLibraryDiagram("p2");
      expect(onBlur).toHaveBeenCalledTimes(1);
      expect(store().nodes.find((n) => n.id === "Checkout-n")).toBeUndefined();
      expect(tabOf({ projectId: "p1" }).doc?.nodes[0]?.data.label).toBe("typed");
      editor.remove();
    });

    it("a chat turn stops on switching and does not resume on return (T30)", async () => {
      await openLibraryDiagram("p1");
      const target = captureChatTarget();
      await openLibraryDiagram("p2");
      const op = [{ op: "add_node" as const, node: { id: "z", label: "z", x: 0, y: 0 } }];
      expect(applyForChat(target, op)).toMatchObject({ ok: false });
      expect(target.stopped).toMatch(/^Stopped drawing/);
      await activateTab(tabOf({ projectId: "p1" }).id);
      expect(applyForChat(target, op)).toMatchObject({ ok: false });
      expect(ids()).not.toContain("z");
    });

    it("cycling and numbers — ⌃Tab cycles through Home, ⌘digit goes to that position (D12)", async () => {
      await openLibraryDiagram("p1");
      await openLibraryDiagram("p2");
      await cycleTab(1);
      expect(app().activeTab).toBeNull();
      await cycleTab(1);
      expect(store().projectId).toBe("p1");
      await cycleTab(-1);
      expect(app().view).toBe("home");
      await activateNth(3);
      expect(store().projectId).toBe("p2");
      await activateNth(8);
      expect(store().projectId).toBe("p2");
      await activateNth(1);
      expect(app().view).toBe("home");
      await activateNth(9);
      expect(store().projectId).toBe("p2");
    });
  });

  describe("closing (T27)", () => {
    it("library — closes without asking after writing pending edits. If active, right → left → Home", async () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useAutosave());
        await openLibraryDiagram("p1");
        await openLibraryDiagram("p2");
        await openLibraryDiagram("p3");
        await activateTab(tabOf({ projectId: "p2" }).id);
        add("last");
        expect(await closeActiveTab()).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(calls("save_project").map(([, a]) => (a as { id: string }).id)).toEqual(["p2"]);
        expect(store().projectId).toBe("p3");
        await closeActiveTab();
        expect(store().projectId).toBe("p1");
        await closeActiveTab();
        expect(app()).toMatchObject({ view: "home", tabs: [] });
        expect(await closeActiveTab()).toBe(false);
        expect(mockedAsk).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("closing an inactive tab keeps the active one", async () => {
      await openLibraryDiagram("p1");
      await openLibraryDiagram("p2");
      await closeTab(tabOf({ projectId: "p1" }).id);
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p2"]);
      expect(store().projectId).toBe("p2");
    });

    it("a dirty external file — asks whether active or inactive, Cancel leaves it", async () => {
      await openPathInTab("/x/a.dosik.json");
      add("edit");
      expect(await closeActiveTab()).toBe(false);
      expect(mockedAsk).toHaveBeenCalledWith(
        "“a.dosik.json” has unsaved changes. Discard them?",
        expect.objectContaining({ okLabel: "Discard" }),
      );
      expect(app().tabs).toHaveLength(1);
      await openLibraryDiagram("p1");
      const a = tabOf({ filePath: "/x/a.dosik.json" }).id;
      expect(await closeTab(a)).toBe(false);
      expect(mockedAsk).toHaveBeenCalledTimes(2);
      mockedAsk.mockResolvedValue(true);
      expect(await closeTab(a)).toBe(true);
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    });

    it("a clean external file does not ask", async () => {
      await openPathInTab("/x/a.dosik.json");
      expect(await closeActiveTab()).toBe(true);
      expect(mockedAsk).not.toHaveBeenCalled();
    });

    describe("closing while typing a label — decides after committing (#218)", () => {
      /** a label editor with focus that commits on blur, as `ShapeNode`'s textarea does */
      const typing = (label: string) => {
        const editor = document.createElement("textarea");
        document.body.append(editor);
        editor.focus();
        editor.addEventListener("blur", () => store().updateNodeData("File A-n", { label }));
        return editor;
      };
      beforeEach(() =>
        serve({
          p1: book("Checkout"),
          "/x/a.dosik.json": makeDoc([makeNode({ id: "File A-n" })], [], "File A"),
        }),
      );

      it("clean external file + ⌘W while editing — asks, and Cancel keeps the tab and the input", async () => {
        await openPathInTab("/x/a.dosik.json");
        const editor = typing("Payment");
        expect(await closeActiveTab()).toBe(false);
        expect(mockedAsk).toHaveBeenCalledTimes(1);
        expect(app().tabs).toHaveLength(1);
        expect(store().nodes[0]?.data.label).toBe("Payment");
        editor.remove();
      });

      it("closing the window too — confirmDiscardTabs commits and then asks", async () => {
        await openPathInTab("/x/a.dosik.json");
        const editor = typing("Payment");
        expect(await confirmDiscardTabs()).toBe(false);
        expect(mockedAsk).toHaveBeenCalledTimes(1);
        expect(store().nodes[0]?.data.label).toBe("Payment");
        editor.remove();
      });

      it("closing an inactive tab does not touch the active document's editor", async () => {
        await openLibraryDiagram("p1");
        const p1 = tabOf({ projectId: "p1" }).id;
        await openPathInTab("/x/a.dosik.json");
        const editor = typing("Payment");
        expect(await closeTab(p1)).toBe(true);
        expect(document.activeElement).toBe(editor);
        editor.remove();
      });
    });

    it("does nothing if the tab already closed while waiting for confirmation", async () => {
      await openPathInTab("/x/a.dosik.json");
      add("edit");
      await openLibraryDiagram("p1");
      const a = tabOf({ filePath: "/x/a.dosik.json" }).id;
      let answer!: (ok: boolean) => void;
      mockedAsk.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
      const first = closeTab(a);
      mockedAsk.mockResolvedValueOnce(true);
      expect(await closeTab(a)).toBe(true);
      answer(true);
      expect(await first).toBe(false);
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1"]);
    });
  });

  describe("a library diagram that was left rereads the listing (#217)", () => {
    const listings = () => calls("list_library").length;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("leaving with edits by switching, Home or closing rereads after the write — not when leaving an external file or Home", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      add("edit");
      await openPathInTab("/x/a.dosik.json");
      await vi.waitFor(() => expect(listings()).toBe(1));
      // the tree row goes back to a listing that has the edit in it
      const order = mockedInvoke.mock.calls.map(([c]) => c);
      expect(order.indexOf("save_project")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("save_project")).toBeLessThan(order.indexOf("list_library"));
      await activateTab(tabOf({ projectId: "p1" }).id);
      await settle();
      expect(listings()).toBe(1);
      add("again");
      showHomeTab();
      await vi.waitFor(() => expect(listings()).toBe(2));
      await activateTab(tabOf({ projectId: "p1" }).id);
      await settle();
      expect(listings()).toBe(2);
      add("more");
      await closeActiveTab();
      await vi.waitFor(() => expect(listings()).toBe(3));
    });

    it("leaving without writes does not reread — skimming with ⌃Tab never rereads the listing (#218)", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      await openLibraryDiagram("p2");
      await cycleTab(-1);
      await cycleTab(1);
      showHomeTab();
      await activateTab(tabOf({ projectId: "p1" }).id);
      await closeActiveTab();
      await settle();
      expect(listings()).toBe(0);
    });

    it("rereads once on leaving even if autosave already wrote before (#217)", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      add("edit");
      // the debounce fired: the edit is on disk before the tab is left
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(1);
      expect(listings()).toBe(0);
      await closeActiveTab();
      await vi.waitFor(() => expect(listings()).toBe(1));
      // and only once: nothing written since
      await openLibraryDiagram("p2");
      await openLibraryDiagram("p3");
      await settle();
      expect(listings()).toBe(1);
    });
  });

  describe("New diagram (T28)", () => {
    beforeEach(() =>
      useLibraryStore.setState({
        folders: [
          {
            folders: [],
            id: "work",
            name: "Work",
            // the most recent project — the default since #230 is worked out, not the first listed
            updatedAt: 2,
            diagrams: [{ id: "p1", title: "Checkout", updatedAt: 2, readable: true }],
          },
          { folders: [], id: "home-pick", name: "Picked", updatedAt: 1, diagrams: [] },
        ],
      }),
    );
    const savedTo = () => calls("save_project").map(([, a]) => (a as { folder?: string }).folder);

    it("into the active tab's project — opens in a new tab", async () => {
      await openLibraryDiagram("p1");
      const { id } = await newDiagramTab();
      expect(savedTo()).toEqual(["work"]);
      expect(store().projectId).toBe(id);
      expect(app().tabs.map((t) => t.projectId)).toEqual(["p1", id]);
    });

    it("when Home is active, into the project Home shows; on the dashboard, the default (most recent project) (#220 D8)", async () => {
      useAppStore.getState().setHomeView({ kind: "folder", folder: "home-pick" });
      await newDiagramTab();
      showHomeTab({ kind: "dashboard" });
      await newDiagramTab();
      expect(savedTo()).toEqual(["home-pick", "work"]);
      expect(app().tabs).toHaveLength(2);
    });

    it("always sends folder when there is a project — the same name the dashboard row showed; omitted only when empty (T5)", async () => {
      const named = namedTarget(useLibraryStore.getState().folders, app().newDiagramTarget);
      await newDiagramTab();
      expect(savedTo()).toEqual([named?.id]);
      useAppStore.setState({ newDiagramTarget: "home-pick" });
      showHomeTab();
      await newDiagramTab();
      expect(savedTo()[1]).toBe(
        namedTarget(useLibraryStore.getState().folders, app().newDiagramTarget)?.id,
      );
      expect(savedTo()[1]).toBe("home-pick");
      useAppStore.setState({ newDiagramTarget: null });
      useLibraryStore.setState({ folders: [] });
      showHomeTab();
      await newDiagramTab();
      expect(calls("save_project")[2]![1]).not.toHaveProperty("folder");
    });

    it("given an initial document, sends its bytes and opens it — the first no-op change is not written (#220 D7)", async () => {
      renderHook(() => useAutosave());
      const doc = makeDoc([makeNode({ id: "start", label: "Start" })], [], "Flowchart");
      await newDiagramTab("work", doc);
      const [, args] = calls("save_project")[0]!;
      expect(JSON.parse((args as { contents: string }).contents)).toEqual(doc);
      expect(store()).toMatchObject({ title: "Flowchart" });
      expect(ids()).toEqual(["start"]);
      // a selection change rewrites the node array but not the document
      store().onNodesChange([{ type: "select", id: "start", selected: true }]);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(1);
    });

    it("goes where the caller says — id follows Rust's rules, returns the folder it wrote to (#229)", async () => {
      const { id, folder } = await newDiagramTab("explicit");
      expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
      expect(folder).toBe("explicit");
      expect(calls("save_project")[0]![1]).toMatchObject({ id, folder: "explicit" });
    });

    it("does not go to a project Home showed long ago or one that vanished (#161, #220 D8)", async () => {
      // seen on Home, then an external file came up: not Home's project any more
      useAppStore.getState().setHomeView({ kind: "folder", folder: "home-pick" });
      await openPathInTab("/x/a.dosik.json");
      await newDiagramTab();
      expect(savedTo()).toEqual(["work"]);
      // on Home, but the project is gone from the library
      useLibraryStore.setState({ folders: [] });
      showHomeTab({ kind: "folder", folder: "home-pick" });
      await newDiagramTab();
      expect(calls("save_project")[1]![1]).not.toHaveProperty("folder");
    });

    it("throws without opening when the save fails", async () => {
      mockedInvoke.mockRejectedValueOnce(new Error("disk full"));
      await expect(newDiagramTab()).rejects.toThrow("disk full");
      expect(app()).toMatchObject({ view: "home", tabs: [] });
      expect(store().projectId).toBeNull();
    });

    it("a blank document is not written as the first no-op change", async () => {
      const { id } = await newDiagramTab();
      expect(store()).toMatchObject({ projectId: id, title: blankDoc().title });
      expect(calls("save_project")).toHaveLength(1);
    });
  });

  describe("a library in real folders (#253 D8, D11)", () => {
    it("an opened diagram is titled after its file, and its stamp is the base of its next save", async () => {
      mockedInvoke.mockImplementation(async (cmd) =>
        cmd === "load_project"
          ? { contents: JSON.stringify(book("Old title")), name: "Checkout", stamp: "1-10-aa" }
          : undefined,
      );
      await openLibraryDiagram("p1");
      expect(store().title).toBe("Checkout");
      expect(tabOf({ projectId: "p1" }).title).toBe("Checkout");
      expect(baseStampOf("p1")).toBe("1-10-aa");
    });

    it("a restored tab's read keeps its stamp too", async () => {
      mockedInvoke.mockImplementation(async (cmd) =>
        cmd === "load_project"
          ? { contents: JSON.stringify(book("Ledger")), name: "Ledger", stamp: "2-20-bb" }
          : undefined,
      );
      const restored = { ...newTab({ projectId: "p2", filePath: null, title: "Ledger" }, false) };
      app().commitTabs({ tabs: [restored], activeTab: null });
      await activateTab(restored.id);
      expect(store().projectId).toBe("p2");
      expect(baseStampOf("p2")).toBe("2-20-bb");
    });

    it("a new diagram opens under the name its file got, with its stamp", async () => {
      mockedInvoke.mockImplementation(async (cmd) =>
        cmd === "save_project"
          ? { kind: "saved", name: "Untitled Diagram 2", stamp: "3-30-cc" }
          : undefined,
      );
      const { id } = await newDiagramTab("work");
      expect(store()).toMatchObject({ projectId: id, title: "Untitled Diagram 2" });
      expect(tabOf({ projectId: id }).title).toBe("Untitled Diagram 2");
      expect(baseStampOf(id)).toBe("3-30-cc");
      // what it opened with is not an edit: nothing more is written
      renderHook(() => useAutosave());
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(1);
    });
  });
});
