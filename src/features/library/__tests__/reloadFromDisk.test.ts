import { invoke } from "@tauri-apps/api/core";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeNode } from "../../../shared/lib/__tests__/testFixtures";
import { useDiagramStore } from "../../../shared/lib/store";
import { useToastStore } from "../../../shared/lib/toastStore";
import type { DiagramDoc } from "../../../shared/lib/types";
import { useAppStore } from "../appStore";
import { useLibraryStore } from "../libraryStore";
import {
  activateTab,
  closeRemovedDiagrams,
  closeRemovedFile,
  externalPaths,
  openLibraryDiagram,
  openPathInTab,
  readLibraryIds,
  reloadDiagram,
  reloadExternalFile,
  resetTabsForTests,
} from "../tabActions";
import { newTab } from "../tabModel";
import {
  hasUnsavedExternalChanges,
  markExternalSaved,
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
const calls = (cmd: string) => mockedInvoke.mock.calls.filter(([c]) => c === cmd);
const store = () => useDiagramStore.getState();
const app = () => useAppStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.text);
const ids = () => store().nodes.map((n) => n.id);
const add = (id: string) =>
  store().applyOps([{ op: "add_node", node: { id, label: id, x: 0, y: 0 } }]);

const doc = (title: string, ...nodes: string[]): DiagramDoc => ({
  version: 1,
  title,
  nodes: nodes.map((id) => makeNode({ id })),
  edges: [],
});

/** what the disk holds: library diagrams by id (with a stamp), external files by path */
let library: Record<string, { doc: DiagramDoc; stamp: string }>;
let files: Record<string, string>;
/** what `save_project` answers next — written, by default, under a fresh stamp */
let saveAnswer: () => unknown;
let stamps = 0;

const serve = () =>
  mockedInvoke.mockImplementation(async (cmd, args) => {
    const a = args as { id?: string; path?: string };
    if (cmd === "load_project") {
      const entry = library[a.id!];
      if (!entry) throw new Error(`no such diagram: ${a.id}`);
      return { contents: JSON.stringify(entry.doc), name: entry.doc.title, stamp: entry.stamp };
    }
    if (cmd === "read_text_file") {
      const text = files[a.path!];
      if (text === undefined) throw new Error(`${a.path}: No such file`);
      return text;
    }
    if (cmd === "save_project") return saveAnswer();
    return undefined;
  });

/** the diagram `id` changed on disk by someone else */
const writeOutside = (id: string, next: DiagramDoc) => {
  stamps++;
  library[id] = { doc: next, stamp: `${stamps}-${JSON.stringify(next).length}-x${stamps}` };
};

describe("reading tabs again when their file changes outside the app (#253 D12, D13)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAutosaveForTests();
    resetUnsavedGuardForTests();
    resetTabsForTests();
    useToastStore.getState().dismissAll();
    useLibraryStore.setState({ folders: [], readFailed: false });
    stamps = 0;
    library = {
      p1: { doc: doc("Checkout", "a"), stamp: "0-1-aa" },
      p2: { doc: doc("Ledger", "l"), stamp: "0-2-bb" },
    };
    files = {};
    saveAnswer = () => ({ kind: "saved", stamp: `s${++stamps}-9-ss` });
    serve();
  });
  afterEach(() => vi.useRealTimers());

  describe("a library diagram", () => {
    it("with no edits of its own, read again quietly — the canvas stays, ⌘Z brings back what it showed", async () => {
      await openLibraryDiagram("p1");
      const reveal = store().revealRequest;
      if (reveal) store().consumeReveal(reveal.key);
      const steps = store().past.length;
      writeOutside("p1", doc("Checkout", "a", "b"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["a", "b"]);
      expect(store().revealRequest).toBeNull();
      expect(store().past).toHaveLength(steps + 1);
      expect(toasts()).toEqual([]);
      expect(baseStampOf("p1")).toBe(library.p1!.stamp);
      store().undo();
      expect(ids()).toEqual(["a"]);
    });

    it("as the tab last saw it, nothing happens — no read into the document, no undo step", async () => {
      await openLibraryDiagram("p1");
      const steps = store().past.length;
      await reloadDiagram("p1");
      expect(store().past).toHaveLength(steps);
      // the same contents written again: nothing either
      library.p1 = { ...library.p1!, stamp: "5-1-aa" };
      await reloadDiagram("p1");
      expect(store().past).toHaveLength(steps);
    });

    it("with edits the file lacks, the file wins — a toast says so, ⌘Z brings the edits back, they are not written", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      add("mine");
      writeOutside("p1", doc("Checkout", "a", "theirs"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["a", "theirs"]);
      expect(toasts()).toEqual(["“Checkout” changed outside Dosik — reloaded"]);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(0);
      store().undo();
      expect(ids()).toEqual(["a", "mine"]);
      // the edits brought back are written, over the file as it is now
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(calls("save_project")).toHaveLength(1);
      expect(calls("save_project")[0]![1]).toMatchObject({ base: library.p1!.stamp });
    });

    it("a tab not on screen has its snapshot read again; ⌘Z there brings back what it held", async () => {
      await openLibraryDiagram("p1");
      await openLibraryDiagram("p2");
      writeOutside("p1", doc("Checkout", "a", "b"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["l"]);
      const tab = app().tabs.find((t) => t.projectId === "p1")!;
      expect(tab.doc?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
      await activateTab(tab.id);
      expect(ids()).toEqual(["a", "b"]);
      store().undo();
      expect(ids()).toEqual(["a"]);
    });

    it("a tab restored and not read yet is left to be read when it is opened", async () => {
      const restored = newTab({ projectId: "p1", filePath: null, title: "Checkout" }, false);
      app().commitTabs({ tabs: [restored], activeTab: null });
      writeOutside("p1", doc("Checkout", "a", "b"));
      await reloadDiagram("p1");
      expect(calls("load_project")).toHaveLength(0);
      expect(readLibraryIds()).toEqual([]);
    });

    it("a save refused as changed on disk reads the file again, with the toast", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      writeOutside("p1", doc("Checkout", "a", "theirs"));
      saveAnswer = () => ({ kind: "changedOnDisk" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(ids()).toEqual(["a", "theirs"]));
      expect(toasts()).toEqual(["“Checkout” changed outside Dosik — reloaded"]);
      store().undo();
      expect(ids()).toEqual(["a", "mine"]);
    });

    it("a save refused as gone closes the tab with a toast, and nothing is written again", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      saveAnswer = () => ({ kind: "gone" });
      add("mine");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      await vi.waitFor(() => expect(app().tabs).toEqual([]));
      expect(toasts()).toEqual(["“Checkout” was removed outside Dosik"]);
      add("after");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      expect(calls("save_project")).toHaveLength(1);
    });

    it("removed outside: its tabs close with a toast each, and a pending edit is dropped, not written", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p2");
      await openLibraryDiagram("p1");
      add("pending");
      closeRemovedDiagrams(new Set(["p1", "p2", "never-open"]));
      expect(app().tabs).toEqual([]);
      expect(toasts().sort()).toEqual([
        "“Checkout” was removed outside Dosik",
        "“Ledger” was removed outside Dosik",
      ]);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      await flushAutosave();
      expect(calls("save_project")).toHaveLength(0);
    });

    it("a write queued before the read is dropped — it would put back what the read replaced", async () => {
      renderHook(() => useAutosave());
      await openLibraryDiagram("p1");
      let finish!: (answer: unknown) => void;
      saveAnswer = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      add("one");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      add("two");
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      // the second write waits behind the first
      expect(calls("save_project")).toHaveLength(1);
      writeOutside("p1", doc("Checkout", "theirs"));
      await reloadDiagram("p1");
      expect(ids()).toEqual(["theirs"]);
      finish({ kind: "changedOnDisk" });
      await flushAutosave();
      await vi.waitFor(() =>
        expect(toasts()).toContain("“Checkout” changed outside Dosik — reloaded"),
      );
      expect(calls("save_project")).toHaveLength(1);
      expect(ids()).toEqual(["theirs"]);
    });
  });

  describe("an external file (Open file…)", () => {
    const path = "/x/mine.dosik";

    it("read again the same way; what this app wrote there is no change", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      await openPathInTab(path);
      files[path] = JSON.stringify(doc("Mine", "a", "b"));
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a", "b"]);
      expect(toasts()).toEqual([]);
      expect(hasUnsavedExternalChanges()).toBe(false);
      store().undo();
      expect(ids()).toEqual(["a"]);
      // a Save of its own, then an edit: the file holds what it wrote, and the edit stays
      const written = JSON.stringify(store().toDoc(), null, 2);
      files[path] = written;
      markExternalSaved(written);
      add("later");
      const steps = store().past.length;
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a", "later"]);
      expect(store().past).toHaveLength(steps);
    });

    it("with unsaved edits, the file wins and a toast says so", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      await openPathInTab(path);
      add("mine");
      expect(hasUnsavedExternalChanges()).toBe(true);
      files[path] = JSON.stringify(doc("Mine", "a", "theirs"));
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a", "theirs"]);
      expect(toasts()).toEqual(["“Mine” changed outside Dosik — reloaded"]);
      expect(hasUnsavedExternalChanges()).toBe(false);
    });

    it("half written or no diagram: left as it is until the next change", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      await openPathInTab(path);
      files[path] = '{"nodes": [';
      await reloadExternalFile(path);
      expect(ids()).toEqual(["a"]);
      expect(toasts()).toEqual([]);
    });

    it("removed: a clean tab closes with a toast; one with unsaved edits stays — only it holds them", async () => {
      files[path] = JSON.stringify(doc("Mine", "a"));
      files["/x/other.dosik"] = JSON.stringify(doc("Other", "o"));
      await openPathInTab(path);
      await openPathInTab("/x/other.dosik");
      add("unsaved");
      expect(externalPaths()).toEqual([path, "/x/other.dosik"]);
      closeRemovedFile(path);
      closeRemovedFile("/x/other.dosik");
      expect(app().tabs.map((t) => t.filePath)).toEqual(["/x/other.dosik"]);
      expect(toasts()).toEqual([
        "“Mine” was removed outside Dosik",
        "“Other” was removed outside Dosik",
      ]);
    });
  });
});
